import { describe, expect, it } from "vitest";

import {
  buildCountyRunProvenanceDocument,
  claimCeiling,
  type CountyRunProvenanceInput,
} from "@/lib/models/county-run-provenance";

/**
 * A PAPER TRAIL THAT CANNOT DESCRIBE WHAT WAS SKIPPED IS A BROCHURE.
 *
 * This document goes into a funding application and may be read years later by
 * someone who cannot re-run anything. The dangerous failure is not a wrong
 * number — it is a MISSING one that reads as absent-because-irrelevant rather
 * than absent-because-never-measured.
 *
 * So most of these tests drive the builder with runs that did NOT do things,
 * and assert the document says so out loud, in the same place a successful run
 * would have reported good news.
 */

function input(overrides: Partial<CountyRunProvenanceInput> = {}): CountyRunProvenanceInput {
  return {
    runName: "example-county-2026",
    geographyLabel: "Example County, CA",
    geographyId: "06001",
    stage: "runtime-complete",
    statusLabel: null,
    manifest: null,
    validationSummary: null,
    modelingEvidence: null,
    generatedAt: "2026-08-16T10:00:00.000Z",
    ...overrides,
  };
}

function manifestWith(run: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { summary: { run }, ...extra } as unknown as CountyRunProvenanceInput["manifest"];
}

describe("what the run did not do is visible", () => {
  it("says a run was never checked against counts, where accuracy would go", () => {
    const document = buildCountyRunProvenanceDocument(input());
    expect(document).toContain("never compared against observed traffic counts");
    // And it distinguishes "not measured" from "measured and not reported".
    expect(document).toContain("nothing was measured, so nothing can be claimed");
  });

  it("says a run was not calibrated rather than staying silent", () => {
    expect(buildCountyRunProvenanceDocument(input())).toContain("**Not calibrated.**");
  });

  it("says when no data sources were recorded, and calls that the finding", () => {
    const document = buildCountyRunProvenanceDocument(input());
    expect(document).toContain("No data sources were recorded");
    expect(document).toContain("treat the run as undocumented");
  });

  it("writes a missing figure as not recorded, never as blank or zero", () => {
    const document = buildCountyRunProvenanceDocument(input({ manifest: manifestWith({}) }));
    expect(document).toContain("_not recorded_");
    // A zero would be a measurement. Nothing here measured zero.
    expect(document).not.toMatch(/Roads carrying traffic:\*\* 0$/m);
  });

  it("warns in bold when the assignment did not reach equilibrium", () => {
    const document = buildCountyRunProvenanceDocument(
      input({
        manifest: manifestWith({
          assignment_converged: false,
          assignment_convergence_caveat: "It stopped after 50 iterations with a gap of 0.0243.",
          loaded_links: 5254,
        }),
      })
    );
    expect(document).toContain("**NO — the volumes below are from part-way through a calculation**");
    expect(document).toContain("It stopped after 50 iterations");
  });

  it("does not assert a convergence failure that was never measured", () => {
    // Absent is not false. A producer that recorded nothing has not failed.
    const document = buildCountyRunProvenanceDocument(input({ manifest: manifestWith({}) }));
    expect(document).not.toContain("part-way through a calculation");
  });
});

describe("the claim ceiling reflects what the run actually established", () => {
  it("an unvalidated run may not present road-by-road volumes", () => {
    const ceiling = claimCeiling(input());
    expect(ceiling).toContain("NOT been compared against observed traffic counts");
    expect(ceiling).toContain("must not be presented as measured");
  });

  it("a run that FAILED its gate says so, and still permits reporting the gap", () => {
    const ceiling = claimCeiling(
      input({
        validationSummary: { screening_gate: { status_label: "internal prototype only" } },
      })
    );
    expect(ceiling).toContain("DID NOT meet");
    expect(ceiling).toContain("internal prototype only");
    // The comparison is evidence even when the figures are not.
    expect(ceiling).toContain("the gap it found, are reportable");
  });

  it("a run that PASSED says something different, and still refuses environmental review", () => {
    const ceiling = claimCeiling(
      input({
        validationSummary: { screening_gate: { status_label: "bounded screening-ready" } },
      })
    );
    expect(ceiling).toContain("met OpenPlan's screening thresholds");
    expect(ceiling).toContain("must not be used for environmental review");
    expect(ceiling).not.toContain("DID NOT meet");
  });

  it("every ceiling refuses environmental review or says the run is unvalidated", () => {
    // The one boundary that must hold in all three states.
    const states: CountyRunProvenanceInput[] = [
      input(),
      input({ validationSummary: { screening_gate: { status_label: "internal prototype only" } } }),
      input({ validationSummary: { screening_gate: { status_label: "bounded screening-ready" } } }),
    ];
    for (const state of states) {
      const ceiling = claimCeiling(state);
      expect(
        /environmental review|unvalidated model output/i.test(ceiling),
        `ceiling grants no limit: ${ceiling}`
      ).toBe(true);
    }
  });
});

describe("what a validated, calibrated run reports", () => {
  const validated = input({
    manifest: manifestWith(
      { zone_count: 26, loaded_links: 5254, total_trips: 578262, intrazonal_trip_share: 0.087, assignment_converged: true, final_gap: 0.0095 },
      {
        calibration: {
          performed: true,
          claim_tier: "calibrated_to_counts",
          fit_station_count: 40,
          holdout_station_count: 17,
          baseline: { holdout: { median_ape: 62.8 } },
          calibrated: { holdout: { median_ape: 43.29 } },
        },
      }
    ),
    validationSummary: {
      screening_gate: {
        status_label: "internal prototype only",
        ready_median_ape_threshold: 30,
        ready_critical_ape_threshold: 50,
        reasons: ["Median absolute percent error is 43.29%, above the 30.00% screening threshold."],
      },
      metrics: {
        median_absolute_percent_error: 43.29,
        max_absolute_percent_error: 1495.8,
        spearman_rho_facility_ranking: 0.437,
      },
      stations_matched: 57,
      stations_total: 57,
      count_source_agencies: ["Caltrans"],
    },
    modelingEvidence: {
      claimDecision: null,
      reportLanguage: null,
      sourceManifests: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          sourceKey: "osm_road_network",
          sourceKind: "osm",
          sourceLabel: "OpenStreetMap roadway network",
          sourceUrl: "https://www.openstreetmap.org",
          sourceVintage: "2026",
          geographyId: "06001",
          geographyLabel: "Example County, CA",
          licenseNote: "ODbL",
          citationText: "OpenStreetMap roadway network extracted for Example County, CA.",
        },
      ],
      validationResults: [],
    } as unknown as CountyRunProvenanceInput["modelingEvidence"],
  });

  it("names who published the counts, from the counts themselves", () => {
    expect(buildCountyRunProvenanceDocument(validated)).toContain("Caltrans");
  });

  it("reports the held-out accuracy and says why it is the one reported", () => {
    const document = buildCountyRunProvenanceDocument(validated);
    expect(document).toContain("17 stations held back and never fitted");
    expect(document).toContain("43.29");
    expect(document).toContain("model graded on the data it was fitted to grades itself");
  });

  it("shows the before as well as the after, so the gain is checkable", () => {
    const document = buildCountyRunProvenanceDocument(validated);
    expect(document).toContain("62.8");
    expect(document).toContain("Accuracy before calibration");
  });

  it("carries the gate's own reasons rather than paraphrasing them", () => {
    expect(buildCountyRunProvenanceDocument(validated)).toContain(
      "Median absolute percent error is 43.29%, above the 30.00% screening threshold."
    );
  });

  it("cites each data source with its vintage", () => {
    const document = buildCountyRunProvenanceDocument(validated);
    expect(document).toContain("OpenStreetMap roadway network extracted for Example County, CA.");
    expect(document).toContain("2026");
  });

  it("still refuses environmental review even when calibrated", () => {
    expect(buildCountyRunProvenanceDocument(validated)).toContain("environmental review");
  });
});

describe("the assumptions behind the figures", () => {
  it("states plainly that the defaults are OpenPlan's own", () => {
    const document = buildCountyRunProvenanceDocument(
      input({
        manifest: manifestWith(
          {},
          {
            assumptions: {
              provenance:
                "These are OpenPlan's own screening defaults. They are not drawn from a published trip-rate manual.",
              trip_generation: { home_based_other_trips_per_person_per_day: 2.2 },
              trip_distribution_deterrence: { home_based_work_gamma: 1.8 },
            },
          }
        ),
      })
    );
    // A reviewer asking "where does 2.2 trips per person come from?" gets an
    // answer, and the answer does not borrow authority it does not have.
    expect(document).toContain("OpenPlan's own screening defaults");
    expect(document).toContain("not drawn from a published trip-rate manual");
    expect(document).toContain("2.2");
    expect(document).toContain("1.8");
  });

  it("says when a run did not record its assumptions", () => {
    const document = buildCountyRunProvenanceDocument(input({ manifest: manifestWith({}) }));
    expect(document).toContain("did not record the assumptions it used");
    expect(document).toContain("cannot be traced");
  });

  it("names which road extract the figures rest on, and when", () => {
    const document = buildCountyRunProvenanceDocument(
      input({
        manifest: manifestWith({
          network_source: "OpenStreetMap",
          network_downloaded_at: "2026-08-16T20:16:44.714564+00:00",
        }),
      })
    );
    expect(document).toContain("OpenStreetMap, downloaded 2026-08-16T20:16:44");
  });

  it("does not invent a download date the run never captured", () => {
    // An appendix defending a funded figure must not carry a date nobody
    // measured — a plausible timestamp is indistinguishable from a real one.
    const document = buildCountyRunProvenanceDocument(input({ manifest: manifestWith({}) }));
    expect(document).toContain("**Road network:** _not recorded_, downloaded _not recorded_");
  });
});

describe("counts a person typed are distinguishable from counts a feed supplied", () => {
  const withScaffold = (scaffold: Record<string, unknown>) =>
    buildCountyRunProvenanceDocument(
      input({ manifest: { summary: { run: {}, scaffold } } as unknown as CountyRunProvenanceInput["manifest"] })
    );

  it("names the stations a person edited, and says what that costs", () => {
    const document = withScaffold({
      station_count: 8,
      hand_edited_station_ids: ["CT_RTE20_PM12_240", "CT_RTE49_PM10_553"],
      hand_edited_at: "2026-08-16T09:00:00.000Z",
    });
    expect(document).toContain("**2 of 8 count stations were edited by hand**");
    expect(document).toContain("CT_RTE20_PM12_240");
    // The consequence, not just the fact.
    expect(document).toContain("carries the authority of whoever entered it");
  });

  it("says plainly when nothing was hand-edited", () => {
    const document = withScaffold({ station_count: 8, hand_edited_station_ids: [] });
    expect(document).toContain("No count values were changed by hand");
  });

  it("does not claim a clean sheet when no worksheet was recorded", () => {
    // Absent is not "nobody edited anything" — it is "we cannot say".
    const document = buildCountyRunProvenanceDocument(input({ manifest: manifestWith({}) }));
    expect(document).toContain("No count-station worksheet was recorded");
    expect(document).not.toContain("No count values were changed by hand");
  });
});

describe("the document is a record, not a derivation", () => {
  it("is byte-identical for the same run", () => {
    const once = buildCountyRunProvenanceDocument(input());
    const twice = buildCountyRunProvenanceDocument(input());
    expect(once).toBe(twice);
  });

  it("reports a calibration that ran and changed nothing as exactly that", () => {
    const document = buildCountyRunProvenanceDocument(
      input({
        manifest: manifestWith(
          {},
          { calibration: { performed: false, reason: "no step improved the held-out counts" } }
        ),
      })
    );
    expect(document).toContain("did not change the model");
    expect(document).toContain("no step improved the held-out counts");
    // It must not read as though calibration succeeded.
    expect(document).not.toContain("Claim tier:");
  });
});
