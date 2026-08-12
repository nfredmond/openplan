import { describe, expect, it, vi } from "vitest";

import {
  crashFeatureToSelection,
  describeCrashCasualtyLine,
  isCrashFeatureProperties,
} from "@/lib/cartographic/crash-feature-to-selection";

const validProps = {
  kind: "safety_crash" as const,
  crashId: "c0000001-0000-4000-8000-000000000001",
  projectId: null,
  severity: "fatal" as const,
  collisionDate: "2023-08-14",
  collisionYear: 2023,
  killedCount: 1,
  injuredCount: 2,
  pedestrianInvolved: true,
  bicyclistInvolved: false,
};

describe("isCrashFeatureProperties", () => {
  it("accepts a well-formed crash feature payload", () => {
    expect(isCrashFeatureProperties(validProps)).toBe(true);
  });

  /**
   * The severity guard is the KABCO vocabulary boundary. A payload carrying an
   * unrecognised severity must not produce a selection, because every downstream
   * label would then describe the collision as something the source never said.
   */
  it("rejects a severity outside the KABCO vocabulary", () => {
    expect(isCrashFeatureProperties({ ...validProps, severity: "serious" })).toBe(false);
  });

  it("accepts a crash with no date at all", () => {
    expect(
      isCrashFeatureProperties({ ...validProps, collisionDate: null, collisionYear: null }),
    ).toBe(true);
  });

  it("rejects an empty projectId rather than treating it as a link", () => {
    expect(isCrashFeatureProperties({ ...validProps, projectId: "" })).toBe(false);
  });

  it("rejects a payload whose kind is not safety_crash", () => {
    expect(isCrashFeatureProperties({ ...validProps, kind: "project" })).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isCrashFeatureProperties(null)).toBe(false);
    expect(isCrashFeatureProperties("safety_crash")).toBe(false);
  });
});

describe("crashFeatureToSelection", () => {
  it("returns null for a payload that is not a crash", () => {
    expect(crashFeatureToSelection({ kind: "project" }, { navigate: vi.fn() })).toBeNull();
  });

  it("titles the selection by severity and carries the counts a planner scans for", () => {
    const selection = crashFeatureToSelection(validProps, { navigate: vi.fn() });

    expect(selection?.kind).toBe("safety_crash");
    expect(selection?.title).toBe("Fatal collision");
    expect(selection?.kicker).toBe("Reported collision");
    expect(selection?.meta).toEqual([
      { label: "severity", value: "Fatal" },
      { label: "date", value: "2023-08-14" },
      { label: "killed", value: "1" },
      { label: "injured", value: "2" },
      { label: "involved", value: "pedestrian", tone: "urgent" },
    ]);
  });

  /**
   * An absent mode flag is not a finding that the mode was uninvolved — the
   * source records involvement, not its absence — so the row is omitted rather
   * than rendered as "pedestrian: no".
   */
  it("omits the involvement row entirely when no mode flag is set", () => {
    const selection = crashFeatureToSelection(
      { ...validProps, pedestrianInvolved: false, bicyclistInvolved: false },
      { navigate: vi.fn() },
    );

    expect(selection?.meta?.some((item) => item.label === "involved")).toBe(false);
  });

  it("degrades a missing date to the year, and a missing year to a stated absence", () => {
    const yearOnly = crashFeatureToSelection(
      { ...validProps, collisionDate: null },
      { navigate: vi.fn() },
    );
    expect(yearOnly?.meta?.find((item) => item.label === "date")?.value).toBe("2023");

    const neither = crashFeatureToSelection(
      { ...validProps, collisionDate: null, collisionYear: null },
      { navigate: vi.fn() },
    );
    expect(neither?.meta?.find((item) => item.label === "date")?.value).toBe("date not reported");
  });

  it("opens the Safety workbench, scoped to the acquisition's project when it had one", () => {
    const navigate = vi.fn();

    crashFeatureToSelection(validProps, { navigate })?.primaryAction?.onClick();
    expect(navigate).toHaveBeenCalledWith("/safety");

    navigate.mockClear();
    crashFeatureToSelection(
      { ...validProps, projectId: "p0000001-0000-4000-8000-000000000009" },
      { navigate },
    )?.primaryAction?.onClick();
    expect(navigate).toHaveBeenCalledWith(
      "/safety?projectId=p0000001-0000-4000-8000-000000000009",
    );
  });

  it("carries a feature reference only when the caller supplies a source id", () => {
    expect(crashFeatureToSelection(validProps, { navigate: vi.fn() })?.featureRef).toBeUndefined();
    expect(
      crashFeatureToSelection(validProps, { navigate: vi.fn(), sourceId: "cartographic-crashes" })
        ?.featureRef,
    ).toEqual({ sourceId: "cartographic-crashes", featureId: validProps.crashId });
  });
});

/**
 * A CASUALTY COUNT THE SOURCE DID NOT SUPPLY IS NOT ZERO, AND THE INSPECTOR IS
 * WHERE THAT USED TO BE VISIBLY FALSE.
 *
 * The shared map route coerced both counts through an integer parse that
 * returned 0 for anything unreadable, so a collision reported without any
 * casualty count was inspected as "killed 0 · injured 0" — a statement about a
 * real crash that no agency ever made. Measured against one state's live 2025
 * file: 4.7% of records statewide, 9.5% in one rural county of it.
 */
describe("a count the source did not supply", () => {
  const unclassified = {
    ...validProps,
    severity: "unknown" as const,
    killedCount: null,
    injuredCount: null,
  };

  it("is accepted as a payload rather than rejected as malformed", () => {
    expect(isCrashFeatureProperties(unclassified)).toBe(true);
  });

  it("renders as 'not reported', never as 0", () => {
    const selection = crashFeatureToSelection(unclassified, { navigate: vi.fn() });
    const killed = selection?.meta?.find((entry) => entry.label === "killed");
    const injured = selection?.meta?.find((entry) => entry.label === "injured");
    expect(killed?.value).toBe("not reported");
    expect(injured?.value).toBe("not reported");
  });

  it("titles the collision with the band that says the classification is missing", () => {
    const selection = crashFeatureToSelection(unclassified, { navigate: vi.fn() });
    expect(selection?.title).toMatch(/not classified/i);
    expect(selection?.title).toMatch(/no casualty count/i);
  });

  /**
   * THE SECOND SURFACE THAT RENDERS THIS PAIR OF NUMBERS.
   *
   * The Safety workbench's own map has a hover popup, and it made the identical
   * mistake independently — `Number(props.killedCount ?? 0)` — while the
   * inspector above was being fixed. Two callers, one rule, so the sentence now
   * comes from this module and this is where it is proven. Mapbox hands the
   * popup untyped feature properties, which is why the input is `unknown` and
   * why the string cases below are tested rather than assumed away.
   */
  it("says 'not reported' in the map popup line too, and never 0", () => {
    expect(describeCrashCasualtyLine(null, null)).toBe("No casualty count reported by the source");
    expect(describeCrashCasualtyLine(undefined, undefined)).toBe(
      "No casualty count reported by the source"
    );
    // One side known, one side not — the known side is still stated.
    expect(describeCrashCasualtyLine(2, null)).toBe("2 killed · not reported injured");
    expect(describeCrashCasualtyLine(null, 5)).toBe("not reported killed · 5 injured");
    // A real zero is a real observation and must still read as zero.
    expect(describeCrashCasualtyLine(0, 0)).toBe("0 killed · 0 injured");
    // PostgREST hands numeric columns back as strings often enough to pin it.
    expect(describeCrashCasualtyLine("1", "3")).toBe("1 killed · 3 injured");
    // Anything unreadable is an absence, not a zero. The empty string is the
    // one that matters: `Number("")` is 0, and Mapbox stringifies feature
    // properties, so the version this replaced printed "0 injured" for a count
    // no agency ever supplied — the same defect the route had just been fixed
    // for, arriving through the popup instead.
    expect(describeCrashCasualtyLine("n/a", "")).toBe("No casualty count reported by the source");
    expect(describeCrashCasualtyLine("", " ")).toBe("No casualty count reported by the source");
    expect(describeCrashCasualtyLine(1, "")).toBe("1 killed · not reported injured");
    // A negative is a data error in the feed, not "nobody was hurt".
    expect(describeCrashCasualtyLine(-1, -2)).toBe("No casualty count reported by the source");
    // And a boolean is not a count.
    expect(describeCrashCasualtyLine(true, false)).toBe("No casualty count reported by the source");
  });
});

describe("the neutral dimensions on the inspector card", () => {
  it("states the ones the source recorded", () => {
    const selection = crashFeatureToSelection(
      { ...validProps, lighting: "dark_unlighted", weather: "rain", collisionType: "angle" },
      { navigate: vi.fn() },
    );
    const byLabel = new Map(selection!.meta!.map((entry) => [entry.label, entry.value]));
    expect(byLabel.get("lighting")).toBe("dark unlighted");
    expect(byLabel.get("weather")).toBe("rain");
    expect(byLabel.get("manner")).toBe("angle");
  });

  it("omits a dimension the source does not record rather than showing it blank", () => {
    // NULL here means the source has no such field — a fact about the feed, not
    // about the collision. This card describes ONE crash and cannot tell the
    // reader which; the Safety workbench's per-acquisition coverage panel is
    // where that distinction is drawn, because that is where the answer exists.
    const selection = crashFeatureToSelection(
      { ...validProps, lighting: null, weather: null, collisionType: null },
      { navigate: vi.fn() },
    );
    const labels = selection!.meta!.map((entry) => entry.label);
    expect(labels).not.toContain("lighting");
    expect(labels).not.toContain("weather");
    expect(labels).not.toContain("manner");
  });

  it("shows a motorcyclist, who was invisible at every layer of this product", () => {
    const selection = crashFeatureToSelection(
      { ...validProps, pedestrianInvolved: false, motorcyclistInvolved: true },
      { navigate: vi.fn() },
    );
    const involved = selection!.meta!.find((entry) => entry.label === "involved");
    expect(involved?.value).toContain("motorcyclist");
  });
});
