# Joblog

An AI-powered job application tracker. Personal CRM for high-volume job search — Kanban pipeline, automated stage detection from email (Gmail + Outlook), follow-up nudges, and analytics. See [`job-tracker-prd.md`](https://github.com/) for the full product spec.

## Status

**Week 2 complete — real persistence on Supabase.**

- [x] **Week 1** — Vite + React + TS + Tailwind scaffold, kanban with drag-and-drop, CRUD dialog, stale-card highlighting, summary bar
- [x] **Week 2** — Express + Prisma backend, Postgres on Supabase, REST API, dev-mode auth middleware (Clerk swap-point ready), frontend wired to API with optimistic updates
- [ ] **Week 3** — Gmail OAuth + inbox polling + keyword classifier
- [ ] Weeks 4–9 — see roadmap below

## Architecture

```
┌──────────────┐  HTTP/JSON   ┌──────────────┐  Prisma   ┌────────────────┐
│  React + TS  │ ───────────► │  Express +   │ ────────► │  Postgres on   │
│  Vite :5173  │ ◄─────────── │  Prisma :4000│ ◄──────── │  Supabase      │
└──────────────┘              └──────────────┘           └────────────────┘
```

| Layer    | Tech                                                                 |
| -------- | -------------------------------------------------------------------- |
| Frontend | React 18 + TS + Vite + Tailwind + Zustand + @dnd-kit                 |
| Backend  | Node.js + Express + Zod                                              |
| DB / ORM | PostgreSQL on Supabase (free tier, pooled) + Prisma 5                |
| Auth     | Dev-mode middleware (constant `dev-user-1`) — Clerk swap point ready |
| Email AI | Claude API (Week 5)                                                  |
| Hosting  | Vercel (web) + Railway (api) + Supabase (db) — planned               |

## Setup

**Prerequisites:** Node 20+, a free Supabase project.

```bash
# 1. Install everything
npm install
npm --prefix server install

# 2. Configure environment
cp .env.example .env                # frontend (VITE_API_URL)
cp server/.env.example server/.env  # backend  (paste your Supabase DATABASE_URL + DIRECT_URL)

# 3. Migrate + seed the database
cd server
npx prisma migrate deploy
npm run seed
cd ..

# 4. Run both frontend and backend
npm run dev
```

Visit **http://localhost:5173**. You should see 6 seeded applications loaded from Supabase.

### Verifying the backend

| What | Command / URL |
| --- | --- |
| Health check | `curl http://localhost:4000/health` |
| List apps | `curl http://localhost:4000/api/applications` |
| Analytics | `curl http://localhost:4000/api/analytics/summary` |
| In the UI | Drag a card → reload the page → status persists (Week 1 lost it on reload) |
| In Supabase | Dashboard → Table Editor → `applications` |

If the frontend shows a red banner ("API error: ..."), the backend isn't reachable — check the `[api]` stream in your `npm run dev` terminal.

## Scripts

### Root (frontend + orchestration)
| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend + backend together via `concurrently` |
| `npm run dev:web` | Frontend only (Vite, port 5173) |
| `npm run dev:api` | Backend only (proxies to `server/`, port 4000) |
| `npm run build` | Production frontend build |
| `npm run lint` | TypeScript typecheck |

### `server/`
| Command | Purpose |
| --- | --- |
| `npm run dev` | Express in watch mode via `tsx` |
| `npm run build` | Compile TS → `dist/` |
| `npm run seed` | Seed dev user + 6 mock applications (idempotent) |
| `npm run prisma:migrate` | Create + apply a new migration |
| `npm run prisma:studio` | Browse the DB visually |

## Project structure

```
Joblog/
├── package.json              Frontend deps + root dev orchestration
├── .env                      VITE_API_URL (gitignored)
├── vite.config.ts
├── tailwind.config.js
├── src/                      ── FRONTEND ──
│   ├── App.tsx               Page shell, mounts loadApplications()
│   ├── main.tsx              React root
│   ├── types.ts              Application, status enum, stale thresholds (PRD §4.1/4.2/4.5)
│   ├── lib/
│   │   ├── api.ts            Typed fetch client + ApiError
│   │   └── utils.ts          daysSince, isStale, statusAccent
│   ├── store/
│   │   └── applicationStore.ts  Zustand store — async actions, optimistic updates with rollback
│   └── components/
│       ├── KanbanBoard.tsx       DnD context + columns
│       ├── KanbanColumn.tsx      Droppable column
│       ├── ApplicationCard.tsx   Sortable card
│       ├── ApplicationDialog.tsx Create/edit form (PRD §4.1 fields)
│       └── SummaryBar.tsx        Top metrics
│
└── server/                   ── BACKEND ──
    ├── package.json
    ├── .env                  Supabase URLs + dev user (gitignored)
    ├── prisma/
    │   ├── schema.prisma     Models per PRD §6.2
    │   ├── seed.ts           Idempotent seed
    │   └── migrations/       Versioned SQL
    └── src/
        ├── index.ts          Express entry — CORS, JSON, /health, route mounting, error handler
        ├── db.ts             Prisma singleton
        ├── auth.ts           Dev auth middleware (TODO: clerk swap)
        ├── lib/mappers.ts    Prisma row → API DTO
        └── routes/
            ├── applications.ts  POST/GET/GET:id/PATCH/DELETE — auto-appends StatusHistory on status change
            ├── analytics.ts     /summary, /over-time
            ├── nudges.ts        GET, PATCH /:id/dismiss
            └── internal.ts      Stubs for poll-gmail/poll-outlook/check-nudges (Weeks 3–7)
```

## Data flow on a card move

```
drag in browser
  → store.moveApplication() optimistically flips status in memory
  → PATCH /api/applications/:id { status, trigger: 'manual' }
  → authMiddleware sets req.userId
  → Zod validates body
  → prisma.application.update + prisma.statusHistory.create (single transaction)
  → mappers.toApplicationDTO → JSON
  → store replaces the optimistic row with server truth (or rolls back on error)
```

The frontend is **never** the source of truth — Supabase is. Reloading the page always reflects what's in the database.

## Where to make changes

| You want to... | Edit |
| --- | --- |
| Change schema | `server/prisma/schema.prisma` → `npx prisma migrate dev --name your_change` |
| Add a new endpoint | New file in `server/src/routes/` → mount in `server/src/index.ts` |
| Add a new API call from the frontend | Method in `src/lib/api.ts` → call from `src/store/applicationStore.ts` |
| Add new UI | Component in `src/components/` → wire to store |
| Change stage colors / labels / stale thresholds | `src/types.ts` and `src/lib/utils.ts` |
| Swap dev auth for real Clerk | `server/src/auth.ts` (search for `TODO: clerk`) |

## Multi-tenancy from day one

Every `/api/*` route runs through `authMiddleware`, which sets `req.userId`. Every Prisma query inside a route handler is scoped with `where: { userId: req.userId }`. Today that user is always `dev-user-1`; when Clerk lands, the only change is `req.userId` will come from a verified JWT instead of a constant. No data model changes needed.

## Roadmap

Click a checkbox on GitHub to mark a week complete (creates a commit on the current branch).

- [x] **Week 1** — React + Vite scaffold, kanban UI, CRUD, drag-and-drop
- [x] **Week 2** — Express API, Supabase + Prisma, real persistence
- [ ] **Week 3** — Gmail OAuth, inbox polling, keyword classifier
- [ ] **Week 4** — Outlook OAuth + Microsoft Graph polling
- [ ] **Week 5** — Claude API classifier, auto-advance, undo toast
- [ ] **Week 6** — Browser extension (LinkedIn + Greenhouse)
- [ ] **Week 7** — Follow-up nudge cron + in-app display
- [ ] **Week 8** — Analytics dashboard (funnel, response by source)
- [ ] **Week 9** — Polish: PWA, error handling, README

## Notes

- **Free Supabase pauses after 7 days idle.** If the backend logs `Can't reach database server`, unpause the project from the dashboard.
- The Supabase free tier exposes both DB URLs through Supavisor. `:6543` (`DATABASE_URL`, transaction mode, used by Prisma at runtime) needs `?pgbouncer=true`. `:5432` (`DIRECT_URL`, session mode, used by migrations) does not.
- Auth is intentionally a stub. Wiring Clerk is a Week 2.5 task: replace `server/src/auth.ts` with JWT verification, wrap `<App>` in `<ClerkProvider>`, send the token as a `Bearer` header from `src/lib/api.ts`. Existing `dev-user-1` data stays put.
