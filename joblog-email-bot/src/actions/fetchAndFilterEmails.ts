import { Action, z } from '@botpress/runtime';
import { query } from '../utils/supabase';
import { buildDomainLookup, matchEmailToApplications } from '../utils/domainMatcher';
import { fetchGmailEmails } from '../utils/gmailFetcher';
import { fetchOutlookEmails } from '../utils/outlookFetcher';
import type { NormalizedEmail, ApplicationRow, ApplicationMatch } from '../utils/types';
import { TERMINAL_STATUSES } from '../utils/constants';

// Import the pre-filter from scanUserEmails (we'll move it to a shared util)
// For now, inline a reference — the actual function is in scanUserEmails.ts
// We need to extract isObviouslyNotJobRelated to a shared location

function getYesterdayWindow(): Date {
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const yesterday = new Date(estNow);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return yesterday;
}

function isObviouslyNotJobRelated(email: NormalizedEmail): boolean {
  const domain = email.fromDomain.toLowerCase();
  const subject = email.subject.toLowerCase();
  const from = email.from.toLowerCase();

  if (!subject.trim()) return true;

  // ===== REMINDERS: Skip — no new status change =====
  if (/reminder|rappel|don't forget|please complete|finish your/i.test(subject)) return true;

  // ===== WHITELIST: Always keep job application status emails =====
  const jobKeywords = [
    // English
    /your application/i, /application to/i, /applied to/i, /you applied/i,
    /thank you for applying/i, /thanks for applying/i,
    /we received your/i, /your candidacy/i,
    /regret to inform/i, /move forward with other/i, /not moving forward/i,
    /position has been filled/i,
    /offer letter/i, /job offer/i, /extend.*offer/i,
    /next steps.*application/i, /application.*status/i, /application.*update/i,
    /regarding your application/i,
    /schedule.*call/i, /schedule.*meeting/i, /we'd like to/i, /we would like to/i,
    /coding test/i, /coding challenge/i, /online assessment/i, /OA invite/i,
    /technical assessment/i, /take-home/i, /complete.*assessment/i,
    // French
    /merci d'avoir postulé/i, /suivez l'évolution/i,
    /candidature/i, /votre candidature/i, /poste/i, /entretien/i,
    /évaluation/i, /votre évaluation/i,
    // Hiring platforms (Workday, Greenhouse, etc.)
    /Software Engineer/i, /Developer/i, /Engineering/i,
  ];

  if (jobKeywords.some((p) => p.test(subject) || p.test(email.bodySnippet?.toLowerCase() ?? ''))) {
    return false; // Always send to LLM
  }

  // ===== LINKEDIN: Block alerts/news/marketing, keep application updates =====
  if (domain.includes('linkedin.com')) {
    // Block specific non-job senders
    if (from.includes('jobalerts-noreply') || from.includes('editors-noreply') ||
        from.includes('newsletters-noreply') || from.includes('security-noreply') ||
        from.includes('linkedin@em.linkedin.com') || from.includes('jobs-noreply@linkedin.com')) {
      // But keep jobs-noreply if subject mentions application
      if (from.includes('jobs-noreply') && (subject.includes('application') || subject.includes('applied'))) {
        return false;
      }
      return true;
    }
    return false; // Keep other LinkedIn emails (could be recruiter messages about applications)
  }

  // ===== INDEED: Block job suggestions, keep application confirmations =====
  if (domain.includes('indeed.com')) {
    // indeed "donotreply@match" and "invitetoapply@match" are job board suggestions
    if (from.includes('match.indeed.com') || from.includes('invitetoapply')) return true;
    return false; // Keep actual Indeed application emails
  }

  // ===== DOMAIN BLOCKLIST =====
  const skipDomains = [
    // Social / messaging
    'discord.com', 'quora.com', 'reddit.com', 'tiktok.com', 'instagram.com', 'facebook.com',
    // Shopping
    'grailed.com', 'musinsa.com', 'brownsshoes.com', 'sunglasshut.com', 'floraqueen.com', 'uniqlo.ca',
    // Ride / food / delivery
    'uber.com', 'lyftmail.com', 'starbucks.com',
    // Streaming / entertainment
    'spotify.com', 'chess.com', 'youtube.com', 'netflix.com',
    // Banking / finance / payments
    'td.com', 'email-td.com', 'interac.ca', 'hanacard.co.kr', 'hanafn.com',
    'tossbank.com', 'tossinvest.com', 'shinhan.com', 'sktelecom.com',
    // Utilities / bills
    'hydro.qc.ca', 'videotron.com', 'communauto.com', 'communauto.ca',
    'buildingstack.com', 'artm.quebec',
    // Travel / tourism
    'aircanada.com', 'viarail.ca', 'holafly.com', 'tremblant.ca',
    'qatarairways.com', 'egyptair.com', 'flyasiana.com',
    'sagradafamilia.org', 'bsmsa.cat', 'covermanager.com', 'lapedrera.com',
    // News / newsletters
    'substack.com',
    // Dev tools (account notifications only — if they send a job app email, it comes from a different sender)
    'github.com', 'gitlab.com', 'vercel.com', 'render.com', 'supabase.com',
    'codesandbox.io', 'postman.com', 'leetcode.com', 'anaconda.com',
    'botpress.com', 'botpress.cloud', 'openai.com',
    'grammarly.com', 'datacamp.com', 'gitroll.io', 'lovable.dev',
    'apollographql.com', 'spline.design', 'databricks.com', 'brilliant.org',
    'devpost.com', 'mlh.io',
    // NOTE: Do NOT add hackerearth.com, hackerrank.com, codility.com, codesignal.com,
    // karat.com, greenhouse.io, lever.co, myworkday.com, workday.com, ashbyhq.com,
    // smartrecruiters.com, icims.com — these are hiring/OA platforms
    // Government (non-job)
    'auth.canada.ca', 'saaq.gouv.qc.ca', 'authentification.quebec.ca',
    'revenuquebec.ca', 'cra-arc.gc.ca', 'francais-enligne.quebec',
    'mifi.notification.gouv.qc.ca', 'cic.gc.ca', 'clicsante.ca',
    // Apple / Google (account notifications)
    'apple.com', 'id.apple.com', 'accounts.google.com',
    // Real estate
    'showmojo.com', 'kw.com',
    // Misc personal
    'luma-mail.com', 'splitwise.com', 'livefootballtickets.com',
    'goodreads.com', 'noreply.com', 'qemailserver.com',
    'communauto.ca', 'fifa.com', 'mailing.fifa.com',
  ];

  if (skipDomains.some((d) => domain === d || domain.endsWith('.' + d))) return true;

  // ===== SENDER PATTERN BLOCKLIST =====
  // These sender patterns are always non-job regardless of domain
  if (from.includes('noreply') && (
    from.includes('github') || from.includes('apple') || from.includes('google') ||
    from.includes('discord') || from.includes('uber') || from.includes('spotify') ||
    from.includes('youtube') || from.includes('vercel') || from.includes('supabase')
  )) return true;

  // ===== SUBJECT PATTERN BLOCKLIST =====
  const skipSubjectPatterns = [
    // Marketing / promos
    /\d+% off/i, /promo/i, /expires soon/i, /price drop/i, /save \d+/i,
    /off your/i, /don't miss/i, /last chance/i, /limited time/i,
    /deal/i, /sale on/i, /shop now/i, /free shipping/i, /discount/i,
    /exclusive offer/i, /special offer/i, /flash sale/i, /glow.up/i,
    // Digests / newsletters
    /weekly digest/i, /newsletter/i, /top picks/i, /this week/i,
    /what's happening/i, /what's new/i, /monthly update/i, /monthly statement/i,
    /product update/i, /update available/i, /supa update/i,
    // Account / billing / receipts / payments
    /your .* statement/i, /receipt from/i, /your receipt/i, /your bill/i,
    /invoice/i, /payment confirmation/i, /payment receipt/i, /e-bill/i,
    /billing/i, /subscription/i, /your.*membership/i, /your.*plan\b/i,
    /your .* account/i, /account.*update/i, /account.*change/i,
    // Security / auth
    /security alert/i, /security code/i, /sign.in/i, /new device/i, /logged in/i,
    /verify your email/i, /password/i, /was added to your account/i,
    /security info/i, /login code/i, /authentication/i, /보안/i,
    // Social / messaging
    /mentioned you/i, /sent you a message/i, /invited you to/i, /replied to/i,
    /new message/i, /streak/i, /run cancelled/i,
    // Terms / policy / legal
    /terms of service/i, /policy update/i, /terms.*updated/i, /privacy policy/i,
    /약관/i, /개정/i, /광고/i,
    // Orders / shipping / travel
    /your order/i, /delivery/i, /shipped/i, /tracking/i,
    /boarding pass/i, /flight.*confirmation/i, /check in for/i, /seat change/i,
    /booking confirmation/i, /reservation/i, /your trip/i, /on board/i,
    // Events / hackathons / community
    /hackathon/i, /happening.*week/i, /registration/i,
    // Finance / bills
    /your balance/i, /recharge/i, /end trip/i, /upcoming payment/i,
    /proof of insurance/i, /tax.*slip/i, /tax.*return/i, /tax.*filing/i,
    /votre facture/i, /votre relevé/i,
    // Job BOARD notifications (NOT application status updates)
    /new jobs? posted/i, /is hiring/i, /looking for a new job/i,
    /jobs matching/i, /job alert/i, /jobs for you/i, /recommended jobs/i,
    /similar jobs/i, /jobs you might/i, /companies.*hiring/i,
    /keep your.*access/i, /priority access/i,
    // Misc non-job
    /welcome to/i, /getting started/i, /how to/i, /tips to/i,
    /import your/i, /your.*workspace/i, /your.*project/i,
    /updates from/i, /confirmed$/i, /end trip/i,
    /lease renewal/i, /property/i, /property visit/i, /property list/i,
    /FIFA/i, /World Cup/i, /Premier League/i, /champions league/i,
    /GCKey/i, /Interac/i, /e-Transfer/i,
  ];

  if (skipSubjectPatterns.some((p) => p.test(subject))) return true;

  // ===== PERSONAL EMAIL ADDRESSES =====
  const personalDomains = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'me.com'];
  if (personalDomains.some((d) => domain === d)) return true;

  return false;
}

// Serializable email type for workflow step caching
const emailSchema = z.object({
  messageId: z.string(),
  from: z.string(),
  fromDomain: z.string(),
  subject: z.string(),
  bodySnippet: z.string(),
  receivedAt: z.string(),
  provider: z.enum(['gmail', 'outlook']),
});

const matchedEmailSchema = z.object({
  email: emailSchema,
  appId: z.string(),
  appCompanyName: z.string(),
  appRoleTitle: z.string(),
  appStatus: z.string(),
});

export const fetchAndFilterEmails = new Action({
  name: 'fetchAndFilterEmails',
  description: 'Fetch emails from Gmail/Outlook, deduplicate, pre-filter, and domain-match',
  input: z.object({
    userId: z.string(),
    sinceOverride: z.string().optional(),
  }),
  output: z.object({
    totalFetched: z.number(),
    totalFiltered: z.number(),
    matched: z.array(matchedEmailSchema),
    unmatched: z.array(emailSchema),
    errors: z.array(z.string()),
  }),

  async handler({ input }) {
    const errors: string[] = [];
    const since = input.sinceOverride ? new Date(input.sinceOverride) : getYesterdayWindow();

    console.log(`[fetch] Fetching emails since ${since.toISOString()} for user ${input.userId}`);

    // Fetch applications for domain matching
    const applications = await query<ApplicationRow>(
      'SELECT id, user_id, company_name, role_title, job_url, status, source, contact_email FROM applications WHERE user_id = $1',
      [input.userId],
    );
    const domainMap = buildDomainLookup(applications);

    // Fetch emails
    const allEmails: NormalizedEmail[] = [];

    try {
      allEmails.push(...await fetchGmailEmails(input.userId, since));
    } catch (err) {
      errors.push(`Gmail: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      allEmails.push(...await fetchOutlookEmails(input.userId, since));
    } catch (err) {
      errors.push(`Outlook: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Deduplicate
    const seen = new Set<string>();
    const deduped = allEmails.filter((e) => {
      if (seen.has(e.messageId)) return false;
      seen.add(e.messageId);
      return true;
    });

    const totalFetched = deduped.length;

    // Pre-filter + domain match
    const matched: Array<{ email: NormalizedEmail; app: ApplicationMatch }> = [];
    const unmatched: NormalizedEmail[] = [];
    let filtered = 0;

    for (const email of deduped) {
      const candidates = matchEmailToApplications(email, domainMap);

      if (candidates.length > 0) {
        // Matched — take the first non-terminal candidate
        const activeCandidate = candidates.find((c) => !TERMINAL_STATUSES.includes(c.status as any));
        if (activeCandidate) {
          matched.push({ email, app: activeCandidate });
        }
      } else if (isObviouslyNotJobRelated(email)) {
        filtered++;
      } else {
        unmatched.push(email);
      }
    }

    console.log(`[fetch] ${totalFetched} fetched, ${filtered} pre-filtered, ${matched.length} matched, ${unmatched.length} unmatched → ${matched.length + unmatched.length} to process`);

    // Serialize for workflow caching (Dates → ISO strings)
    return {
      totalFetched,
      totalFiltered: filtered,
      matched: matched.map((m) => ({
        email: {
          messageId: m.email.messageId,
          from: m.email.from,
          fromDomain: m.email.fromDomain,
          subject: m.email.subject,
          bodySnippet: m.email.bodySnippet,
          receivedAt: m.email.receivedAt instanceof Date ? m.email.receivedAt.toISOString() : String(m.email.receivedAt),
          provider: m.email.provider,
        },
        appId: m.app.id,
        appCompanyName: m.app.companyName,
        appRoleTitle: m.app.roleTitle,
        appStatus: m.app.status,
      })),
      unmatched: unmatched.map((e) => ({
        messageId: e.messageId,
        from: e.from,
        fromDomain: e.fromDomain,
        subject: e.subject,
        bodySnippet: e.bodySnippet,
        receivedAt: e.receivedAt instanceof Date ? e.receivedAt.toISOString() : String(e.receivedAt),
        provider: e.provider,
      })),
      errors,
    };
  },
});
