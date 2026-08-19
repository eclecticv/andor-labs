/**
 * Company facts from sources that cost nothing.
 *
 * Two of them, in the order they are tried:
 *
 *   1. schema.org JSON-LD, out of HTML the crawler already fetched. ZERO
 *      network calls. When a site publishes an `Organization` block it often
 *      carries `foundingDate`, a postal address and sometimes a headcount —
 *      first-party structured data rather than marketing prose, and free.
 *
 *   2. Wikidata. Free, open, no key, no quota. Inception (P571), headquarters
 *      (P159) and employee count (P1128) for anything notable enough to have an
 *      item.
 *
 * ── What these do NOT give you, measured ──
 * Neither knows funding, and Wikidata's coverage of small private adtech is
 * thin: it has Criteo and it does not have Nexx360 or The Media Trust. GLEIF was
 * tried and dropped — LEIs are issued to entities that trade in financial
 * markets, so an adtech startup generally has none, and both test companies
 * returned zero records.
 *
 * That is the whole reason `facts.ts` still exists: funding is the one field
 * with no free source, and it is metered. Everything answerable for free is
 * answered here first so the metered call is needed as rarely as possible.
 */

export interface FreeFacts {
  foundedYear: number;
  employeeCountRange: string;
  hqCity: string;
  hqCountry: string;
  /** Human-readable provenance, printed on the page. */
  source: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A four-digit year out of an ISO date, a year, or prose containing one. */
function yearOf(value: unknown): number {
  const text = typeof value === "number" ? String(value) : str(value);
  const m = /\b(1[89]\d{2}|20[0-3]\d)\b/.exec(text);
  if (!m) return 0;
  const n = Number(m[1]);
  // A founding year in the future, or before the first limited companies, is a
  // parse error rather than a fact.
  return n >= 1800 && n <= new Date().getUTCFullYear() ? n : 0;
}

// ── 1. schema.org JSON-LD, from HTML we already have ────────────────────────

/** Walk a JSON-LD document, including `@graph`, yielding every object node. */
function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const v of value) yield* nodes(v);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as Record<string, unknown>;
  yield node;
  if (node["@graph"]) yield* nodes(node["@graph"]);
}

const ORG_TYPES = /organization|corporation|localbusiness/i;

/**
 * Read the company's own structured data.
 *
 * Trusted more than the surrounding marketing copy for one narrow reason: these
 * fields are machine-readable claims a company publishes for search engines, so
 * they are the version it expects to be checked against. It is still the
 * company talking — which is why nothing here feeds a SCORE, only the stage band
 * and the facts block.
 */
export function factsFromMarkup(html: string): FreeFacts | null {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  if (!blocks) return null;

  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue; // One malformed block must not cost the others.
    }
    for (const node of nodes(parsed)) {
      if (!ORG_TYPES.test(String(node["@type"] ?? ""))) continue;

      const address = (node.address ?? {}) as Record<string, unknown>;
      const employees = node.numberOfEmployees;
      const headcount =
        typeof employees === "object" && employees !== null
          ? str((employees as Record<string, unknown>).value)
          : str(employees) || (typeof employees === "number" ? String(employees) : "");

      const found: FreeFacts = {
        foundedYear: yearOf(node.foundingDate),
        employeeCountRange: headcount,
        hqCity: str(address.addressLocality),
        hqCountry: str(address.addressCountry),
        source: "the company's own schema.org markup",
      };
      // An Organization node carrying none of the four fields is not a find.
      if (found.foundedYear || found.employeeCountRange || found.hqCity || found.hqCountry) {
        return found;
      }
    }
  }
  return null;
}

// ── 2. Wikidata ─────────────────────────────────────────────────────────────

const WD_TIMEOUT_MS = 6_000;

async function wd(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "andorlabs-rank/1.0 (hello@andorlabs.ca)" },
      signal: controller.signal,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort label for a Wikidata item id. */
async function labelOf(id: string): Promise<string> {
  const data = await wd(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=labels&languages=en&format=json&origin=*`,
  );
  return str(data?.entities?.[id]?.labels?.en?.value);
}

const claim = (e: any, prop: string) => e?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;

/**
 * Look the company up by name, then verify by its official website.
 *
 * The verification is the important half. A name search on Wikidata for a
 * three-word adtech company will happily return a village, a typeface or a
 * 19th-century opera, and attaching that item's founding year to a startup is
 * exactly the kind of sourced, confident error this whole layer exists to
 * avoid. So P856 (official website) must agree on host, or there is no match.
 */
export async function factsFromWikidata(name: string, domain: string): Promise<FreeFacts | null> {
  if (!name.trim()) return null;
  const search = await wd(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}` +
      `&language=en&type=item&limit=5&format=json&origin=*`,
  );
  const hits: any[] = search?.search ?? [];
  if (!hits.length) return null;

  const want = domain.replace(/^www\./, "").toLowerCase();

  for (const hit of hits.slice(0, 3)) {
    const data = await wd(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hit.id}` +
        `&props=claims&format=json&origin=*`,
    );
    const entity = data?.entities?.[hit.id];
    if (!entity) continue;

    const site = str(claim(entity, "P856"));
    let host = "";
    try {
      host = new URL(site).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (host !== want) continue;

    const inception = claim(entity, "P571");
    const employees = claim(entity, "P1128");
    const hqId = claim(entity, "P159")?.id;

    const facts: FreeFacts = {
      foundedYear: yearOf(inception?.time?.replace(/^\+/, "")),
      employeeCountRange: employees?.amount ? String(employees.amount).replace(/^\+/, "") : "",
      hqCity: hqId ? await labelOf(hqId) : "",
      hqCountry: "",
      source: `Wikidata (${hit.id})`,
    };
    if (facts.foundedYear || facts.employeeCountRange || facts.hqCity) return facts;
  }
  return null;
}

/**
 * Markup first, Wikidata second. Cheapest source that answers, wins.
 *
 * Markup leads because it costs nothing at all — the HTML is already in memory —
 * and because a company's own structured data is more current than a Wikidata
 * item for the small companies this board is mostly made of.
 */
export async function freeFacts(
  html: string,
  name: string,
  domain: string,
): Promise<FreeFacts | null> {
  return factsFromMarkup(html) ?? (await factsFromWikidata(name, domain));
}
