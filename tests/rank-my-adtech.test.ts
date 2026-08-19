/**
 * What the handler still owns after the scorer moved into _lib: turning a
 * submitted URL into a domain, turning a name into a slug, and the designed
 * failure copy. Everything about scoring is tested in score.test.ts, the stack
 * in stack.test.ts, and the stage line in stage.test.ts.
 */
import { describe, expect, it } from "vitest";
import { normalizeDomain, slugify, emailDomain, failure } from "../functions/api/rank-my-adtech";
import { readFile } from "node:fs/promises";

describe("domain normalisation", () => {
  it("reduces any reasonable input to a bare host", () => {
    expect(normalizeDomain("https://www.Magnite.com/products/")).toBe("magnite.com");
    expect(normalizeDomain("id5.io")).toBe("id5.io");
    expect(normalizeDomain("  HTTP://example.co.uk  ")).toBe("example.co.uk");
  });

  it("refuses things that are not domains", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("javascript:alert(1)")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("slugs", () => {
  it("produces url-safe slugs and drops edge punctuation", () => {
    expect(slugify("The Trade Desk")).toBe("the-trade-desk");
    expect(slugify("!!! Weird & Co. !!!")).toBe("weird-co");
  });
});

describe("email domain", () => {
  it("takes the host half, lowercased", () => {
    expect(emailDomain("VJ@AndorLabs.ca")).toBe("andorlabs.ca");
    expect(emailDomain("nonsense")).toBe("");
  });
});

describe("the designed failure", () => {
  // A ranking publishes complete or not at all, so the failure is part of the
  // product rather than a red box. It has to name which part fell over.
  it("names the stage and speaks in the tool's voice", () => {
    expect(failure("read").headline).toMatch(/could not get a look/i);
    expect(failure("panel").headline).toMatch(/did not sit/i);
    expect(failure("write").headline).toMatch(/nobody would write it up/i);
    expect(failure("read").status).toBe("failed");
  });

  it("explains a short panel as a refusal, not an error", () => {
    // The reason a two-juror panel is refused is comparability, and the copy
    // has to carry that or it reads as an ordinary outage the user should
    // shrug at. This is the one failure with an actual argument in it.
    expect(failure("panel").detail).toMatch(/comparable/i);
  });
});

describe("the designed failure actually reaches the browser", () => {
  /**
   * A source-level check, in the same spirit as tests/panel-copy.test.ts.
   *
   * The failure copy is careful, stage-specific and was completely invisible:
   * Cloudflare intercepts any 5xx from a Pages Function and substitutes its own
   * plain-text error page, so `json(failure("read"), 502)` reached the browser
   * as the six bytes `error code: 502`. `res.json()` threw, the client's catch
   * fired, and every distinct failure — a cake shop whose site returned zero
   * characters, a panel seat that ran twenty seconds long — reported the same
   * "The panel is unreachable".
   *
   * These are outcomes, not server errors. If a 5xx ever appears beside a
   * failure() call again, that whole system goes dark again with no other
   * symptom than a misleading string.
   */
  it("never ships a designed failure with a 5xx status", async () => {
    const src = await readFile(
      new URL("../functions/api/rank-my-adtech.ts", import.meta.url), "utf8",
    );
    const calls = [...src.matchAll(/return json\(failure\("(\w+)"\),\s*(\d{3})\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const [, stage, status] of calls) {
      expect(Number(status), `failure("${stage}") must not use ${status}`).toBeLessThan(300);
    }
  });

  it("gives the client a status field to branch on before it checks res.ok", () => {
    for (const stage of ["read", "identify", "panel", "write"] as const) {
      expect(failure(stage).status).toBe("failed");
      expect(failure(stage).stage).toBe(stage);
    }
  });
});

describe("the client and the endpoint agree on what happened", () => {
  /**
   * They did not, twice, and both times silently.
   *
   * The endpoint has returned `status: "not-eligible"` since the eligibility
   * check was split out of the panel; the page went on testing for
   * `"not-adtech"`. So every refusal — a public company, a cake shop with a
   * readable homepage — fell past that branch into the success renderer, which
   * reads a total and nine takes a refusal does not have. The visible symptom
   * was a broken card or the catch-all error, neither of which points anywhere
   * near a status string.
   *
   * A status is a contract between two files that never import each other.
   * This is the only thing that can hold them together.
   */
  const CLIENT = new URL("../src/pages/tools/rank-my-adtech.astro", import.meta.url);
  const SERVER = new URL("../functions/api/rank-my-adtech.ts", import.meta.url);

  it("has the page handle every status the endpoint can send", async () => {
    const server = await readFile(SERVER, "utf8");
    const client = await readFile(CLIENT, "utf8");
    const sent = new Set(
      [...server.matchAll(/status:\s*"([a-z-]+)"/g)].map((m) => m[1]),
    );
    // Internal job bookkeeping never reaches the browser, and "ranked" is the
    // fall-through: the page renders a result when nothing else matched, so it
    // correctly has no branch testing for it. Everything else must be handled
    // explicitly or it lands in the success renderer by accident, which is
    // exactly the bug this guards.
    for (const internal of ["running", "refused", "ranked"]) sent.delete(internal);
    expect(sent.size).toBeGreaterThan(2);
    for (const status of sent) {
      expect(client, `page never handles status "${status}"`).toContain(`"${status}"`);
    }
  });

  it("does not leave the page testing for a status nothing sends", async () => {
    const server = await readFile(SERVER, "utf8");
    const client = await readFile(CLIENT, "utf8");
    const tested = [...client.matchAll(/status\s*===\s*"([a-z-]+)"/g)].map((m) => m[1]);
    expect(tested.length).toBeGreaterThan(2);
    for (const status of tested) {
      expect(server, `page tests for "${status}" but nothing sends it`).toContain(`"${status}"`);
    }
  });
});
