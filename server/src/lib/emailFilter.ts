import type { NormalizedEmail } from './types.js';

/** Compute yesterday midnight EST — used as the default "since" window. */
export function getYesterdayWindow(): Date {
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const yesterday = new Date(estNow);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return yesterday;
}

/**
 * Fast pre-filter that rejects emails obviously unrelated to job applications.
 * Emails that pass this filter are sent to the LLM for classification.
 */
export function isObviouslyNotJobRelated(email: NormalizedEmail): boolean {
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

  // ===== INDEED: Block job suggestions, keep application confirmations =====
  if (domain.includes('indeed.com')) {
    if (from.includes('match.indeed.com') || from.includes('invitetoapply')) return true;
    return false;
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
    // Dev tools
    'github.com', 'gitlab.com', 'vercel.com', 'render.com', 'supabase.com',
    'codesandbox.io', 'postman.com', 'leetcode.com', 'anaconda.com',
    'botpress.com', 'botpress.cloud', 'openai.com',
    'grammarly.com', 'datacamp.com', 'gitroll.io', 'lovable.dev',
    'apollographql.com', 'spline.design', 'databricks.com', 'brilliant.org',
    'devpost.com', 'mlh.io',
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
  if (from.includes('noreply') && (
    from.includes('github') || from.includes('apple') || from.includes('google') ||
    from.includes('discord') || from.includes('uber') || from.includes('spotify') ||
    from.includes('youtube') || from.includes('vercel') || from.includes('supabase')
  )) return true;

  // ===== SUBJECT PATTERN BLOCKLIST =====
  const skipSubjectPatterns = [
    /\d+% off/i, /promo/i, /expires soon/i, /price drop/i, /save \d+/i,
    /off your/i, /don't miss/i, /last chance/i, /limited time/i,
    /deal/i, /sale on/i, /shop now/i, /free shipping/i, /discount/i,
    /exclusive offer/i, /special offer/i, /flash sale/i, /glow.up/i,
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
