import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "..");
const talkTrackPath = path.join(repoRoot, "docs/sales/2026-05-17-openplan-90-second-buyer-demo-talk-track.md");
const salesReadmePath = path.join(repoRoot, "docs/sales/README.md");

function read(filePath: string) {
  return readFileSync(filePath, "utf8");
}

describe("OpenPlan 90-second buyer demo talk track", () => {
  it("is indexed from the sales README", () => {
    expect(existsSync(talkTrackPath)).toBe(true);
    expect(read(salesReadmePath)).toContain("docs/sales/2026-05-17-openplan-90-second-buyer-demo-talk-track.md");
  });

  it("keeps the opening script proof-first and supervised", () => {
    const talkTrack = read(talkTrackPath);

    expect(talkTrack).toContain("Apache-2.0 open-source planning software");
    expect(talkTrack).toContain("not to pretend the platform is a finished self-serve municipal SaaS");
    expect(talkTrack).toContain("internal prototype only");
    expect(talkTrack).toContain("Max APE is 237.62%");
    expect(talkTrack).toContain("we do not present it as validated forecasting");
    expect(talkTrack).toContain("a request starts an internal intake review");
    expect(talkTrack).toContain("not an automatic account, subscription, workspace, or services commitment");
    expect(talkTrack).toContain("scope one supervised first workflow");
  });

  it("preserves the required Nevada County caveats", () => {
    const talkTrack = read(talkTrackPath);

    for (const caveat of [
      "screening-grade only",
      "OSM default speeds/capacities",
      "tract fragments are not calibrated TAZs",
      "jobs are estimated from tract-scale demographic proxies",
      "external gateways are inferred from major boundary-crossing roads",
    ]) {
      expect(talkTrack).toContain(caveat);
    }
  });

  it("keeps high-risk claims inside the do-not-say section rather than affirmative copy", () => {
    const talkTrack = read(talkTrackPath);
    const doNotSayIndex = talkTrack.indexOf("## Do not say");
    expect(doNotSayIndex).toBeGreaterThan(0);

    const affirmativeCopy = talkTrack.slice(0, doNotSayIndex);
    const forbiddenAffirmativeClaims = [
      /OpenPlan is validated forecasting/i,
      /model is calibrated for production reliance/i,
      /Request access automatically creates a workspace/i,
      /customer can self-serve activation today/i,
      /AI makes the planning decision/i,
      /OpenPlan replaces legal, professional, or agency review/i,
    ];

    for (const pattern of forbiddenAffirmativeClaims) {
      expect(affirmativeCopy).not.toMatch(pattern);
    }
  });
});
