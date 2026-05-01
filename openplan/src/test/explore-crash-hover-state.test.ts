import { describe, expect, it } from "vitest";

import { buildHoveredCrash } from "@/app/(app)/explore/_components/explore-crash-hover-state";

describe("explore crash hover state", () => {
  it("builds hovered crash state from feature properties", () => {
    expect(
      buildHoveredCrash({
        severityLabel: "Fatal crash",
        collisionYear: "2024",
        fatalCount: "1",
        injuryCount: "2",
        pedestrianInvolved: "true",
        bicyclistInvolved: "false",
      })
    ).toEqual({
      severityLabel: "Fatal crash",
      collisionYear: 2024,
      fatalCount: 1,
      injuryCount: 2,
      pedestrianInvolved: true,
      bicyclistInvolved: false,
    });
  });

  it("preserves existing defaults and coercion for missing or invalid properties", () => {
    expect(
      buildHoveredCrash({
        collisionYear: "unknown",
        fatalCount: "unknown",
        injuryCount: undefined,
        pedestrianInvolved: true,
        bicyclistInvolved: "true",
      })
    ).toEqual({
      severityLabel: "Crash",
      collisionYear: null,
      fatalCount: 0,
      injuryCount: 0,
      pedestrianInvolved: true,
      bicyclistInvolved: true,
    });

    expect(buildHoveredCrash(null)).toBeNull();
  });
});
