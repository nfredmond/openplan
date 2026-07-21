import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ITE_TRIP_GEN_KPI_NAMES,
  ITE_TRIP_GEN_SCREENING_CAVEAT,
} from "@/lib/models/ite-trip-generation";
import {
  SPINE_CAVEAT_MAX_LENGTH,
  TRIP_GEN_COMPARISON_CAVEATS,
  buildTripGenComparisonPayload,
  splitCaveatForSpine,
  type TripGenComparisonKpiRow,
} from "@/lib/scenarios/trip-gen-comparison";

const BASELINE_ENTRY = { id: "8a3b0f8e-8f4a-4d3e-9a2b-1c5d6e7f8a9b", label: "Existing conditions" };
const CANDIDATE_ENTRY = { id: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e", label: "Infill housing package" };

/** Mirror of the spine route's zod schemas (comparison-snapshots/route.ts) so
 * this test fails if the payload builder drifts from what the route accepts. */
const indicatorDeltaSchema = z.object({
  baselineIndicatorSnapshotId: z.string().uuid().optional(),
  candidateIndicatorSnapshotId: z.string().uuid().optional(),
  indicatorKey: z.string().trim().min(1).max(120),
  indicatorLabel: z.string().trim().min(1).max(160),
  unitLabel: z.string().trim().max(80).optional(),
  delta: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().trim().max(1000).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const createComparisonSnapshotSchema = z.object({
  baselineEntryId: z.string().uuid(),
  candidateEntryId: z.string().uuid(),
  assumptionSetId: z.string().uuid().optional(),
  dataPackageId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional(),
  narrative: z.string().trim().max(8000).optional(),
  caveats: z.array(z.string().trim().min(1).max(400)).max(25).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  indicatorDeltas: z.array(indicatorDeltaSchema).max(100).optional(),
});

function kpi(
  name: string,
  value: number | null,
  overrides: Partial<TripGenComparisonKpiRow> = {}
): TripGenComparisonKpiRow {
  return {
    kpi_name: name,
    kpi_label: `${name} label`,
    value,
    unit: "trip ends/day",
    ...overrides,
  };
}

function fullKpiSet(scale: number): TripGenComparisonKpiRow[] {
  return [
    kpi("project_daily_trip_ends", 100 * scale),
    kpi("project_am_peak_hour_trip_ends", 8 * scale, { unit: "trip ends/hour" }),
    kpi("project_pm_peak_hour_trip_ends", 10 * scale, { unit: "trip ends/hour" }),
    kpi("project_daily_vmt_screen", 500 * scale, { unit: "vehicle-miles/day" }),
    kpi("project_program_units", 40 * scale, { unit: "units (mixed bases)" }),
  ];
}

function buildDefaultPayload(overrides: { label?: string } = {}) {
  return buildTripGenComparisonPayload({
    baselineEntry: BASELINE_ENTRY,
    candidateEntry: CANDIDATE_ENTRY,
    baselineKpis: fullKpiSet(1),
    candidateKpis: fullKpiSet(2),
    label: overrides.label ?? "Trip generation — Infill housing package vs Existing conditions",
  });
}

describe("buildTripGenComparisonPayload", () => {
  it("builds one indicatorDelta per shared KPI with baseline, candidate, and delta values", () => {
    const payload = buildDefaultPayload();

    expect(payload.baselineEntryId).toBe(BASELINE_ENTRY.id);
    expect(payload.candidateEntryId).toBe(CANDIDATE_ENTRY.id);
    expect(payload.indicatorDeltas).toHaveLength(5);

    const daily = payload.indicatorDeltas[0];
    expect(daily.indicatorKey).toBe("project_daily_trip_ends");
    expect(daily.indicatorLabel).toBe("project_daily_trip_ends label");
    expect(daily.unitLabel).toBe("trip ends/day");
    expect(daily.delta).toEqual({ baseline: 100, candidate: 200, delta: 100 });
    expect(daily.summary).toContain("100 → 200");
    expect(daily.summary).toContain("+100");
  });

  it("orders deltas canonically with sequential sortOrder regardless of input row order", () => {
    const payload = buildTripGenComparisonPayload({
      baselineEntry: BASELINE_ENTRY,
      candidateEntry: CANDIDATE_ENTRY,
      baselineKpis: [...fullKpiSet(1)].reverse(),
      candidateKpis: [...fullKpiSet(2)].reverse(),
      label: "Ordering check",
    });

    expect(payload.indicatorDeltas.map((delta) => delta.indicatorKey)).toEqual(
      Array.from(ITE_TRIP_GEN_KPI_NAMES)
    );
    expect(payload.indicatorDeltas.map((delta) => delta.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("skips KPIs that are missing on one side or have null values", () => {
    const payload = buildTripGenComparisonPayload({
      baselineEntry: BASELINE_ENTRY,
      candidateEntry: CANDIDATE_ENTRY,
      baselineKpis: [
        kpi("project_daily_trip_ends", 100),
        kpi("project_am_peak_hour_trip_ends", 8),
        kpi("project_daily_vmt_screen", null),
      ],
      candidateKpis: [
        kpi("project_daily_trip_ends", 150),
        // project_am_peak_hour_trip_ends missing on candidate side
        kpi("project_daily_vmt_screen", 900),
        kpi("project_pm_peak_hour_trip_ends", 12), // missing on baseline side
      ],
      label: "Partial KPI coverage",
    });

    expect(payload.indicatorDeltas.map((delta) => delta.indicatorKey)).toEqual([
      "project_daily_trip_ends",
    ]);
    expect(payload.indicatorDeltas[0].sortOrder).toBe(0);
  });

  it("ignores KPI names outside the ITE trip-gen namespace even when present in both runs", () => {
    const payload = buildTripGenComparisonPayload({
      baselineEntry: BASELINE_ENTRY,
      candidateEntry: CANDIDATE_ENTRY,
      baselineKpis: [kpi("corridor_daily_vmt", 1000), kpi("project_daily_trip_ends", 100)],
      candidateKpis: [kpi("corridor_daily_vmt", 1200), kpi("project_daily_trip_ends", 130)],
      label: "Namespace check",
    });

    expect(payload.indicatorDeltas.map((delta) => delta.indicatorKey)).toEqual([
      "project_daily_trip_ends",
    ]);
  });

  it("rounds float-noise deltas to two decimals", () => {
    const payload = buildTripGenComparisonPayload({
      baselineEntry: BASELINE_ENTRY,
      candidateEntry: CANDIDATE_ENTRY,
      baselineKpis: [kpi("project_daily_trip_ends", 10.1)],
      candidateKpis: [kpi("project_daily_trip_ends", 10.4)],
      label: "Rounding check",
    });

    expect(payload.indicatorDeltas[0].delta.delta).toBe(0.3);
  });

  it("passes the label through trimmed, falls back when blank, and clamps to 160 chars", () => {
    expect(buildDefaultPayload({ label: "  Trip generation — A vs B  " }).label).toBe(
      "Trip generation — A vs B"
    );
    expect(buildDefaultPayload({ label: "   " }).label).toBe(
      "Trip generation — Infill housing package vs Existing conditions"
    );
    const longLabel = `Trip generation — ${"x".repeat(300)}`;
    expect(buildDefaultPayload({ label: longLabel }).label.length).toBeLessThanOrEqual(160);
  });

  it("attaches the full screening caveat with every caveat string within the spine cap", () => {
    const payload = buildDefaultPayload();

    expect(payload.caveats.length).toBeGreaterThanOrEqual(1);
    for (const caveat of payload.caveats) {
      expect(caveat.length).toBeGreaterThan(0);
      expect(caveat.length).toBeLessThanOrEqual(SPINE_CAVEAT_MAX_LENGTH);
    }
    // Nothing from the claim boundary is dropped: the pieces reassemble to the
    // exact ITE_TRIP_GEN_SCREENING_CAVEAT text.
    expect(payload.caveats.join(" ")).toBe(ITE_TRIP_GEN_SCREENING_CAVEAT);
  });

  it("produces a payload the spine comparison-snapshots route schema accepts", () => {
    const parsed = createComparisonSnapshotSchema.safeParse(buildDefaultPayload());
    expect(parsed.success).toBe(true);
  });

  it("produces a schema-valid payload even when no KPIs overlap", () => {
    const payload = buildTripGenComparisonPayload({
      baselineEntry: BASELINE_ENTRY,
      candidateEntry: CANDIDATE_ENTRY,
      baselineKpis: [kpi("project_daily_trip_ends", 100)],
      candidateKpis: [],
      label: "Empty overlap",
    });

    expect(payload.indicatorDeltas).toEqual([]);
    expect(createComparisonSnapshotSchema.safeParse(payload).success).toBe(true);
  });

  it("records the engine key and shared KPI names in metadata", () => {
    const payload = buildDefaultPayload();

    expect(payload.metadata.engineKey).toBe("ite_trip_generation");
    expect(payload.metadata.sharedKpiNames).toEqual(Array.from(ITE_TRIP_GEN_KPI_NAMES));
  });
});

describe("splitCaveatForSpine", () => {
  it("returns a short caveat unchanged as a single chunk", () => {
    expect(splitCaveatForSpine("Screening only.")).toEqual(["Screening only."]);
  });

  it("returns nothing for a blank caveat", () => {
    expect(splitCaveatForSpine("   ")).toEqual([]);
  });

  it("splits the real screening caveat at sentence boundaries without breaking §15064.3", () => {
    expect(ITE_TRIP_GEN_SCREENING_CAVEAT.length).toBeGreaterThan(SPINE_CAVEAT_MAX_LENGTH);

    const chunks = splitCaveatForSpine(ITE_TRIP_GEN_SCREENING_CAVEAT);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(SPINE_CAVEAT_MAX_LENGTH);
      // Every piece ends on a sentence boundary, not mid-sentence.
      expect(chunk.endsWith(".")).toBe(true);
    }
    expect(chunks.join(" ")).toBe(ITE_TRIP_GEN_SCREENING_CAVEAT);
    // The section-number period must not become a split point.
    expect(chunks.some((chunk) => chunk.includes("§15064.3"))).toBe(true);
    expect(chunks.some((chunk) => chunk.endsWith("§15064."))).toBe(false);
  });

  it("hard-truncates a single sentence longer than the cap as a last resort", () => {
    const oversized = `${"word ".repeat(120)}end.`;
    const chunks = splitCaveatForSpine(oversized, 100);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it("keeps the exported TRIP_GEN_COMPARISON_CAVEATS constant schema-compliant", () => {
    const caveatSchema = z.array(z.string().trim().min(1).max(400)).max(25);
    expect(caveatSchema.safeParse([...TRIP_GEN_COMPARISON_CAVEATS]).success).toBe(true);
  });
});
