import { describe, expect, it } from "vitest";

import {
  buildCountyRunProvenanceDocument,
  claimCeiling,
  type CountyRunProvenanceInput,
} from "@/lib/models/county-run-provenance";
import { countyOnrampManifestSchema, getCountyRunCaveats } from "@/lib/models/county-onramp";

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

  it("warns when most of a small area's driving leaves it", () => {
    // Widening the front door beyond counties made small study areas ordinary,
    // and a small area's per-capita figure understates badly: the same county
    // measured 40.5 vehicle-miles per person while a sub-county area inside it
    // measured 10.8. Not less driving — a boundary.
    const document = buildCountyRunProvenanceDocument(
      input({
        manifest: manifestWith({
          per_capita_understatement_caveat:
            "33% of residents' trips leave this study area, so the figure understates how much they drive.",
        }),
      })
    );
    expect(document).toContain("33% of residents' trips leave this study area");
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

  it("refuses to present the calibration's own best score as the run's accuracy", () => {
    // CHANGED 2026-08-17, because the old claim became false. The calibration
    // scores every candidate on its held-back stations and keeps the best, so
    // that score is a best-of-several and is optimistic by construction. On one
    // measured county it read 16% where an independent count set put the same
    // run at 60%. A funding application quoting the 16% would be quoting a
    // number nobody could reproduce.
    const document = buildCountyRunProvenanceDocument(validated);

    expect(document).toContain("17 stations held back and never fitted");
    expect(document).toContain("43.29");
    expect(document).toContain("Best score found while choosing between calibration candidates");
    expect(document).toContain("not this run's accuracy, and must not be quoted as one");
    expect(document).toContain("best-of-several and reads better");
    // And it must point at the figure that IS the accuracy.
    expect(document).toContain("counts the calibration never saw");
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

/**
 * THE LIVE PARSE PATH, NOT A CAST.
 *
 * On 2026-08-16 a review found both of this file's headline promises broken in
 * production while every test here stayed green: the ingest schema silently
 * stripped the producer's top-level `calibration` and `assumptions` keys, so
 * the caveat card called fitted runs "Uncalibrated" and this appendix denied
 * any assumptions were recorded. The fixtures above are cast straight past the
 * zod parse, which is exactly how the defect hid. Every fixture in the two
 * describe blocks below therefore goes THROUGH countyOnrampManifestSchema.parse
 * — a schema that strips again fails here first.
 */
function parsedProducerManifest(extra: Record<string, unknown> = {}) {
  return countyOnrampManifestSchema.parse({
    schema_version: "openplan.county_onramp_manifest.v1",
    generated_at: "2026-08-16T10:00:00.000Z",
    name: "example-county-2026",
    county_fips: "06001",
    county_prefix: "EXA",
    run_dir: "data/screening-runs/example-county-2026",
    mode: "build-and-bootstrap",
    stage: "runtime-complete",
    artifacts: {
      scaffold_csv: "validation/scaffold.csv",
      review_packet_md: "validation/review.md",
      run_summary_json: null,
      bundle_manifest_json: null,
      validation_summary_json: null,
    },
    runtime: {
      keep_project: false,
      force: false,
      overall_demand_scalar: null,
      external_demand_scalar: null,
      hbw_scalar: null,
      hbo_scalar: null,
      nhb_scalar: null,
    },
    summary: {
      run: {
        zone_count: 26,
        population_total: 100_382,
        jobs_total: 30_000,
        loaded_links: 28_670,
        final_gap: null,
        total_trips: 578_262,
      },
      validation: null,
      bundle_validation: null,
    },
    ...extra,
  });
}

const producerCalibration = {
  performed: true,
  claim_tier: "calibrated_to_counts",
  fit_station_count: 28,
  holdout_station_count: 12,
  selection_trials_scored_on_holdout: 7,
  baseline: { holdout: { median_ape: 40.1 } },
  calibrated: { holdout: { median_ape: 16.1 } },
};

describe("what the producer wrote at the top level survives ingest", () => {
  it("the calibration record survives the manifest schema", () => {
    const manifest = parsedProducerManifest({ calibration: producerCalibration });
    expect(manifest.calibration).toMatchObject({ performed: true, holdout_station_count: 12 });
  });

  it("the assumptions record survives the manifest schema", () => {
    const manifest = parsedProducerManifest({ assumptions: { basis: "OpenPlan's own defaults" } });
    expect(manifest.assumptions).toMatchObject({ basis: "OpenPlan's own defaults" });
  });

  it("a top-level key this schema has never heard of survives too", () => {
    // Kills the CLASS, not the instance: the next key a producer adds must not
    // need a schema edit here to reach the appendix.
    const manifest = parsedProducerManifest({ some_future_producer_key: { recorded: true } });
    expect((manifest as Record<string, unknown>).some_future_producer_key).toEqual({ recorded: true });
  });

  it("the caveat card calls a fitted run calibrated, fed from the parsed manifest", () => {
    const manifest = parsedProducerManifest({ calibration: producerCalibration });
    const caveats = getCountyRunCaveats("validated-screening", manifest);
    expect(caveats).toContain(
      "Calibrated to published counts, graded on 12 stations held back from the fitting"
    );
    expect(caveats).not.toContain("Uncalibrated");
  });

  it("the appendix renders the calibration section from the parsed manifest", () => {
    const document = buildCountyRunProvenanceDocument(
      input({ manifest: parsedProducerManifest({ calibration: producerCalibration }) })
    );
    expect(document).toContain("calibrated_to_counts");
    expect(document).not.toContain("**Not calibrated.**");
  });
});

describe("an empty validation record is a run that was never compared", () => {
  // The create route, the worker callback and a scaffold edit all store `{}`
  // for a run with no validation — not null. `{}` is truthy, and gating on
  // truthiness made this appendix assert a failed comparison nobody ran.
  it("claimCeiling on {} says never-compared, and does not invent a failed comparison", () => {
    const ceiling = claimCeiling(input({ validationSummary: {} }));
    expect(ceiling).toContain("NOT been compared");
    expect(ceiling).not.toContain("DID NOT meet");
  });

  it("the document body on {} reports no comparison, not a failed one", () => {
    const document = buildCountyRunProvenanceDocument(input({ validationSummary: {} }));
    expect(document).toContain("never compared against observed traffic counts");
    expect(document).not.toContain("DID NOT meet");
  });

  it("a real failed comparison still reads as one", () => {
    const ceiling = claimCeiling(
      input({
        validationSummary: {
          screening_gate: { status_label: "internal prototype only" },
          metrics: { median_absolute_percent_error: 62.8 },
        },
      })
    );
    expect(ceiling).toContain("DID NOT meet");
  });
});

describe("the accuracy chart inside the funder document", () => {
  /**
   * A SINGLE MEDIAN ERROR IS TRUE OF NO ROAD IN PARTICULAR.
   *
   * Measured across 24 counties, a run's error on freeways and on collectors
   * differ by a factor of three. This document is what leaves the building, so
   * the breakdown has to travel inside it — including the part that stops a
   * flattering number being quoted.
   */
  const WITH_ROAD_CLASSES = {
    stations_matched: 66,
    stations_total: 70,
    screening_gate: { status_label: "not screening-ready", ready_median_ape_threshold: 30 },
    metrics: {
      median_absolute_percent_error: 79.8,
      by_road_class: [
        { road_class: "motorway", stations: 25, median_absolute_percent_error: 42.73, median_model_over_observed: 0.621 },
        { road_class: "primary", stations: 33, median_absolute_percent_error: 227.8, median_model_over_observed: 3.28 },
        { road_class: "tertiary", stations: 1, median_absolute_percent_error: 1.2, median_model_over_observed: 1.01 },
      ],
    },
  };

  function documentWith(validationSummary: Record<string, unknown> | null): string {
    return buildCountyRunProvenanceDocument({
      runName: "Nevada County screening run",
      geographyLabel: "Nevada County",
      geographyId: "06057",
      generatedAt: "2026-08-17T20:00:00.000Z",
      stage: "completed",
      manifest: null,
      sources: [],
      evidence: null,
      validationSummary,
    } as never);
  }

  it("embeds the chart so it survives being downloaded and emailed", () => {
    const text = documentWith(WITH_ROAD_CLASSES);
    // A chart that lives at a URL is a chart that is missing a year later.
    expect(text).toContain("data:image/svg+xml;base64,");
    expect(text).toContain("Median error by road type");
  });

  it("carries the same figures as a table, so a stripped-image viewer still reads them", () => {
    const text = documentWith(WITH_ROAD_CLASSES);
    expect(text).toContain("| Road type | Stations | Median error | Model ÷ observed |");
    expect(text).toContain("| motorway | 25 | 42.7% | 0.62 |");
    expect(text).toContain("| primary | 33 | 227.8% | 3.28 |");
  });

  it("warns in words that a one-station figure is not evidence", () => {
    // Tertiary reads 1.2% here — the best number on the chart, over one station.
    const text = documentWith(WITH_ROAD_CLASSES);
    expect(text).toContain("a 1% error over one station is one");
  });

  it("says nothing at all rather than drawing an empty chart when no breakdown was recorded", () => {
    const text = documentWith({ stations_matched: 4, metrics: { median_absolute_percent_error: 50 } });
    expect(text).not.toContain("data:image/svg+xml");
    expect(text).not.toContain("Median error by road type");
  });

  it("drops a road class whose figures are missing rather than drawing it as zero", () => {
    const text = documentWith({
      ...WITH_ROAD_CLASSES,
      metrics: {
        by_road_class: [
          { road_class: "motorway", stations: 25, median_absolute_percent_error: 42.73 },
          { road_class: "trunk", stations: null, median_absolute_percent_error: null },
        ],
      },
    });
    expect(text).toContain("| motorway |");
    expect(text).not.toContain("| trunk |");
  });
});

describe("why fewer stations were matched than published", () => {
  // Both exclusions LOWER the matched count. A planner reading "38 of 71" with
  // no reason cannot tell a thin count set from a well-filtered one, and both
  // exclusions arrived in the worker on 2026-08-18 — so the number moved for
  // every run without any explanation on the surface that shows it.
  const withExclusions = (validation: Record<string, unknown>) =>
    buildCountyRunProvenanceDocument(
      input({
        validationSummary: {
          screening_gate: { status_label: "bounded screening-ready" },
          stations_matched: 38,
          stations_total: 71,
          ...validation,
        },
      })
    );

  it("names ramp counts that were set aside, and why they would mislead", () => {
    const document = withExclusions({ stations_excluded_not_mainline: 12 });
    expect(document).toContain("Set aside — ramps and connectors:** 12");
    expect(document).toContain("mainline it leaves");
  });

  it("distinguishes stations merged at their median from stations that disagree", () => {
    const document = withExclusions({
      shared_model_links: { stations_merged_away: 9, stations_excluded_as_ambiguous: 12 },
    });
    expect(document).toContain("several stations on one link:** 9");
    expect(document).toContain("compared once at their median");
    expect(document).toContain("one link, disagreeing counts:** 12");
    expect(document).toContain("nothing in the data says which station belongs");
  });

  it("says nothing at all for a run made before the worker recorded this", () => {
    // "0 excluded" and "never measured" are different facts, and a run that
    // predates the fields must not be reported as having excluded nothing.
    const document = withExclusions({});
    expect(document).not.toContain("Set aside");
  });

  it("says nothing when a run measured the exclusions and found none", () => {
    const document = withExclusions({
      stations_excluded_not_mainline: 0,
      shared_model_links: { stations_merged_away: 0, stations_excluded_as_ambiguous: 0 },
    });
    expect(document).not.toContain("Set aside");
  });
});

describe("accuracy figures graded by rules that no longer apply", () => {
  const graded = (validation: Record<string, unknown>) =>
    buildCountyRunProvenanceDocument(
      input({
        validationSummary: {
          screening_gate: { status_label: "bounded screening-ready" },
          stations_matched: 38,
          stations_total: 71,
          ...validation,
        },
      })
    );

  it("tells a planner how many counted roads the run put no traffic on", () => {
    // Added 2026-08-20 to both count-validation lanes and rendered nowhere,
    // which is this repository's signature defect — a complete, tested
    // capability no planner can reach. The station is KEPT in every figure, so
    // this is not a set-aside line; it explains a 100% error that measures the
    // zone system's reach rather than the demand estimate.
    const document = graded({ stations_on_unloaded_links: 7 });
    expect(document).toContain("Counted roads this run put no traffic on");
    expect(document).toContain("7 of 38");
    // The two things a planner must not conclude on their own.
    expect(document).toContain("pull the median toward 100");
    expect(document).toContain("Removing them would raise the reported accuracy");
  });

  it("says nothing about unloaded links when the run recorded none, or never measured", () => {
    // "none" and "never measured" are different facts, and printing a zero for
    // an unrecorded field would assert the first while meaning the second.
    expect(graded({ stations_on_unloaded_links: 0 })).not.toContain("put no traffic on");
    expect(graded({})).not.toContain("put no traffic on");
  });

  it("tells a planner which roads the run can speak about at all", () => {
    // The claim boundary a corridor number rests on: 77-85% of the links inside
    // a study area receive no traffic, almost all of the minor ones. A planner
    // reading a road volume is entitled to know a road with none has NO
    // estimate rather than a low one.
    const document = graded({
      network_coverage: {
        measured: true,
        links_inside_study_area: 36096,
        links_carrying_traffic: 6977,
        share_carrying_traffic: 0.1933,
        share_empty: 0.8067,
        worst_class_a_planner_would_ask_about: "residential",
        by_road_class: { residential: { links: 20000, carrying_traffic: 400, share_empty: 0.98 } },
      },
    });
    expect(document).toContain("Which roads this run can speak about");
    expect(document).toContain("19%");
    expect(document).toContain("36,096");
    expect(document).toContain("residential");
    // The sentence that stops a planner reading a missing road as a quiet one.
    expect(document).toContain("no estimate — which is not the same as a low one");
  });

  it("says nothing about coverage when the run never measured it", () => {
    // A run that did not measure coverage has not got full coverage, and
    // asserting either way would be a claim nobody made.
    expect(graded({})).not.toContain("Which roads this run can speak about");
    expect(graded({ network_coverage: { measured: false, reason: "no boundary" } }))
      .not.toContain("Which roads this run can speak about");
    // …and `measured: false` governs even when numbers are present beside it.
    // Without this the flag is defended only by the fields happening to be
    // absent, which is an accident rather than a contract — a producer that
    // recorded partial figures on a failed measurement would publish them.
    expect(
      graded({
        network_coverage: {
          measured: false,
          reason: "boundary unreadable",
          links_inside_study_area: 100,
          share_carrying_traffic: 0.19,
          share_empty: 0.81,
        },
      })
    ).not.toContain("Which roads this run can speak about");
  });

  it("warns when a summary carries no rules version at all", () => {
    // Every run stored before 2026-08-18. Its median error is a different
    // quantity under the same name, and on the page the two look identical.
    expect(graded({})).toContain("superseded rules");
    expect(graded({})).toContain("unstamped");
  });

  it("warns when the summary was graded by an older revision", () => {
    expect(graded({ validation_rules_version: 1 })).toContain("revision 1");
    // Revision 2 graded frontage-road and interchange-connection counts against
    // the mainline beside them, and set aside highway counts for being located
    // near one. Every run stored before 2026-08-20 reports that quantity.
    expect(graded({ validation_rules_version: 2 })).toContain("revision 2");
  });

  it("says nothing when the run was graded by the current rules", () => {
    expect(graded({ validation_rules_version: 3 })).not.toContain("superseded");
  });

  it("says nothing about a future revision it does not know", () => {
    // A worker ahead of the app is not a stale run, and calling it stale would
    // be worse than silence.
    expect(graded({ validation_rules_version: 4 })).not.toContain("superseded");
  });
});

describe("whether the run counted cars or people", () => {
  // Until 2026-08-18 the trip-based model assigned PERSON trips to the road
  // network as though each were a car, and assigned walking and cycling too.
  // The same county re-run afterwards reports roughly 27% less traffic, and a
  // planner holding one of each sees that drop with nothing explaining it.
  const withDemand = (demand: Record<string, unknown>) =>
    buildCountyRunProvenanceDocument(
      input({ manifest: manifestWith({ zone_count: 26 }, { demand }) })
    );

  it("an older run says its traffic figures are about 1.6 times too high", () => {
    const document = withDemand({ demand_source: "gravity_v1", trip_rates: {} });
    expect(document).toContain("as though each were a vehicle");
    expect(document).toContain("1.6 times too high");
  });

  it("a corrected run states the occupancies it used", () => {
    const document = withDemand({
      demand_source: "gravity_v1",
      trip_rates: {
        vehicle_occupancy_applied: { hbw: 1.08, hbo: 1.72, nhb: 1.52 },
        mode_split_applied: { auto_share_of_person_trips: 0.875 },
      },
    });
    expect(document).toContain("hbw 1.08");
    expect(document).toContain("87.5% of person-trips were driven");
    expect(document).not.toContain("1.6 times too high");
  });

  it("a corrected run with no mode split says walking is still on the roads", () => {
    const document = withDemand({
      demand_source: "gravity_v1",
      trip_rates: { vehicle_occupancy_applied: { hbw: 1.08 }, mode_split_applied: null },
    });
    expect(document).toContain("No mode split was applied");
  });

  it("says nothing for a run whose demand came from another model", () => {
    // An ActivitySim package is already in vehicles; warning about it would be
    // wrong, and warning about every run trains everyone to ignore the warning.
    const document = withDemand({ demand_source: "supplied_package", trip_rates: {} });
    expect(document).not.toContain("as though each were a vehicle");
  });

  it("says nothing for a run that recorded no trip rates at all", () => {
    expect(withDemand({ demand_source: "gravity_v1" })).not.toContain("as though each were a vehicle");
  });
});
