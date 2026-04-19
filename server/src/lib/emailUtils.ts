import { STAGE_ORDER, EMAIL_BODY_MAX_CHARS } from './constants.js';

/** Extract the email address from a "Name <email>" or plain email string. */
export function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/** Extract domain from an email address. */
export function extractDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

/**
 * Extract the root domain from a URL, stripping common subdomains
 * like `careers.`, `jobs.`, `boards.`, `apply.`, `www.`.
 */
export function extractRootDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // Strip common hiring-platform subdomains
    const stripped = hostname.replace(
      /^(careers|jobs|boards|apply|hire|recruiting|www)\./,
      '',
    );
    return stripped;
  } catch {
    return '';
  }
}

/**
 * Normalize a company name for fuzzy matching:
 * lowercase, strip common suffixes and punctuation.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|corp|ltd|limited|co|company|technologies|tech)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Check whether `targetStatus` is a forward move from `currentStatus`
 * in the application pipeline. REJECTED is always allowed from any stage.
 */
export function isForwardTransition(
  currentStatus: string,
  targetStatus: string,
): boolean {
  if (targetStatus === 'REJECTED') return true;

  const currentIdx = STAGE_ORDER.indexOf(currentStatus as any);
  const targetIdx = STAGE_ORDER.indexOf(targetStatus as any);

  if (currentIdx === -1 || targetIdx === -1) return false;
  return targetIdx > currentIdx;
}

/**
 * Quick pre-filter to skip emails obviously not job application status updates.
 * Whitelist-first: if subject looks like a job update, always keep it.
 * Returns true if the email should be SKIPPED.
 */
export function isObviouslyNotJobRelated(email: { from: string; fromDomain: string; subject: string; bodySnippet?: string }): boolean {
  const domain = email.fromDomain.toLowerCase();
  const subject = email.subject.toLowerCase();
  const from = email.from.toLowerCase();

  if (!subject.trim()) return true;

  // ===== REMINDERS =====
  if (/reminder|rappel|don't forget|please complete|finish your/i.test(subject)) return true;

  // ===== WHITELIST: Always keep job application status emails =====
  const jobKeywords = [
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
    /merci d'avoir postulé/i, /suivez l'évolution/i,
    /candidature/i, /votre candidature/i, /poste/i, /entretien/i,
    /évaluation/i, /votre évaluation/i,
    /Software Engineer/i, /Developer/i, /Engineering/i,
  ];

  if (jobKeywords.some((p) => p.test(subject) || p.test(email.bodySnippet?.toLowerCase() ?? ''))) {
    return false;
  }

  // ===== LINKEDIN: Block alerts/news/marketing, keep application updates =====
  if (domain.includes('linkedin.com')) {
    if (from.includes('jobalerts-noreply') || from.includes('editors-noreply') ||
        from.includes('newsletters-noreply') || from.includes('security-noreply') ||
        from.includes('linkedin@em.linkedin.com') || from.includes('jobs-noreply@linkedin.com')) {
      if (from.includes('jobs-noreply') && (subject.includes('application') || subject.includes('applied'))) {
        return false;
      }
      return true;
    }
    return false;
  }

  // ===== INDEED: Block job suggestions =====
  if (domain.includes('indeed.com')) {
    if (from.includes('match.indeed.com') || from.includes('invitetoapply')) return true;
    return false;
  }

  // ===== DOMAIN BLOCKLIST =====
  const skipDomains = [
    'discord.com', 'quora.com', 'reddit.com', 'tiktok.com', 'instagram.com', 'facebook.com',
    'grailed.com', 'musinsa.com', 'brownsshoes.com', 'sunglasshut.com', 'floraqueen.com', 'uniqlo.ca',
    'uber.com', 'lyftmail.com', 'starbucks.com',
    'spotify.com', 'chess.com', 'youtube.com', 'netflix.com',
    'td.com', 'email-td.com', 'interac.ca', 'hanacard.co.kr', 'hanafn.com',
    'tossbank.com', 'tossinvest.com', 'shinhan.com', 'sktelecom.com',
    'hydro.qc.ca', 'videotron.com', 'communauto.com', 'communauto.ca',
    'buildingstack.com', 'artm.quebec',
    'aircanada.com', 'viarail.ca', 'holafly.com', 'tremblant.ca',
    'qatarairways.com', 'egyptair.com', 'flyasiana.com',
    'sagradafamilia.org', 'bsmsa.cat', 'covermanager.com', 'lapedrera.com',
    'substack.com',
    'github.com', 'gitlab.com', 'vercel.com', 'render.com', 'supabase.com',
    'codesandbox.io', 'postman.com', 'leetcode.com', 'anaconda.com',
    'botpress.com', 'botpress.cloud', 'openai.com',
    'grammarly.com', 'datacamp.com', 'gitroll.io', 'lovable.dev',
    'apollographql.com', 'spline.design', 'databricks.com', 'brilliant.org',
    'devpost.com', 'mlh.io',
    'auth.canada.ca', 'saaq.gouv.qc.ca', 'authentification.quebec.ca',
    'revenuquebec.ca', 'cra-arc.gc.ca', 'francais-enligne.quebec',
    'mifi.notification.gouv.qc.ca', 'cic.gc.ca', 'clicsante.ca',
    'apple.com', 'id.apple.com', 'accounts.google.com',
    'showmojo.com', 'kw.com',
    'luma-mail.com', 'splitwise.com', 'livefootballtickets.com',
    'goodreads.com', 'qemailserver.com', 'fifa.com', 'mailing.fifa.com',
  ];

  if (skipDomains.some((d) => domain === d || domain.endsWith('.' + d))) return true;

  // ===== SUBJECT PATTERN BLOCKLIST =====
  const skipSubjectPatterns = [
    /\d+% off/i, /promo/i, /expires soon/i, /price drop/i, /save \d+/i,
    /off your/i, /don't miss/i, /last chance/i, /limited time/i,
    /deal/i, /sale on/i, /shop now/i, /free shipping/i, /discount/i,
    /exclusive offer/i, /special offer/i, /flash sale/i,
    /weekly digest/i, /newsletter/i, /top picks/i, /this week/i,
    /what's happening/i, /what's new/i, /monthly update/i, /monthly statement/i,
    /product update/i, /update available/i, /supa update/i,
    /your .* statement/i, /receipt from/i, /your receipt/i, /your bill/i,
    /invoice/i, /payment confirmation/i, /payment receipt/i, /e-bill/i,
    /billing/i, /subscription/i, /your.*membership/i, /your.*plan\b/i,
    /your .* account/i, /account.*update/i, /account.*change/i,
    /security alert/i, /security code/i, /sign.in/i, /new device/i, /logged in/i,
    /verify your email/i, /password/i, /was added to your account/i,
    /security info/i, /login code/i, /authentication/i, /보안/i,
    /mentioned you/i, /sent you a message/i, /invited you to/i, /replied to/i,
    /new message/i, /streak/i, /run cancelled/i,
    /terms of service/i, /policy update/i, /terms.*updated/i, /privacy policy/i,
    /약관/i, /개정/i, /광고/i,
    /your order/i, /delivery/i, /shipped/i, /tracking/i,
    /boarding pass/i, /flight.*confirmation/i, /check in for/i, /seat change/i,
    /booking confirmation/i, /reservation/i, /your trip/i, /on board/i,
    /hackathon/i, /happening.*week/i, /registration/i,
    /your balance/i, /recharge/i, /end trip/i, /upcoming payment/i,
    /proof of insurance/i, /tax.*slip/i, /tax.*return/i, /tax.*filing/i,
    /votre facture/i, /votre relevé/i,
    /new jobs? posted/i, /is hiring/i, /looking for a new job/i,
    /jobs matching/i, /job alert/i, /jobs for you/i, /recommended jobs/i,
    /similar jobs/i, /jobs you might/i, /companies.*hiring/i,
    /keep your.*access/i, /priority access/i,
    /welcome to/i, /getting started/i, /how to/i, /tips to/i,
    /import your/i, /your.*workspace/i, /your.*project/i,
    /updates from/i, /confirmed$/i,
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

/**
 * Check if two role titles refer to the same position.
 * Only exact match after normalization (case/punctuation insensitive).
 */
export function fuzzyMatchRoleTitle(emailRole: string, appRole: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  return normalize(emailRole) === normalize(appRole);
}

/** Truncate a string to EMAIL_BODY_MAX_CHARS. */
export function truncateBody(body: string): string {
  return body.length > EMAIL_BODY_MAX_CHARS
    ? body.slice(0, EMAIL_BODY_MAX_CHARS)
    : body;
}
