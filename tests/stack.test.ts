/**
 * The stack detector is the evidence behind the GTM-maturity dimension, so a
 * silent regression here becomes a wrong score rather than an error.
 */
import { describe, expect, it } from "vitest";
import { detectStack, byCategory, coreCoverage } from "../functions/_lib/stack";

describe("stack detection", () => {
  it("finds tools by their loader domain", () => {
    const html = `<script src="https://js.hs-scripts.com/123.js"></script>
                  <script src="https://cdn.segment.com/analytics.js"></script>
                  <script defer src="https://plausible.io/js/script.js"></script>`;
    const names = detectStack(html).map((t) => t.name).sort();
    expect(names).toEqual(["HubSpot", "Plausible", "Segment"]);
  });

  it("is case-insensitive — vendors are inconsistent about host casing", () => {
    expect(detectStack('<script src="HTTPS://CDN.MXPNL.COM/x.js">').map((t) => t.name))
      .toEqual(["Mixpanel"]);
  });

  it("reports nothing for a page with no tooling", () => {
    expect(detectStack("<html><body><h1>We are stealth</h1></body></html>")).toEqual([]);
  });

  it("never double-counts a tool matched by two patterns", () => {
    const html = 'posthog.com/static posthog.init app.posthog.com';
    expect(detectStack(html)).toHaveLength(1);
  });

  it("groups by category for the comparison component", () => {
    const g = byCategory(detectStack('js.hs-scripts.com plausible.io/js'));
    expect(g["crm-marketing"]).toEqual(["HubSpot"]);
    expect(g["analytics"]).toEqual(["Plausible"]);
  });

  // Coverage is a floor on what is visible, not a verdict — a warehouse-native
  // stack reads as zero here and may still be excellent.
  it("scores core coverage as a fraction of the five core categories", () => {
    expect(coreCoverage(detectStack(""))).toBe(0);
    const three = detectStack('plausible.io/js js.hs-scripts.com app.loops.so');
    expect(coreCoverage(three)).toBeCloseTo(3 / 5);
  });
});
