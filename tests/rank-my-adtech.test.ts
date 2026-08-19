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
