# Joblog

An AI-powered job application tracker. Personal CRM for high-volume job search — Kanban pipeline, automated stage detection from email (Gmail + Outlook), follow-up nudges, and analytics.

**Target user:** Technical job seekers running 20+ concurrent applications who use Gmail or Outlook.

## Status

**Week 4 in progress — Botpress ADK migration, scan now/deep scan, review queue UI, code optimization.**

- [x] **Week 1** — Vite + React + TS + Tailwind scaffold, kanban with drag-and-drop, CRUD dialog, stale-card highlighting, summary bar
- [x] **Week 2** — Express + Prisma backend, Postgres on Supabase, REST API, dev-mode auth middleware (Clerk swap-point ready), frontend wired to API with optimistic updates
- [x] **Week 3** — Gmail + Outlook OAuth flows, email services, Claude classifier, cron scanner, settings panel
- [x] **Week 4** — Migrated email scanning pipeline to Botpress ADK, scan now / deep scan workflows, review queue UI, code optimization
- [ ] Weeks 5–9 — see [roadmap](#roadmap) below

## Architecture

```
┌──────────────┐  HTTP/JSON   ┌──────────────────┐  Prisma   ┌────────────────┐
│  React + TS  │ ───────────► │  Express + Prisma │ ────────► │  Postgres on   │
│  Vite :5173  │ ◄─────────── │  :4000            │ ◄──────── │  Supabase      │
└──────────────┘              └────────┬─────────┘           └────────────────┘
                                       │ trigger                      ▲
                                       ▼                              │
                              ┌────────────────────┐                  │
                              │  Botpress ADK Bot   │  raw SQL        │
                              │  (joblog-email-bot) │ ────────────────┘
                              │                     │
                              │  ┌──────────────┐   │
                              │  │ dailyScan    │   │
                              │  │ workflow     │   │
                              │  │              │   │
                              │  │ Gmail fetch  │   │
                              │  │ Outlook fetch│   │
                              │  │ Pre-filter   │   │
                              │  │ Claude API   │   │
                              │  │ classify     │   │
                              │  └──────────────┘   │
                              └─────────────────────┘
```

| Layer | Tech |
| --- | --- |
| Frontend | React 18 + TS + Vite + Tailwind + Zustand + @dnd-kit |
| Backend | Node.js + Express + TypeScript |
| DB / ORM | PostgreSQL on Supabase + Prisma |
| Auth | Clerk (dev-mode middleware currently; Clerk integration planned) |
| Email Automation | Botpress ADK workflow + Claude API (`claude-sonnet-4-20250514`) for classification |
| Email Integration | Gmail + Outlook OAuth (both connected simultaneously) |
| Background Jobs | Botpress ADK scheduled workflow (daily 7 AM EST / 12:00 UTC) |
| Hosting | Vercel (frontend) + Railway (server) + Supabase (DB) — planned |

## How It Works

### Application Pipeline

```
SAVED → APPLIED → ACKNOWLEDGED → SCREENING → INTERVIEW → FINAL_ROUND → OFFER → ACCEPTED
                                                                            ↘ REJECTED (any stage)
                                                                            ↘ WITHDRAWN (any stage)
                                                                            ↘ GHOSTED (manual)
```

### Email Automation Flow

Email scanning is orchestrated by a **Botpress ADK bot** (`joblog-email-bot/`), not `node-cron` in the Express server.

**Trigger methods:**
- **Scan Now** — user clicks "Scan Now" in Settings → `POST /api/auth/trigger-scan` → creates Botpress `dailyScan` workflow → polls for results synchronously (up to 2 min)
- **Deep Scan** — user clicks "Deep Scan" with a month range (`?months=N`) → same workflow but with a `sinceOverride` date → returns immediately, runs in background
- **Scheduled** — Botpress cron triggers `dailyScan` workflow daily at **12:00 UTC (7 AM EST)**

**Pipeline (same for all triggers):**
1. Fetch emails from Gmail + Outlook (both providers, deduplicated by messageId)
2. Domain-match sender against tracked applications (contact email, job URL domain, fuzzy company name)
3. Pre-filter obviously non-job emails (800+ heuristic rules: domain blocklist, subject patterns, sender patterns)
4. **Matched emails** → classify using `claude-sonnet-4-20250514` into: `ACKNOWLEDGEMENT`, `SCREENING_REQUEST`, `INTERVIEW_INVITE`, `REJECTION`, `OFFER`, or `UNCLEAR`
5. **Unmatched emails** → triage via LLM to detect new job-related emails and auto-create application records
6. If confidence ≥ 0.75 → auto-advance application stage (≥ 0.85 required for `REJECTED`)
7. Below-threshold or `UNCLEAR` emails → flagged for manual review as Nudge records

All automated transitions are reversible — logged to `StatusHistory` with an undo toast (10s).

### Data Flow on a Card Move

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

## Setup

**Prerequisites:** Node 20+, a free Supabase project.

```bash
# 1. Install everything
npm install
npm --prefix server install

# 2. Configure environment
cp .env.example .env                # frontend (VITE_API_URL)
cp server/.env.example server/.env  # backend  (DATABASE_URL, DIRECT_URL, OAuth keys, etc.)

# 3. Migrate + seed the database
cd server
npx prisma migrate deploy
npm run seed
cd ..

# 4. Run both frontend and backend
npm run dev
```

Visit **http://localhost:5173**. You should see 6 seeded applications loaded from Supabase.

### Verifying the Backend

| What | Command / URL |
| --- | --- |
| Health check | `curl http://localhost:4000/health` |
| List apps | `curl http://localhost:4000/api/applications` |
| Analytics | `curl http://localhost:4000/api/analytics/summary` |
| Connection status | `curl http://localhost:4000/api/auth/connections` |
| Trigger scan | `curl -X POST http://localhost:4000/api/auth/trigger-scan` (authenticated, triggers Botpress workflow) |
| In the UI | Drag a card → reload the page → status persists |
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

## Project Structure

```
joblog/
├── src/                             # React 18 + Vite frontend
│   ├── components/                  # KanbanBoard, KanbanColumn, ApplicationCard,
│   │                                # ApplicationDialog, SettingsPanel, SummaryBar,
│   │                                # ReviewQueue
│   ├── store/                       # Zustand store (applicationStore.ts)
│   ├── lib/                         # API client (api.ts), utils (utils.ts)
│   └── types.ts                     # Application, StatusHistoryEntry, status/source types
├── server/                          # Express REST API
│   ├── src/
│   │   ├── routes/                  # applications, oauth, analytics, nudges, internal
│   │   ├── services/                # gmail, outlook (email fetchers for OAuth flows)
│   │   ├── lib/                     # constants, types, crypto, emailUtils, mappers
│   │   ├── auth.ts                  # Auth middleware (dev-mode)
│   │   ├── db.ts                    # Prisma client singleton
│   │   └── index.ts                 # Express app entry point
│   ├── prisma/
│   │   ├── schema.prisma            # User, Application, StatusHistory, Nudge
│   │   └── migrations/
│   └── tsconfig.json
├── joblog-email-bot/                # Botpress ADK bot (email scanning pipeline)
│   ├── src/
│   │   ├── actions/                 # fetchAndFilterEmails, scanUserEmails
│   │   ├── utils/                   # gmailFetcher, outlookFetcher, domainMatcher,
│   │   │                            # crypto, constants, emailUtils, supabase, types
│   │   └── workflows/               # dailyScan (scheduled + manual trigger)
│   ├── agent.config.ts              # Botpress ADK configuration
│   └── package.json
├── package.json                     # Root orchestration (concurrently)
├── vite.config.ts
└── tailwind.config.js
```

## Where to Make Changes

| You want to... | Edit |
| --- | --- |
| Change schema | `server/prisma/schema.prisma` → `npx prisma migrate dev --name your_change` |
| Add a new endpoint | New file in `server/src/routes/` → mount in `server/src/index.ts` |
| Add a new API call from the frontend | Method in `src/lib/api.ts` → call from `src/store/applicationStore.ts` |
| Add new UI | Component in `src/components/` → wire to store |
| Change stage colors / labels / stale thresholds | `src/types.ts` and `src/lib/utils.ts` |
| Swap dev auth for real Clerk | `server/src/auth.ts` (search for `TODO: clerk`) |
| Add a new application stage | See CLAUDE.md "Common Tasks" section |

## Multi-tenancy From Day One

Every `/api/*` route runs through `authMiddleware`, which sets `req.userId`. Every Prisma query inside a route handler is scoped with `where: { userId: req.userId }`. Today that user is always `dev-user-1`; when Clerk lands, the only change is `req.userId` will come from a verified JWT instead of a constant. No data model changes needed.

## Roadmap

| Week | Deliverable | Status |
| --- | --- | --- |
| 1 | React + Vite scaffold, kanban UI, CRUD, drag-and-drop | ✅ |
| 2 | Express API, Supabase + Prisma, real persistence | ✅ |
| 3 | Gmail + Outlook OAuth flows, email services, Claude classifier, cron scanner, settings panel | ✅ |
| 4 | Botpress ADK migration, scan now / deep scan, review queue UI, code optimization | ✅ |
| 5 | Chrome extension (Save + Applied buttons, JD auto-scrape) | |
| 6 | Full-text JD search | |
| 7 | Nudge system (node-cron job + in-app display) | |
| 8 | Analytics dashboard UI | |
| 9 | Clerk auth integration, polish, loading states, error handling | |

## Notes

- **Free Supabase pauses after 7 days idle.** If the backend logs `Can't reach database server`, unpause the project from the dashboard.
- The Supabase free tier exposes both DB URLs through Supavisor. `:6543` (`DATABASE_URL`, transaction mode, used by Prisma at runtime) needs `?pgbouncer=true`. `:5432` (`DIRECT_URL`, session mode, used by migrations) does not.
- Auth is intentionally a stub. Wiring Clerk is a Week 9 task: replace `server/src/auth.ts` with JWT verification, wrap `<App>` in `<ClerkProvider>`, send the token as a `Bearer` header from `src/lib/api.ts`. Existing `dev-user-1` data stays put.
- OAuth tokens are encrypted at rest using AES-256-GCM (`server/src/lib/crypto.ts`, `joblog-email-bot/src/utils/crypto.ts`). Email body content is never persisted — transient use during classification only.
- Internal cron routes (`/api/internal/*`) are protected by `x-cron-secret` header validation and are never exposed to the frontend client.
- The Botpress ADK bot connects directly to Supabase via raw SQL (not Prisma) for email scanning operations. The Express server uses Prisma for all other DB access.
- Outlook uses MSAL token cache (serialized + encrypted) rather than a single refresh token. The full cache is re-serialized after each token refresh.
