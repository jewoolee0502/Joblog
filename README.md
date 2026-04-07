# Joblog

An AI-powered job application tracker. Personal CRM for high-volume job search — Kanban pipeline, automated stage detection from email (Gmail + Outlook), follow-up nudges, and analytics.

## Status

**Week 1 — Scaffold + Kanban (in progress)**

- [x] Vite + React + TypeScript + Tailwind scaffold
- [x] Application domain types & status enum (PRD §4.1, §4.2)
- [x] Zustand store with localStorage persistence + CRUD
- [x] Kanban board with drag-and-drop (`@dnd-kit`)
- [x] Application create/edit dialog (full PRD §4.1 fields)
- [x] Stale-card highlighting per PRD §4.5 thresholds
- [x] Summary metrics bar (response rate, interview rate, offers)

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Roadmap

| Week | Deliverable                                                      |
| ---- | ---------------------------------------------------------------- |
| 1    | React + Vite scaffold, kanban UI, CRUD, drag-and-drop ← **here** |
| 2    | Auth (Clerk), Supabase DB, Express API, real persistence         |
| 3    | Gmail OAuth, inbox polling, keyword classifier                   |
| 4    | Outlook OAuth + Microsoft Graph polling                          |
| 5    | Claude API classifier, auto-advance, undo toast                  |
| 6    | Browser extension (LinkedIn + Greenhouse)                        |
| 7    | Follow-up nudge cron + in-app display                            |
| 8    | Analytics dashboard (funnel, response by source)                 |
| 9    | Polish: PWA, error handling, README                              |

## Architecture (planned)

| Layer    | Tech                                                         |
| -------- | ------------------------------------------------------------ |
| Frontend | React 18 + TS + Vite + Tailwind                              |
| State    | Zustand (currently localStorage; will move to API in Week 2) |
| Backend  | Node.js + Express                                            |
| DB       | PostgreSQL via Supabase + Prisma                             |
| Auth     | Clerk                                                        |
| Email AI | Claude API                                                   |
| Hosting  | Vercel + Railway + Supabase                                  |
