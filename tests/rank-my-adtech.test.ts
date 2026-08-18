/**
 * What the handler still owns after the scorer moved into _lib: turning a
 * submitted URL into a domain, turning a name into a slug, and the designed
 * failure copy. Everything about scoring is tested in score.test.ts, the stack
 * in stack.test.ts, and the stage line in stage.test.ts.
 */
import { describe, expect, it } from "vitest";
import { normalizeDomain, slugify, emailDomain, failure } from "../functions/api/rank-my-adtech";

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
    expect(failure("identify").headline).toMatch(/could not work out what they are/i);
    expect(failure("grade").headline).toMatch(/would not put its name to it/i);
    expect(failure("read").status).toBe("failed");
  });

  it("explains a failed grade as a refusal, not an error", () => {
    // The reason a substitute grader is refused is comparability, and the copy
    // has to carry that or it reads as an ordinary outage the user should
    // shrug at. This is the one failure with an actual argument in it.
    expect(failure("grade").detail).toMatch(/comparable/i);
  });
});
