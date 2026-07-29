import { describe, expect, it, vi } from "vitest";

import {
  crashFeatureToSelection,
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
