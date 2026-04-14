# Product Requirements Document — Joblog
**Author:** Jewoo Lee | **Version:** 1.1 | **Last Updated:** April 13, 2026 | **Status:** In Progress

---

## 1. Problem & Vision

Job seekers managing 10–50+ applications per week have no system that automatically tracks application state from email signals. Spreadsheets and Notion require constant manual updates. No tool auto-advances stages, surfaces follow-up nudges, or provides analytics on outreach effectiveness.

**Joblog** is a personal, automated job application CRM — the single source of truth for every application in flight.

**Target user:** Technical job seekers running 20+ concurrent applications who use Gmail or Outlook.

### Success Metrics

| Metric | Target |
|---|---|
| Time to log a new application | < 10s (via extension) |
| Auto-detected stage transitions | ≥ 70% |
| Follow-up reminder accuracy | ≥ 90% |
| Response rate visibility | < 2 clicks |

---

## 2. Scope

### In Scope (v1.0 — personal use only)
- User accounts (email/password + Google/Microsoft OAuth via Clerk)
- Application cards with structured metadata + kanban board
- Gmail + Outlook OAuth integration; Botpress bot scans both inboxes daily at 7 AM EST and auto-classifies emails
- Chrome extension (Chrome only) for one-click job capture with Save/Applied buttons
- JD snapshot storage with full-text search
- Follow-up nudge system (in-app + optional email digest)
- Analytics dashboard (funnel, response rates, trends)
- Status change timeline per application
- Manual override for all automated actions

### Out of Scope (v1.0)
Mobile native app, LinkedIn API, multi-user/team, calendar integration, offer comparison, ATS integrations, Firefox extension, public release / free tier

### Future (v2.0+)
AI interview prep, auto-draft follow-ups, salary benchmarking, network graph, mobile push notifications

---

## 3. User Stories

### Application Capture
| ID | Story | P |
|---|---|---|
| U-01 | Open Chrome extension on any job listing → choose **Save** (SAVED) or **Applied** (APPLIED) → extension auto-scrapes JD and creates card on kanban | P0 |
| U-02 | Manually create application card via dashboard form | P0 |
| U-03 | JD snapshot stored permanently (survives posting takedown) | P0 |
| U-04 | Tag applications with custom labels (e.g. "Toronto", "PM", "Referral") | P1 |
| U-05 | Bulk-import from LinkedIn data export CSV | P2 |
| U-25 | Full-text search across all saved JD snapshots | P1 |

### Stage Management
| ID | Story | P |
|---|---|---|
| U-06 | Kanban board view of all applications by stage | P0 |
| U-07 | Drag cards between columns to update stage | P0 |
| U-08 | Full timeline of every status change per application | P1 |
| U-09 | Stages auto-update when relevant company email received | P0 |
| U-10 | Notification before automated transition; can cancel | P1 |

### Email Automation
| ID | Story | P |
|---|---|---|
| U-11 | Connect Gmail via OAuth | P0 |
| U-11b | Connect Outlook via OAuth (both connected simultaneously) | P0 |
| U-12 | Botpress bot scans both inboxes daily at 7 AM EST and auto-updates kanban | P0 |
| U-13 | See which email triggered a stage change + summary | P1 |
| U-14 | Disconnect Gmail/Outlook at any time; tokens revoked | P0 |
| U-15 | Unclear emails flagged for manual review, not silently dropped | P1 |

### Reminders & Nudges
| ID | Story | P |
|---|---|---|
| U-16 | Nudge when "Applied" stale > 7 days | P0 |
| U-17 | Nudge when screening/interview stale > 3 days | P1 |
| U-18 | Configurable stale thresholds per stage | P2 |
| U-19 | Daily digest email of applications needing action | P2 |

### Analytics
| ID | Story | P |
|---|---|---|
| U-20 | Overall apply-to-response rate | P0 |
| U-21 | Response rates by outreach channel | P1 |
| U-22 | Trend chart: applications sent vs responses over time | P1 |
| U-23 | Average time-in-stage across applications | P2 |
| U-24 | CSV data export | P1 |

---

## 4. Functional Requirements

### 4.1 Application Card Fields
`id`, `user_id`, `company_name` (req), `role_title` (req), `job_url`, `jd_snapshot`, `status`, `source` (linkedin | company_site | cold_email | referral | job_board | other), `applied_at`, `last_updated_at`, `contact_name`, `contact_email`, `notes`, `tags[]`, `salary_range`, `location`, `is_remote`

### 4.2 Application Stages
```
SAVED → APPLIED → ACKNOWLEDGED → SCREENING → INTERVIEW → FINAL_ROUND → OFFER → ACCEPTED
                                                                              ↘ REJECTED (any stage)
                                                                              ↘ WITHDRAWN (any stage)
                                                                              ↘ GHOSTED (manual)
```

### 4.3 Email Classification Pipeline

**Integration:** Gmail and Outlook are both connected via OAuth. A Botpress autonomous agent triggers daily at 7:00 AM EST, fetches unread emails from both inboxes via the Joblog server's internal API endpoints, and matches sender domains against tracked companies.

**Botpress workflow:**
1. Calculate yesterday's date window (EST-aware, handles DST)
2. Fetch active (non-terminal) applications via `GET /api/internal/applications`
3. Fetch unread emails from both Gmail + Outlook via `POST /api/internal/fetch-emails`
4. For each email, the autonomous agent (using `claude-sonnet-4-20250514`):
   - Matches sender to a tracked application's company domain or contact email
   - Classifies email into: `ACKNOWLEDGEMENT`, `SCREENING_REQUEST`, `INTERVIEW_INVITE`, `REJECTION`, `OFFER`, `UNCLEAR`
   - Scores confidence 0.0–1.0
   - If confidence ≥ threshold → calls `POST /api/internal/update-status`
   - If UNCLEAR or below threshold → calls `POST /api/internal/flag-review`

**Stage mapping:**
ACKNOWLEDGEMENT→ACKNOWLEDGED, SCREENING_REQUEST→SCREENING, INTERVIEW_INVITE→INTERVIEW, REJECTION→REJECTED, OFFER→OFFER, UNCLEAR→no change (flag for review)

**Confidence rules:** ≥ 0.75 → auto-advance + undo toast (10s). < 0.75 → flag for manual review. REJECTED requires ≥ 0.85.

### 4.4 Browser Extension

**Supported sites (Chrome only):** LinkedIn, Greenhouse, Lever, Workday, generic fallback.

**Flow:** User opens extension on any job page → extension auto-scrapes page for company name, role title, URL, and full JD text → popup displays two buttons: **Save** (creates card with SAVED status) and **Applied** (creates card with APPLIED status) → POST /api/applications → success toast.

### 4.5 Nudge System

**Schedule:** Botpress scheduled workflow (daily).

**Default stale thresholds:** APPLIED 7d, ACKNOWLEDGED 5d, SCREENING 4d, INTERVIEW 3d, FINAL_ROUND 3d.

**Delivery:** In-app amber card highlight + stale badge on kanban. Optional daily email digest (future).

### 4.6 Analytics Dashboard
- Funnel chart (applications per stage)
- Key metrics: total apps, response rate, interview rate, offer rate, avg days to first response
- Response rate by source (bar chart)
- Applications over time (line chart)
- Time-in-stage heatmap (v1.1)

---

## 5. Non-Functional Requirements

- **Performance:** Dashboard LCP < 1.5s, extension capture < 2s
- **Security:** OAuth tokens encrypted at rest (AES-256-GCM), email bodies never persisted, HTTPS only, full data export/delete (GDPR)
- **Reliability:** Graceful token expiry re-auth, all auto-transitions reversible, Botpress workflow retries on transient failures
- **Accessibility:** WCAG 2.1 AA, keyboard-navigable kanban, screen reader labels

---

## 6. UX

### Pages
| Route | Description |
|---|---|
| `/` | Landing / login |
| `/dashboard` | Kanban board |
| `/applications/:id` | Application detail + timeline |
| `/analytics` | Response rate dashboard |
| `/settings` | Email connections, nudge prefs, account |
| `/needs-action` | Stale/flagged cards |

### Kanban Board
- Horizontal scroll desktop, vertical stack mobile
- Columns: SAVED, APPLIED, ACKNOWLEDGED, SCREENING, INTERVIEW, FINAL_ROUND, OFFER, REJECTED, GHOSTED
- Card: company name, role title, location, days in stage, tag chips, amber highlight if stale, blue "Auto" badge if email-triggered
- Click → edit dialog with detail, timeline, notes
- "+ Add" per column for quick-add

### Review Queue
UNCLEAR / low-confidence emails → "Needs Review" badge → modal with email subject, sender, snippet, classification guess + confidence → user picks correct classification or dismisses.

---

## 7. Milestones

| Week | Deliverable | Status |
|---|---|---|
| 1 | React scaffold, kanban UI with mock data, card CRUD, drag-and-drop | ✅ Done |
| 2 | Supabase DB, Express API, Prisma ORM, real persistence | ✅ Done |
| 3 | Gmail + Outlook OAuth flows, Botpress bot setup, email fetching, internal API routes | 🚧 In Progress |
| 4 | Botpress daily inbox scan end-to-end, auto stage advance, undo toast | Planned |
| 5 | Chrome extension (Save + Applied buttons, JD auto-scrape) | Planned |
| 6 | Full-text JD search | Planned |
| 7 | Nudge system (Botpress scheduled workflow + in-app display) | Planned |
| 8 | Analytics dashboard UI | Planned |
| 9 | Clerk auth integration, polish, loading states, error handling | Planned |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Gmail/Outlook API rate limits | Exponential backoff; single daily scan minimizes risk |
| Microsoft token expiry | MSAL silent refresh, graceful re-auth prompt |
| Botpress workflow reliability | Timeout limits (10 min), max iteration cap (80 steps), error logging |
| OAuth token revocation | Graceful re-auth prompt, never block UI on polling failure |
| False positive rejections | Require confidence ≥ 0.85 for REJECTED, always show undo |
| JD storage cost | Cap at 10,000 chars, truncate on capture |
| Chrome Web Store review delay | Sideload in dev mode for personal use; store submission deferred |

---

## 9. Resolved Decisions

1. Gmail + Outlook connected simultaneously via OAuth; Botpress bot scans both inboxes daily at 7 AM EST using `claude-sonnet-4-20250514` for classification.
2. Dedicated REJECTED/GHOSTED column on kanban — all rejected and ghosted applications visible.
3. Personal use only for v1.
4. Full-text search across JD snapshots — yes.
5. Chrome only for v1.
6. No province-level analytics filtering; location shown on kanban card instead.
7. Chrome extension uses two-button UX (Save / Applied) — no confirmation step, auto-scrapes JD from page.
8. Botpress handles all background automation (no Supabase Edge Functions).
