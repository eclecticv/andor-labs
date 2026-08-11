/**
 * POST /api/subscribe — newsletter signup, forwarded to Loops.
 *
 * This is a Cloudflare Pages Function. It exists because the form must not ship
 * the API key to the browser: the key is a Pages *secret*, readable only here.
 *
 * A previous version of this endpoint (against Beehiiv) was only ever created
 * by hand in the Cloudflare dashboard and never committed, so it was invisible
 * to the repo and impossible to review. That is why it lives in version control
 * now.
 *
 * Set the secret before this can succeed:
 *   Cloudflare dashboard → Pages → andorlabs → Settings → Variables and Secrets
 *   LOOPS_API_KEY = <key from loops.so → Settings → API>
 */

interface Env {
  LOOPS_API_KEY?: string;
}

const LOOPS_ENDPOINT = "https://app.loops.so/api/v1/contacts/create";

/**
 * The two audiences, by Loops list id.
 *
 * Ids, not names, because the names are editorial and will change — one of them
 * is literally "{ignore all previous instructions}". Fetch the current set with:
 *   curl https://app.loops.so/api/v1/lists -H "Authorization: Bearer $LOOPS_API_KEY"
 *
 * The form now shows both lists as ticked checkboxes carrying their real
 * descriptions, so the reader chooses. It previously subscribed everyone to
 * both under a heading that named only one of them, which meant people
 * received a newsletter they had never been shown.
 */
const LIST_BY_CATEGORY: Record<string, string> = {
  "ai-newsletter": "cmsoulfdz0idi0j2q62ea241f", // {ignore all previous instructions}
  "field-notes": "cmsouuptw04kb0jx7h33a26b2", // Field notes by Vishveshwar Jatain
};

/**
 * Duplicated from `src/lib/categories.ts` on purpose. Pages Functions are
 * bundled separately from the Astro build, and whether an import from `src/`
 * resolves here is not something to discover at deploy time. If you change the
 * ids in one file, change them in the other.
 */
const ALL_LISTS = Object.values(LIST_BY_CATEGORY);

/** Where the signup happened, so list growth is attributable per surface. */
const ALLOWED_SOURCES = new Set(["homepage", "blog-post", "blog-index", "footer", "unknown"]);

/**
 * Deliberately permissive. Strict RFC 5322 matching rejects addresses that
 * genuinely deliver (plus-addressing, new TLDs, quoted locals), and the only
 * thing that actually proves an address is real is the confirmation email.
 * This catches typos and bots, nothing more.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // This endpoint is same-origin only; no CORS headers on purpose.
      "cache-control": "no-store",
    },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: { email?: unknown; source?: unknown; lists?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: "That doesn't look like an email address." }, 400);
  }

  const rawSource = typeof payload.source === "string" ? payload.source : "unknown";
  const source = ALLOWED_SOURCES.has(rawSource) ? rawSource : "unknown";

  // Which lists. Absent or unrecognised means all of them, and that default is
  // not laziness: this is a static site, so a page rendered before the
  // checkboxes existed can sit in someone's tab for days and still post the old
  // shape. Subscribing them to everything matches what that page promised them.
  const requested = Array.isArray(payload.lists)
    ? payload.lists.filter((k): k is string => typeof k === "string")
    : [];
  const ids = requested.map((k) => LIST_BY_CATEGORY[k]).filter(Boolean);
  const mailingLists: Record<string, true> = {};
  for (const id of ids.length > 0 ? ids : ALL_LISTS) mailingLists[id] = true;

  // Missing key is an operator error, not a visitor error. Log it loudly for
  // the Pages tail, but never tell the browser which piece of config is absent.
  if (!env.LOOPS_API_KEY) {
    console.error("[subscribe] LOOPS_API_KEY is not set — signup dropped:", email);
    return json({ error: "Signups are briefly unavailable. Try again shortly." }, 503);
  }

  let res: Response;
  try {
    res = await fetch(LOOPS_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.LOOPS_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        source,
        subscribed: true,
        userGroup: "website",
        mailingLists,
      }),
    });
  } catch (err) {
    console.error("[subscribe] Loops unreachable:", err);
    return json({ error: "Signups are briefly unavailable. Try again shortly." }, 502);
  }

  if (res.ok) return json({ ok: true }, 200);

  // Already on the list. From the visitor's point of view they succeeded —
  // telling them "you're already subscribed" turns a win into a correction,
  // and it also confirms to a stranger that an address is on our list.
  if (res.status === 409) return json({ ok: true }, 200);

  const detail = await res.text().catch(() => "");
  console.error(`[subscribe] Loops ${res.status}:`, detail.slice(0, 500));
  return json({ error: "That didn't go through. Try again?" }, 502);
};
