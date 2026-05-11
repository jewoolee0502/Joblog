import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { prisma } from './db.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Cache of user IDs already provisioned in our DB. */
const provisionedUsers = new Set<string>();

/**
 * Supabase auth middleware.
 * Verifies the Bearer token via Supabase Auth, auto-provisions a User
 * record on first request, and sets req.userId.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userId = data.user.id;
    const email = data.user.email ?? '';

    // Auto-provision user on first authenticated request
    if (!provisionedUsers.has(userId)) {
      await prisma.user.upsert({
        where: { id: userId },
        update: { email },
        create: { id: userId, email },
      });

      provisionedUsers.add(userId);
    }

    req.userId = userId;
    next();
  } catch (err) {
    next(err);
  }
}
