# Joblog

An AI-powered job application tracker. Personal CRM for high-volume job search — Kanban pipeline, automated stage detection from email (Gmail + Outlook), Chrome extension for saving job postings, follow-up nudges, and analytics.

**Target user:** Technical job seekers running 20+ concurrent applications who use Gmail or Outlook.

## Status

**Week 5 in progress — Architecture refactor, Chrome extension integration, Botpress Zai migration.**

- [x] **Week 1** — Vite + React + TS + Tailwind scaffold, kanban with drag-and-drop, CRUD dialog, stale-card highlighting, summary bar
- [x] **Week 2** — Express + Prisma backend, Postgres on Supabase, REST API, dev-mode auth middleware (Clerk swap-point ready), frontend wired to API with optimistic updates
- [x] **Week 3** — Gmail + Outlook OAuth flows, email services, Claude classifier, cron scanner, settings panel
- [x] **Week 4** — Botpress ADK bot, scan now / deep scan workflows, review queue UI
- [x] **Week 5** — Architecture refactor (Botpress = LLM only, Express = orchestration + DB), Chrome extension JD parsing migrated to email-bot, Zai migration, chronological email processing, per-company batch classification, multi-role matching
- [ ] Weeks 6–9 — see [roadmap](#roadmap) below

## Architecture

```
┌──────────────┐  HTTP/JSON   ┌──────────────────┐  Prisma   ┌────────────────┐
│  React + TS  │ ───────────► │  Express + Prisma │ ────────► │  Postgres on   │
│  Vite :5173  │ ◄─────────── │  :4000            │ ◄──────── │  Supabase      │
└──────────────┘              └────────┬─────────┘           └────────────────┘
                                       │                              ▲
┌──────────────┐                       │ callAction                   │
│  Chrome      │ ──────────────────────┤ (LLM only)                   │
│  Extension   │                       ▼                              │
└──────────────┘              ┌─────────────────────┐                 │
                              │  Botpress ADK Bot    │                 │
                              │  (joblog-email-bot)  │                 │
                              │                      │                 │
                              │  Actions (LLM only): │                 │
                              │  • classifyEmails    │                 │
                              │  • triageEmails      │                 │
                              │  • parseJobDescription│                │
                              └──────────────────────┘                 │
                                                                       │
                              Express handles:                         │
                              • Email fetching (Gmail/Outlook APIs)    │
                              • Pre-filtering + domain matching        │
                              • DB reads/writes via Prisma ────────────┘
                              • Cron scheduling (node-cron)
                              • Orchestration of scan pipeline
```

**Key design principle:** Botpress is a pure LLM gateway — it receives text, returns structured JSON. Express handles ALL database operations, email fetching, filtering, and orchestration. There is only one data access path (Prisma in Express).

| Layer | Tech |
| --- | --- |
| Frontend | React 18 + TS + Vite + Tailwind + Zustand + @dnd-kit |
| Backend | Node.js + Express + TypeScript |
| DB / ORM | PostgreSQL on Supabase + Prisma |
| Auth | Clerk (dev-mode middleware currently; Clerk integration planned) |
| LLM Gateway | Botpress ADK bot with Zai (`adk.zai.extract()`) for structured extraction |
| Email Integration | Gmail + Outlook OAuth (both connected simultaneously) |
| Background Jobs | `node-cron` in Express (configurable via `CRON_SCAN_SCHEDULE` env var, default: daily 7 AM EST) |
| Chrome Extension | Manifest V3, captures page text, sends to Express for JD parsing |
| Hosting | Vercel (frontend) + Railway (server) + Supabase (DB) + Botpress Cloud (bot) |

## How It Works

### Application Pipeline

```
SAVED → APPLIED → SCREENING → INTERVIEW → FINAL_ROUND → OFFER → ACCEPTED
                                                            ↘ REJECTED (any stage)
                                                            ↘ WITHDRAWN (any stage)
                                                            ↘ GHOSTED (manual)
```

### Email Automation Flow

Email scanning is orchestrated by **Express** (`server/src/services/emailScanner.ts`), which calls Botpress for LLM classification only.

**Trigger methods:**
- **Scan Now** — user clicks "Scan Now" in Settings → `POST /api/auth/trigger-scan` → Express runs `runEmailScan()` directly → returns results synchronously
- **Deep Scan** — user clicks "Deep Scan" (`?months=N`) → Express runs scan in background → returns immediately
- **Scheduled** — `node-cron` triggers `runFullScan()` daily at 7 AM EST (configurable)

**Pipeline (same for all triggers):**
1. Fetch emails from Gmail + Outlook (both providers, deduplicated by messageId)
2. **Sort oldest-first** — emails processed in chronological order so the LLM can use earlier emails as context for later ones
3. Domain-match sender against tracked applications (contact email, job URL domain, fuzzy company name)
4. Pre-filter obviously non-job emails (regex-based: domain blocklist, subject patterns, sender patterns)
5. **Group matched emails by company** — all emails from the same company sent to the LLM as one chronological batch
6. **Matched emails** → Botpress `classifyEmails` action classifies each email into: `APPLIED`, `SCREENING`, `INTERVIEW`, `REJECTED`, `OFFER`, or `UNCLEAR`. The LLM also picks which specific role the email is about (supports multiple roles at the same company)
7. **Unmatched emails** → Botpress `triageEmails` action detects new job-related emails and extracts company/role/status. Express creates new application records after duplicate checking
8. **UNCLEAR emails from classify** are re-routed to triage — handles cases where the email is about a role not yet on the kanban board
9. If confidence >= 0.75 → auto-advance application stage (>= 0.85 required for `REJECTED`)
10. Below-threshold emails → flagged for manual review as Nudge records
11. Same-stage or backward transitions → silently skipped (no nudge, no update)

All automated transitions are reversible — logged to `StatusHistory` with an undo toast (10s).

### Chrome Extension Flow

```
User clicks Save/Applied on job posting page
  → Extension captures page text (up to 10,000 chars) + URL
  → POST /api/applications/from-extension { pageText, pageUrl, status }
  → Express calls Botpress `parseJobDescription` action (LLM extracts structured fields)
  → Express creates application in DB via Prisma
  → Response returned to extension with created application
```

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

**Prerequisites:** Node 20+, a free Supabase project, a Botpress account.

```bash
# 1. Install everything
npm install
npm --prefix server install
npm --prefix joblog-email-bot install

# 2. Configure environment
cp .env.example .env                # frontend (VITE_API_URL)
cp server/.env.example server/.env  # backend  (DATABASE_URL, OAuth keys, Botpress keys, etc.)

# 3. Migrate + seed the database
cd server
npx prisma migrate deploy
npm run seed
cd ..

# 4. Run the app
# Option A: Development (with local Botpress bot)
cd joblog-email-bot && adk dev --logs --no-open  # Terminal 1
npm run dev                                       # Terminal 2 (frontend + Express)

# Option B: Production (with deployed Botpress bot)
cd joblog-email-bot && adk deploy                 # One-time deploy
npm run dev                                       # Just frontend + Express
```

### Environment Variables (server/.env)

```bash
# Botpress
BOTPRESS_TOKEN=bp_pat_...

# Bot ID — uncomment the one you need:
# Dev (requires `adk dev` running locally)
BP_BOT_ID=<dev-bot-id>
# Production (deployed to Botpress Cloud)
# BP_BOT_ID=<deployed-bot-id>

# Optional: override daily scan schedule (default: 7 AM EST = 12:00 UTC)
# CRON_SCAN_SCHEDULE=0 12 * * *
```

Visit **http://localhost:5173**. You should see seeded applications loaded from Supabase.

### Verifying the Backend

| What | Command / URL |
| --- | --- |
| Health check | `curl http://localhost:4000/health` |
| List apps | `curl http://localhost:4000/api/applications` |
| Analytics | `curl http://localhost:4000/api/analytics/summary` |
| Connection status | `curl http://localhost:4000/api/auth/connections` |
| Trigger scan | `curl -X POST http://localhost:4000/api/auth/trigger-scan` |
| Deep scan | `curl -X POST http://localhost:4000/api/auth/trigger-scan?months=3` |
| In the UI | Drag a card → reload the page → status persists |

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
| `npm run seed` | Seed dev user + mock applications (idempotent) |
| `npm run prisma:migrate` | Create + apply a new migration |
| `npm run prisma:studio` | Browse the DB visually |

### `joblog-email-bot/`

| Command | Purpose |
| --- | --- |
| `adk dev --logs --no-open` | Run bot locally for development |
| `adk deploy` | Deploy bot to Botpress Cloud |

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
├── server/                          # Express REST API + orchestration
│   ├── src/
│   │   ├── routes/                  # applications, oauth, analytics, nudges, extension
│   │   ├── services/                # gmail, outlook, emailScanner (orchestrator)
│   │   ├── lib/                     # constants, types, crypto, domainMatcher,
│   │   │                            # emailFilter, botpress, mappers
│   │   ├── auth.ts                  # Auth middleware (dev-mode)
│   │   ├── db.ts                    # Prisma client singleton
│   │   └── index.ts                 # Express app entry point + node-cron scheduler
│   ├── prisma/
│   │   ├── schema.prisma            # User, Application, StatusHistory, Nudge
│   │   └── migrations/
│   └── tsconfig.json
├── joblog-email-bot/                # Botpress ADK bot (LLM gateway only)
│   ├── src/
│   │   └── actions/                 # classifyEmails, triageEmails, parseJobDescription
│   ├── agent.config.ts              # Botpress ADK configuration
│   └── package.json
├── extension/                       # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── popup.html / popup.js / popup.css
│   └── icons/
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
| Modify email classification behavior | `joblog-email-bot/src/actions/classifyEmails.ts` (LLM prompt + schema) |
| Modify email pre-filter rules | `server/src/lib/emailFilter.ts` |
| Modify domain matching logic | `server/src/lib/domainMatcher.ts` |
| Change scan schedule | Set `CRON_SCAN_SCHEDULE` env var (default: `0 12 * * *`) |

## Multi-tenancy From Day One

Every `/api/*` route runs through `authMiddleware`, which sets `req.userId`. Every Prisma query inside a route handler is scoped with `where: { userId: req.userId }`. Today that user is always `dev-user-1`; when Clerk lands, the only change is `req.userId` will come from a verified JWT instead of a constant. No data model changes needed.

## Roadmap

| Week | Deliverable | Status |
| --- | --- | --- |
| 1 | React + Vite scaffold, kanban UI, CRUD, drag-and-drop | Done |
| 2 | Express API, Supabase + Prisma, real persistence | Done |
| 3 | Gmail + Outlook OAuth flows, email services, Claude classifier, cron scanner, settings panel | Done |
| 4 | Botpress ADK bot, scan now / deep scan, review queue UI | Done |
| 5 | Architecture refactor, Chrome extension JD parsing, Zai migration, multi-role classification | Done |
| 6 | Full-text JD search, tighten pre-filter | |
| 7 | Nudge system (in-app display + email reminders) | |
| 8 | Analytics dashboard UI | |
| 9 | Clerk auth integration (multi-user accounts), polish, loading states, error handling | |

## Future: Multi-User Account System

The app is designed for multi-tenancy from day one (see above). The planned account system will allow:
- Individual user accounts via Clerk authentication
- Each user connects their own Gmail/Outlook accounts through the Settings panel
- Email OAuth tokens are encrypted per-user and stored in the User model
- All application data, scan history, and nudges are scoped to the authenticated user
- The daily cron scan (`runFullScan()`) already iterates over all users with connected email accounts
- Future integration with WhatsApp to enable direct user-agent interaction
- Users will be able to send job posting links via WhatsApp to automatically add them to “Saved” or “Applied” jobs
- Natural language queries via WhatsApp (e.g., “How many applications are in interview stage?”, “What did I apply to this week?”)
- Ability to update job statuses, log notes, and trigger follow-up nudges directly through WhatsApp chat
- WhatsApp account linkage will be mapped to the authenticated user to maintain strict per-user data isolation
- Integration will be implemented via the WhatsApp Business API or providers like Twilio
- All WhatsApp interactions will be securely processed and scoped within the existing multi-tenant architecture

## Notes

- **Free Supabase pauses after 7 days idle.** If the backend logs `Can't reach database server`, unpause the project from the dashboard.
- The Supabase free tier exposes both DB URLs through Supavisor. `:6543` (`DATABASE_URL`, transaction mode, used by Prisma at runtime) needs `?pgbouncer=true`. `:5432` (`DIRECT_URL`, session mode, used by migrations) does not.
- Auth is intentionally a stub. Wiring Clerk is a Week 9 task: replace `server/src/auth.ts` with JWT verification, wrap `<App>` in `<ClerkProvider>`, send the token as a `Bearer` header from `src/lib/api.ts`. Existing `dev-user-1` data stays put.
- OAuth tokens are encrypted at rest using AES-256-GCM (`server/src/lib/crypto.ts`). Email body content is never persisted — transient use during classification only.
- The Botpress ADK bot is a pure LLM gateway — it has no database access, no email fetching, no encryption. All it does is receive text and return structured JSON via `adk.zai.extract()`.
- Outlook uses MSAL token cache (serialized + encrypted) rather than a single refresh token. The full cache is re-serialized after each token refresh.
- The `.mcp.json` at the project root configures the Botpress ADK MCP server for Claude Code, enabling AI-assisted development and testing of bot actions.
