import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(process.cwd(), "src");
const source = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("private aerial orthophoto wiring", () => {
  it("uses the shared binding on every authenticated map family promised by the release", () => {
    for (const file of [
      "components/cartographic/cartographic-map-backdrop.tsx",
      "components/safety/safety-workspace.tsx",
      "app/(app)/explore/_components/explore-workbench.tsx",
      "components/engagement/geometry-picker-map.tsx",
      "components/engagement/location-display-map.tsx",
      "components/engagement/participation-heatmap-map.tsx",
    ]) {
      expect(source(file), file).toMatch(/useAerialOrthoMapBinding\s*\(/);
    }
    expect(source("components/projects/project-map-presence.tsx")).toMatch(/privateAerialOrthos/);
    expect(source("app/(app)/engagement/[campaignId]/page.tsx")).toMatch(/privateAerialOrthos/);
    expect(source("components/engagement/spatial-hotspot-tuner.tsx")).toMatch(/privateAerialOrthos/);
  });

  it("never opts a resident-facing caller into private aerial imagery", () => {
    for (const file of [
      "components/engagement/public-engagement-portal.tsx",
      "components/engagement/public-map-shell.tsx",
      "components/engagement/portal-submission-form.tsx",
      "components/engagement/public-survey-form.tsx",
    ]) {
      expect(source(file), file).not.toMatch(/privateAerialOrthos/);
    }
  });
});
