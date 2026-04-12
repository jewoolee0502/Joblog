import type { Request, Response, NextFunction } from 'express';
import { prisma } from './db.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

const DEV_USER_ID = process.env.DEV_USER_ID ?? 'dev-user-1';
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL ?? 'dev@joblog.local';

let devUserEnsured = false;

async function ensureDevUser() {
  if (devUserEnsured) return;
  await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: {},
    create: { id: DEV_USER_ID, email: DEV_USER_EMAIL },
  });
  devUserEnsured = true;
}

/**
 * Dev-mode auth middleware.
 * TODO: clerk — replace with Clerk JWT verification.
 * For now, every request is attributed to a single dev user that we upsert on first hit.
 */
export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    await ensureDevUser();
    req.userId = DEV_USER_ID;
    next();
  } catch (err) {
    next(err);
  }
}
