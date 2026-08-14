/**
 * GTM stack detection from markup.
 *
 * Lives in `functions/_lib/` — Cloudflare Pages does not route files or
 * directories whose name begins with an underscore, so this is importable by
 * the Function without becoming an endpoint of its own. That is the only reason
 * shared code can live outside the handler file at all.
 *
 * Detection is deliberately signature-based rather than vendor-API-based. Every
 * client-side GTM tool has to load a script from a domain it controls, so the
 * HTML names it. That is free, precise, and needs no BuiltWith subscription —
 * and unlike BuiltWith's free endpoint, which returns category counts only, it
 * gives us the actual tool names the comparison component needs.
 *
 * What it CANNOT see: server-side tooling, anything behind a tag manager that
 * loads on consent, and warehouse-native stacks. A quiet page is weak evidence
 * of absence, not proof — which is why the scorer is told to treat "nothing
 * detected" as a prompt to look at the page, not as a zero.
 */

export type StackCategory =
  | "analytics"
  | "product-analytics"
  | "tag-manager"
  | "crm-marketing"
  | "cdp"
  | "chat-support"
  | "scheduling"
  | "session-replay"
  | "experimentation"
  | "email-capture"
  | "ats"
  | "docs"
  | "trust-compliance";

interface Signature {
  name: string;
  category: StackCategory;
  /** Matched against the raw HTML, case-insensitively. */
  patterns: string[];
}

/**
 * Ordered by nothing in particular — the matcher checks all of them. Patterns
 * are host fragments rather than full URLs because vendors move paths far more
 * often than they move domains.
 */
const SIGNATURES: Signature[] = [
  // ── analytics ────────────────────────────────────────────────────────────
  { name: "Google Analytics", category: "analytics", patterns: ["googletagmanager.com/gtag", "google-analytics.com", "gtag('config'"] },
  { name: "Plausible", category: "analytics", patterns: ["plausible.io/js"] },
  { name: "Fathom", category: "analytics", patterns: ["cdn.usefathom.com"] },
  { name: "Simple Analytics", category: "analytics", patterns: ["scripts.simpleanalyticscdn.com"] },
  { name: "Matomo", category: "analytics", patterns: ["matomo.js", "piwik.js"] },
  { name: "Cloudflare Web Analytics", category: "analytics", patterns: ["static.cloudflareinsights.com"] },
  { name: "Vercel Analytics", category: "analytics", patterns: ["/_vercel/insights"] },

  // ── product analytics ────────────────────────────────────────────────────
  { name: "PostHog", category: "product-analytics", patterns: ["posthog.com/static", "posthog.init", "app.posthog.com"] },
  { name: "Mixpanel", category: "product-analytics", patterns: ["cdn.mxpnl.com", "mixpanel.init"] },
  { name: "Amplitude", category: "product-analytics", patterns: ["cdn.amplitude.com", "amplitude.getInstance"] },
  { name: "Heap", category: "product-analytics", patterns: ["cdn.heapanalytics.com"] },
  { name: "June", category: "product-analytics", patterns: ["analytics.june.so"] },

  // ── tag manager ──────────────────────────────────────────────────────────
  { name: "Google Tag Manager", category: "tag-manager", patterns: ["googletagmanager.com/gtm.js", "GTM-"] },

  // ── CRM & marketing automation ───────────────────────────────────────────
  { name: "HubSpot", category: "crm-marketing", patterns: ["js.hs-scripts.com", "js.hsforms.net", "hs-analytics.net"] },
  { name: "Marketo", category: "crm-marketing", patterns: ["munchkin.marketo.net"] },
  { name: "Pardot", category: "crm-marketing", patterns: ["pi.pardot.com"] },
  { name: "Salesforce", category: "crm-marketing", patterns: ["salesforceliveagent", "force.com"] },
  { name: "Customer.io", category: "crm-marketing", patterns: ["customer.io/track"] },
  { name: "Klaviyo", category: "crm-marketing", patterns: ["static.klaviyo.com"] },
  { name: "Attio", category: "crm-marketing", patterns: ["attio.com/web"] },

  // ── CDP ──────────────────────────────────────────────────────────────────
  { name: "Segment", category: "cdp", patterns: ["cdn.segment.com", "analytics.load("] },
  { name: "RudderStack", category: "cdp", patterns: ["rudderlabs.com", "rudderstack.com"] },
  { name: "Tealium", category: "cdp", patterns: ["tags.tiqcdn.com"] },

  // ── chat & support ───────────────────────────────────────────────────────
  { name: "Intercom", category: "chat-support", patterns: ["widget.intercom.io", "intercomSettings"] },
  { name: "Drift", category: "chat-support", patterns: ["js.driftt.com"] },
  { name: "Crisp", category: "chat-support", patterns: ["client.crisp.chat"] },
  { name: "Zendesk", category: "chat-support", patterns: ["static.zdassets.com", "zendesk.com/embeddable"] },
  { name: "Front", category: "chat-support", patterns: ["chat-assets.frontapp.com"] },
  { name: "Pylon", category: "chat-support", patterns: ["widget.usepylon.com"] },

  // ── scheduling ───────────────────────────────────────────────────────────
  { name: "Calendly", category: "scheduling", patterns: ["assets.calendly.com", "calendly.com/"] },
  { name: "Chili Piper", category: "scheduling", patterns: ["js.chilipiper.com"] },
  { name: "Cal.com", category: "scheduling", patterns: ["cal.com/embed", "app.cal.com"] },

  // ── session replay ───────────────────────────────────────────────────────
  { name: "Hotjar", category: "session-replay", patterns: ["static.hotjar.com"] },
  { name: "FullStory", category: "session-replay", patterns: ["edge.fullstory.com"] },
  { name: "LogRocket", category: "session-replay", patterns: ["cdn.logrocket.io", "cdn.lr-ingest.io"] },
  { name: "Microsoft Clarity", category: "session-replay", patterns: ["clarity.ms/tag"] },

  // ── experimentation ──────────────────────────────────────────────────────
  { name: "Optimizely", category: "experimentation", patterns: ["cdn.optimizely.com"] },
  { name: "VWO", category: "experimentation", patterns: ["dev.visualwebsiteoptimizer.com"] },
  { name: "Statsig", category: "experimentation", patterns: ["api.statsig.com", "featureassets.org"] },

  // ── email capture ────────────────────────────────────────────────────────
  { name: "Loops", category: "email-capture", patterns: ["app.loops.so"] },
  { name: "ConvertKit", category: "email-capture", patterns: ["convertkit.com", "ck.page"] },
  { name: "Mailchimp", category: "email-capture", patterns: ["list-manage.com", "chimpstatic.com"] },
  { name: "beehiiv", category: "email-capture", patterns: ["beehiiv.com/subscribe", "embeds.beehiiv.com"] },
  { name: "Substack", category: "email-capture", patterns: ["substack.com/embed", "substackcdn.com"] },

  // ── applicant tracking ───────────────────────────────────────────────────
  // Also the single best "this company has real hiring operations" tell, which
  // is why the stage detector reads these too.
  { name: "Greenhouse", category: "ats", patterns: ["boards.greenhouse.io", "job-boards.greenhouse.io"] },
  { name: "Lever", category: "ats", patterns: ["jobs.lever.co"] },
  { name: "Ashby", category: "ats", patterns: ["jobs.ashbyhq.com"] },
  { name: "Workable", category: "ats", patterns: ["apply.workable.com"] },
  { name: "Rippling", category: "ats", patterns: ["ats.rippling.com"] },

  // ── docs ─────────────────────────────────────────────────────────────────
  { name: "Mintlify", category: "docs", patterns: ["mintlify.com", "mintlify.b-cdn.net"] },
  { name: "ReadMe", category: "docs", patterns: ["readme.io", "readme.com"] },
  { name: "GitBook", category: "docs", patterns: ["gitbook.io", "gitbook.com"] },

  // ── trust & compliance ───────────────────────────────────────────────────
  // Strong maturity marker: almost nobody stands one of these up before a
  // customer's security review forces it.
  { name: "Vanta", category: "trust-compliance", patterns: ["app.vanta.com", "vanta.com/trust"] },
  { name: "Drata", category: "trust-compliance", patterns: ["app.drata.com", "trust.drata.com"] },
  { name: "SecureFrame", category: "trust-compliance", patterns: ["secureframe.com/trust"] },
  { name: "SafeBase", category: "trust-compliance", patterns: ["safebase.io"] },
];

export interface DetectedTool {
  name: string;
  category: StackCategory;
}

/**
 * The categories a scorer expects an intentional GTM setup to cover.
 *
 * Not every company needs all of them — but a company with nothing in
 * `analytics`, `crm-marketing` and `email-capture` has no way to see or capture
 * demand, and that is the observation the dimension exists to make.
 */
export const CORE_GTM_CATEGORIES: StackCategory[] = [
  "analytics",
  "crm-marketing",
  "email-capture",
  "chat-support",
  "scheduling",
];

/** Every tool whose signature appears anywhere in the supplied markup. */
export function detectStack(html: string): DetectedTool[] {
  const hay = html.toLowerCase();
  const found = new Map<string, DetectedTool>();
  for (const sig of SIGNATURES) {
    if (sig.patterns.some((p) => hay.includes(p.toLowerCase()))) {
      found.set(sig.name, { name: sig.name, category: sig.category });
    }
  }
  return [...found.values()];
}

/** Group a detection into `category → tool names`, for the comparison component. */
export function byCategory(tools: DetectedTool[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tools) (out[t.category] ??= []).push(t.name);
  return out;
}

/**
 * How much of the core GTM surface is covered, 0–1.
 *
 * Reported to the scorer as evidence rather than used as the score itself: the
 * number is a floor on what we can see, and a warehouse-native stack would read
 * as zero here while being perfectly mature.
 */
export function coreCoverage(tools: DetectedTool[]): number {
  const present = new Set(tools.map((t) => t.category));
  const hits = CORE_GTM_CATEGORIES.filter((c) => present.has(c)).length;
  return hits / CORE_GTM_CATEGORIES.length;
}
