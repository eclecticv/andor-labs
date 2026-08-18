/**
 * Per-company share card — `/og/rank/<slug>.png`.
 *
 * This is the whole distribution mechanism for the tool. When somebody pastes
 * their ranking into X or LinkedIn, this is what renders: their name, their
 * score, their division, and a crown if they lead it. A generic tool card there
 * would mean the share says nothing about them, and nobody shares a link that
 * says nothing about them.
 *
 * Generated at request time rather than at build. The obvious alternative —
 * rendering one PNG per company during the build, the way scripts/render-og.mjs
 * does for the static cards — cannot work here: that script drives Playwright,
 * and Cloudflare's build image has no browser. So the card is rendered in the
 * Worker with satori + resvg (via workers-og) and cached at the edge.
 *
 * TYPE: Departure Mono only, and not merely as a house preference. Satori reads
 * ttf/otf/woff and cannot read woff2, and Instrument Serif ships here as woff2
 * alone. Departure Mono has an .otf, so the card is all-mono — which suits a
 * scoreboard better than the display serif would have anyway.
 */
import { ImageResponse } from "workers-og";
import { categoryLabel, SIDE_LABELS, type Side } from "../../_lib/classify";
/* The axis labels are IMPORTED, not typed out again. They were three hardcoded
   strings, and renaming the first question on the page left this card still
   announcing "INNOVATION" to everyone the link was shared with — the one place
   a stale label is seen by people who never visit the page. */
import { DIMENSIONS, letterFor } from "../../_lib/grader";

interface Env {
  RANKINGS: D1Database;
}

interface Row {
  name: string;
  domain: string;
  one_liner: string | null;
  side: Side;
  category: string | null;
  provisional: number;
  grade: number;
  originality: number;
  defensibility: number;
  traction: number;
  execution: number;
  durability: number;
  /** The three panelists' words, comma-joined by the query. */
}

/** Cached per isolate — the font is ~40KB and never changes between requests. */
let fontCache: ArrayBuffer | null = null;

async function loadFont(origin: string): Promise<ArrayBuffer | null> {
  if (fontCache) return fontCache;
  try {
    const res = await fetch(`${origin}/fonts/DepartureMono-Regular.otf`);
    if (!res.ok) return null;
    fontCache = await res.arrayBuffer();
    return fontCache;
  } catch {
    return null;
  }
}

/** Thresholds are out of 30 — see scoreBand in src/lib/rankings.ts. */
/* Mirrors scoreBand() in src/lib/rankings.ts, and its thresholds are the letter
   boundaries — so the word here can never contradict the letter on the page. */
const BAND = (grade: number) =>
  grade >= 4.5 ? "EXCEPTIONAL" : grade >= 3.5 ? "GENUINELY INTERESTING"
  : grade >= 2.5 ? "COMPETENT" : grade >= 1.5 ? "THIN" : "BRUTAL";

/** 20.1 renders as "20.1", 20 as "20". Never "20.0". */
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Escape for embedding untrusted strings into the card's HTML. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Flatten to characters Departure Mono can actually draw.
 *
 * It is a pixel font with a small glyph set, and satori renders a missing glyph
 * as a tofu box rather than falling back — an em dash or a curly apostrophe out
 * of a company's own marketing copy puts a black rectangle in the middle of
 * their share card. Typographic punctuation is folded to ASCII first so the
 * meaning survives, and only genuinely unrenderable characters are dropped.
 */
function plain(s: string): string {
  return s
    .replace(/[‐-―−]/g, "-")   // hyphens, en/em dashes, minus
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")     // non-breaking spaces
    .replace(/[^\x20-\x7E]/g, "")              // anything still outside ASCII
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate on a word boundary — a card that stops mid-word looks broken. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-]$/, "")}...`;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const raw = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const slug = (raw ?? "").replace(/\.png$/i, "");
  if (!slug) return new Response("Not found", { status: 404 });

  const row = await env.RANKINGS.prepare(
    `SELECT c.name, c.domain, c.one_liner, c.side, c.category, c.provisional,
            r.grade, r.originality, r.defensibility, r.traction,
            r.execution, r.durability
     FROM company c JOIN ranking r ON r.company_id = c.id
     WHERE c.slug = ? AND c.status = 'published'`,
  )
    .bind(slug)
    .first<Row>();

  if (!row) return new Response("Not found", { status: 404 });

  // Is this company top of its own side? That earns the crown line.
  const leader = await env.RANKINGS.prepare(
    `SELECT c.slug FROM company c JOIN ranking r ON r.company_id = c.id
     WHERE c.side = ? AND c.status = 'published'
     ORDER BY r.grade DESC, c.name ASC LIMIT 1`,
  )
    .bind(row.side)
    .first<{ slug: string }>();

  const origin = new URL(request.url).origin;
  const font = await loadFont(origin);

  // Two panelists reaching for the same word is agreement — "CREDIBLE ×2,
  // RESKINNED" reads as consensus, while the raw group_concat's "CREDIBLE,
  // CREDIBLE, RESKINNED" reads as a bug.
  /**
   * The bar's colour on the same cold→amber→hot ramp the company page uses.
   *
   * Interpolated to a SOLID colour rather than painted as a gradient: the page
   * anchors its ramp with `background-size`, and satori does not implement that
   * — a gradient here would restart at blue inside every bar and the hue would
   * carry no information. One flat colour picked from the ramp at the score's
   * position says exactly the same thing and survives the renderer.
   */
  const RAMP: [number, [number, number, number]][] = [
    [0.00, [0x1b, 0x4d, 0xff]], // blue-500
    [0.25, [0x53, 0x77, 0xff]], // blue-400
    [0.55, [0xf5, 0xa6, 0x23]], // amber-400
    [1.00, [0xc2, 0x31, 0x21]], // red-600
  ];
  const rampColor = (t: number) => {
    const p = Math.max(0, Math.min(1, t));
    let lo = RAMP[0], hi = RAMP[RAMP.length - 1];
    for (let i = 0; i < RAMP.length - 1; i++) {
      if (p >= RAMP[i][0] && p <= RAMP[i + 1][0]) { lo = RAMP[i]; hi = RAMP[i + 1]; break; }
    }
    const span = hi[0] - lo[0];
    const k = span === 0 ? 0 : (p - lo[0]) / span;
    const ch = (i: number) => Math.round(lo[1][i] + (hi[1][i] - lo[1][i]) * k);
    return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
  };

  const axis = (label: string, value: number, max: number) => `
    <div style="display:flex;align-items:center;width:100%;margin-bottom:14px">
      <div style="display:flex;width:250px;font-size:22px;color:#52555F">${label}</div>
      <div style="display:flex;width:420px;height:10px;background:#E9EBEF">
        <div style="display:flex;width:${Math.round((value / max) * 420)}px;height:10px;background:${rampColor(value / max)}"></div>
      </div>
      <div style="display:flex;margin-left:20px;font-size:22px;color:#14151A">${fmt(value)}/${max}</div>
    </div>`;

  const html = `
  <div style="display:flex;width:1200px;height:600px;padding:40px;background:#FFFFFF;font-family:Departure Mono">
    <div style="display:flex;flex-direction:column;width:1120px;height:520px;padding:44px 52px;background:#F7F9FB;border:2px solid #14151A;border-radius:5px">

      <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
        <div style="display:flex;font-size:22px;color:#1B4DFF">And/or Labs · RANK MY ADTECH</div>
        <div style="display:flex;font-size:18px;color:#6D717B;letter-spacing:2px">${esc(plain(`${SIDE_LABELS[row.side] ?? ""} · ${categoryLabel(row.category ?? "")}`).toUpperCase())}${row.provisional ? " · PROVISIONAL" : ""}</div>
      </div>

      <div style="display:flex;align-items:center;width:100%;margin-top:34px">
        <div style="display:flex;flex-direction:column;width:660px">
          <div style="display:flex;font-size:64px;color:#14151A">${esc(clip(plain(row.name), 22))}</div>
          <div style="display:flex;font-size:22px;color:#52555F;margin-top:10px">${esc(clip(plain(row.one_liner ?? row.domain), 58))}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;width:356px">
          <div style="display:flex;align-items:flex-end">
            <div style="display:flex;font-size:132px;color:#14151A;line-height:1">${fmt(row.grade)}</div>
            <div style="display:flex;font-size:28px;color:#6D717B;margin-bottom:14px">/5 · ${letterFor(row.grade)}</div>
          </div>
          <div style="display:flex;font-size:18px;color:#1B4DFF;letter-spacing:2px">${BAND(row.grade)}</div>
        </div>
      </div>

      <div style="display:flex;width:100%;height:1px;background:#D8DAE0;margin:30px 0 26px"></div>

      <div style="display:flex;flex-direction:column;width:100%">
        ${DIMENSIONS.map((d) => axis(d.label.toUpperCase(), row[d.key], 5)).join("")}
      </div>

      <div style="display:flex;justify-content:space-between;width:100%;margin-top:auto;font-size:18px;color:#6D717B">
        <div style="display:flex">${
          leader?.slug === slug ? "TOP OF ITS SIDE" : "GRADED ON FIVE DIMENSIONS"
        }</div>
        <div style="display:flex">andorlabs.ca/tools/rank-my-adtech</div>
      </div>
    </div>
  </div>`;

  return new ImageResponse(html, {
    width: 1200,
    height: 600,
    fonts: font
      ? [{ name: "Departure Mono", data: font, weight: 400, style: "normal" }]
      : undefined,
    headers: {
      // Long edge cache: a ranking never changes once written (one company is
      // one row, permanently), so the only way this content goes stale is a
      // takedown — which is rare and worth a purge.
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
};
