import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  COUNTY_RUN_NON_PASSING_GATE_STATUSES,
  countyOnrampRunSnapshotSchema,
  countyRunZoneResolutionCaveat,
  isPassingCountyRunGateStatus,
} from "@/lib/models/county-onramp";
import { getCountyRunMetricHighlights } from "@/lib/ui/county-onramp";
import type { CountyOnrampManifest } from "@/lib/models/county-onramp";

/**
 * THE SECOND DOOR.
 *
 * OpenPlan has two lanes that compare modelled link volumes to observed counts,
 * and each has its own `classify_gate`: the AequilibraE worker (in-app model
 * runs) and the county onramp (`scripts/modeling/validate_screening_observed_
 * counts.py`, run by an operator and posted back). Qualifying one and not the
 * other is this repository's named seam defect — a geofence enforced on one of
 * two submission doors — so the same rule has to hold here.
 *
 * The county lane's consequence is `isPassingCountyRunGateStatus`, which the
 * model detail page uses to decide whether a county run counts as PASSING
 * MODELING EVIDENCE. A run whose zone system cannot support a link-level
 * comparison did not establish that, whatever its validator recorded offline.
 *
 * The verdict is recomputed from the NUMBER at read time rather than read back
 * out of the stored gate string, because the county validator wrote its gate
 * before this qualification existed and an operator reruns it by hand.
 */

const COARSE = 0.36; // the measured 26-zone precedent, as a FRACTION
const WORKABLE = 0.126; // the measured block-group figure

describe("a county run's gate answers to its own zone system", () => {
  it("still passes a run whose zone system supports the comparison", () => {
    // A qualification that refused everything would be safe and useless.
    expect(isPassingCountyRunGateStatus("bounded screening-ready", WORKABLE)).toBe(true);
    expect(isPassingCountyRunGateStatus("bounded screening-ready", 0)).toBe(true);
  });

  it("refuses to treat a coarse-zone run as passing evidence", () => {
    // THE DEFECT. Before this, the gate string alone decided, so a run the
    // product's own zone panel calls unsettleable counted as passing evidence.
    expect(isPassingCountyRunGateStatus("bounded screening-ready", COARSE)).toBe(false);
  });

  it("leaves the gate's own verdict standing when the share was never measured", () => {
    // An unmeasured share is a missing measurement, not a coarse zone system.
    // Refusing every county run recorded before the share existed would be a
    // refusal nobody could act on.
    expect(isPassingCountyRunGateStatus("bounded screening-ready", null)).toBe(true);
    expect(isPassingCountyRunGateStatus("bounded screening-ready", undefined)).toBe(true);
    expect(isPassingCountyRunGateStatus("bounded screening-ready")).toBe(true);
    // A non-finite value is not a measurement either.
    expect(isPassingCountyRunGateStatus("bounded screening-ready", Number.NaN)).toBe(true);
  });

  it("never promotes a non-passing gate, whatever the zone system says", () => {
    // The qualification only ever removes a claim. A fine zone system does not
    // rescue a run that failed its own validator.
    for (const status of COUNTY_RUN_NON_PASSING_GATE_STATUSES) {
      expect(isPassingCountyRunGateStatus(status, 0.01)).toBe(false);
      expect(isPassingCountyRunGateStatus(status, null)).toBe(false);
    }
    expect(isPassingCountyRunGateStatus(null, 0.01)).toBe(false);
    expect(isPassingCountyRunGateStatus("", 0.01)).toBe(false);
  });
});

describe("the caveat that travels with a county run's APE figures", () => {
  it("explains a coarse zone system and names the heuristic as OpenPlan's own", () => {
    const caveat = countyRunZoneResolutionCaveat(COARSE, 26);
    expect(caveat).not.toBeNull();
    expect(caveat!).toContain("36.0%");
    expect(caveat!).toContain("26 zones");
    // It must never read as a verdict that the model is wrong...
    expect(caveat!).toMatch(/not evidence about the model's demand|cannot establish/i);
    // ...and must disclose whose judgement the banding is.
    expect(caveat!).toContain("not an adopted standard");
  });

  it("says nothing when the zone system does not disqualify the comparison", () => {
    // Rendered unconditionally it would become boilerplate a reader skips —
    // and would imply a limit that does not apply to this run.
    expect(countyRunZoneResolutionCaveat(WORKABLE, 80)).toBeNull();
    expect(countyRunZoneResolutionCaveat(null, 80)).toBeNull();
    expect(countyRunZoneResolutionCaveat(undefined, 80)).toBeNull();
  });
});

describe("the county manifest carries the share the qualification needs", () => {
  it("accepts the share the county runtime now records", () => {
    const parsed = countyOnrampRunSnapshotSchema.parse({
      zone_count: 26,
      population_total: 100000,
      jobs_total: 40000,
      loaded_links: 900,
      final_gap: 0.008,
      total_trips: 319000,
      intrazonal_trip_share: COARSE,
    });
    expect(parsed.intrazonal_trip_share).toBe(COARSE);
  });

  it("accepts a manifest from before the share existed", () => {
    // Every county run recorded to date has no share. The schema must not
    // reject them, and the qualification must degrade to "not measured".
    const parsed = countyOnrampRunSnapshotSchema.parse({
      zone_count: 26,
      population_total: null,
      jobs_total: null,
      loaded_links: null,
      final_gap: null,
      total_trips: null,
    });
    expect(parsed.intrazonal_trip_share ?? null).toBeNull();
  });

  it("surfaces the caveat through the metric highlights the detail page renders", () => {
    // The assertion has to sit where the real call happens: a caveat computed
    // in a helper nothing mounts is the invisible-capability defect again.
    const manifest = {
      summary: {
        run: { zone_count: 26, intrazonal_trip_share: COARSE },
        validation: { metrics: { median_absolute_percent_error: 24.1 } },
      },
    } as unknown as CountyOnrampManifest;

    const metrics = getCountyRunMetricHighlights(manifest);
    expect(metrics.medianApe).toBe(24.1);
    expect(metrics.zoneResolutionCaveat).not.toBeNull();
    expect(metrics.zoneResolutionCaveat!).toContain("26 zones");

    const fine = getCountyRunMetricHighlights({
      summary: {
        run: { zone_count: 80, intrazonal_trip_share: WORKABLE },
        validation: { metrics: { median_absolute_percent_error: 24.1 } },
      },
    } as unknown as CountyOnrampManifest);
    expect(fine.zoneResolutionCaveat).toBeNull();
  });

  it("asks the database for the column the qualification depends on", () => {
    /**
     * THE ASSERTION NO MOCK CAN MAKE.
     *
     * The model detail page decides whether a county run counts as passing
     * modeling evidence, and it needs `run_summary_json` to see the share. The
     * Supabase clients are untyped by convention, so dropping that column from
     * the `.select()` leaves every other test in this file green while the
     * share arrives `undefined` — which this function deliberately treats as
     * "not measured" and therefore PASSES. A silent, one-word revert to exactly
     * the behaviour this change exists to remove.
     *
     * Verified by mutation: with `run_summary_json` removed from the
     * projection, every other test here still passed.
     */
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(app)/models/[modelId]/page.tsx"),
      "utf8"
    );
    const countyRunsRead = source.slice(source.indexOf('.from("county_runs")'));
    expect(countyRunsRead).toContain('.from("county_runs")');

    /**
     * The projection STRING LITERAL, not the surrounding block.
     *
     * The first version of this assertion scanned everything between
     * `.from("county_runs")` and `.eq(`, which includes the comment explaining
     * why the column is projected — so it passed with the column removed,
     * satisfied by its own documentation. That is a named failure mode in this
     * repository, and it survived a mutation before being caught here.
     */
    const projection = /\.select\(\s*"([^"]*)"/.exec(countyRunsRead)?.[1];
    expect(projection, "could not find the county_runs .select() literal").toBeTypeOf("string");
    const columns = projection!.split(",").map((column) => column.trim());
    expect(columns).toContain("run_summary_json");
    expect(columns).toContain("status_label");
    expect(columns).toContain("stage");
  });
});
