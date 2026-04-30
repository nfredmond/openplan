import { describe, expect, it } from "vitest";

import {
  DEMO_COUNTY_RUN_ID,
  DEMO_EXISTING_CONDITIONS_CHAPTER_ID,
  DEMO_EXISTING_CONDITIONS_CHAPTER_KEY,
  DEMO_FUNDING_OPPORTUNITY_ID,
  DEMO_FUNDING_OPPORTUNITY_TITLE,
  DEMO_PLAN_ID,
  DEMO_PLAN_TITLE,
  DEMO_PROGRAM_ID,
  DEMO_PROGRAM_PLAN_LINK_ID,
  DEMO_PROGRAM_TITLE,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_LATITUDE,
  DEMO_PROJECT_LONGITUDE,
  DEMO_PROJECT_RTP_LINK_ID,
  DEMO_REPORT_ARTIFACT_ID,
  DEMO_REPORT_GENERATED_AT,
  DEMO_REPORT_ID,
  DEMO_REPORT_TITLE,
  DEMO_RTP_ANCHOR_LATITUDE,
  DEMO_RTP_ANCHOR_LONGITUDE,
  DEMO_RTP_CYCLE_ID,
  DEMO_WORKSPACE_ID,
  buildExistingConditionsChapterMarkdown,
  buildNctcCountyOnrampManifest,
  buildNctcModelingEvidenceBundle,
  buildSeedRecords,
} from "../../scripts/seed-nctc-demo";

const ownerUserId = "00000000-0000-4000-8000-00000000cafe";

const bundleManifest: Record<string, unknown> = {
  screening_grade: true,
  boundary: {
    label: "Nevada County",
    source_path: "06057",
    area_sq_mi: 973.796,
    bbox: [-121.279784, 39.00516, -120.003773, 39.52692],
  },
  zones: {
    zones: 26,
    zone_type: "census-tract-fragments",
    total_population: 102321.99999999993,
    total_households: 41414.99999999997,
    total_worker_residents: 45063.99999999996,
    total_jobs_est: 48252.0,
  },
  demand: {
    hbw_trips: 45064,
    hbo_trips: 225108.4,
    nhb_trips: 92089.8,
    external_trips: 266000,
    total_trips: 628262.2,
  },
  network: {
    largest_component_pct: 95.97,
  },
  assignment: {
    loaded_links: 4829,
    convergence: { final_gap: 0.009548332879985081, iterations: 50, target_gap: 0.01 },
    network: { links: 54944, nodes: 24743, zones: 26 },
  },
  run_name: "nevada-county-runtime-norenumber-freeze-20260324",
};

const validationSummary: Record<string, unknown> = {
  status_label: "internal prototype only",
  model_run_id: "nevada-county-runtime-norenumber-freeze-20260324",
  model_caveats: [
    "screening-grade only",
    "OSM default speeds/capacities",
    "tract fragments are not calibrated TAZs",
  ],
  counts_source_csv: "/data/pilot-nevada-county/validation/caltrans_2023_priority_counts.csv",
  stations_total: 5,
  stations_matched: 5,
  screening_gate: {
    status_label: "internal prototype only",
    reasons: [
      "At least one core facility has 237.62% absolute percent error, above the 50.00% critical-facility threshold.",
    ],
  },
  metrics: {
    median_absolute_percent_error: 27.4,
    mean_absolute_percent_error: 68.75,
    min_absolute_percent_error: 4.1,
    max_absolute_percent_error: 237.62,
    spearman_rho_facility_ranking: 0.4,
  },
  facility_ranking: [
    { station: "SR 20 at Jct Rte 49", observed_volume: 45500, modeled_daily_pce: 73666, obs_rank: 1, mod_rank: 1 },
    { station: "SR 174 at Brunswick Rd", observed_volume: 10300, modeled_daily_pce: 34775, obs_rank: 5, mod_rank: 2 },
  ],
};

describe("buildSeedRecords", () => {
  it("marks the workspace as demo and billing-active via pilot status", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.workspace.id).toBe(DEMO_WORKSPACE_ID);
    expect(records.workspace.is_demo).toBe(true);
    expect(records.workspace.subscription_status).toBe("pilot");
  });

  it("flows the owner user id through every record that records provenance", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.membership.user_id).toBe(ownerUserId);
    expect(records.membership.role).toBe("owner");
    expect(records.project.created_by).toBe(ownerUserId);
    expect(records.plan.created_by).toBe(ownerUserId);
    expect(records.program.created_by).toBe(ownerUserId);
    expect(records.programPlanLink.created_by).toBe(ownerUserId);
    expect(records.fundingOpportunity.created_by).toBe(ownerUserId);
    expect(records.rtpCycle.created_by).toBe(ownerUserId);
    expect(records.projectRtpLink.created_by).toBe(ownerUserId);
    expect(records.countyRun.created_by).toBe(ownerUserId);
    expect(records.report.created_by).toBe(ownerUserId);
    expect(records.reportArtifact.generated_by).toBe(ownerUserId);
  });

  it("preserves the manifest and validation summary verbatim on county_runs", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.countyRun.manifest_json).toBe(bundleManifest);
    expect(records.countyRun.validation_summary_json).toBe(validationSummary);
    expect(records.countyRun.stage).toBe("validated-screening");
    expect(records.countyRun.status_label).toBe("internal prototype only");
    expect(records.countyRun.geography_id).toBe("06057");
    expect(records.countyRun.geography_type).toBe("county_fips");
  });

  it("falls back to the internal-prototype label when validation summary omits it", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, {
      median_ape_pct: 27.4,
    });

    expect(records.countyRun.status_label).toBe("internal prototype only");
  });

  it("ties every record to the demo workspace and uses stable deterministic ids", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.membership.workspace_id).toBe(DEMO_WORKSPACE_ID);
    expect(records.project.id).toBe(DEMO_PROJECT_ID);
    expect(records.project.workspace_id).toBe(DEMO_WORKSPACE_ID);
    expect(records.plan.id).toBe(DEMO_PLAN_ID);
    expect(records.plan.workspace_id).toBe(DEMO_WORKSPACE_ID);
    expect(records.plan.project_id).toBe(DEMO_PROJECT_ID);
    expect(records.program.id).toBe(DEMO_PROGRAM_ID);
    expect(records.program.workspace_id).toBe(DEMO_WORKSPACE_ID);
    expect(records.program.project_id).toBe(DEMO_PROJECT_ID);
    expect(records.programPlanLink.id).toBe(DEMO_PROGRAM_PLAN_LINK_ID);
    expect(records.programPlanLink.program_id).toBe(DEMO_PROGRAM_ID);
    expect(records.programPlanLink.linked_id).toBe(DEMO_PLAN_ID);
    expect(records.fundingOpportunity.id).toBe(DEMO_FUNDING_OPPORTUNITY_ID);
    expect(records.fundingOpportunity.workspace_id).toBe(DEMO_WORKSPACE_ID);
    expect(records.fundingOpportunity.program_id).toBe(DEMO_PROGRAM_ID);
    expect(records.fundingOpportunity.project_id).toBe(DEMO_PROJECT_ID);
    expect(records.report.id).toBe(DEMO_REPORT_ID);
    expect(records.report.workspace_id).toBe(DEMO_WORKSPACE_ID);
    expect(records.report.rtp_cycle_id).toBe(DEMO_RTP_CYCLE_ID);
    expect(records.report.modeling_county_run_id).toBe(DEMO_COUNTY_RUN_ID);
    expect(records.reportArtifact.id).toBe(DEMO_REPORT_ARTIFACT_ID);
    expect(records.reportArtifact.report_id).toBe(DEMO_REPORT_ID);
    expect(records.reportSections.every((section) => section.report_id === DEMO_REPORT_ID)).toBe(true);
    expect(records.rtpCycle.id).toBe(DEMO_RTP_CYCLE_ID);
    expect(records.rtpCycle.workspace_id).toBe(DEMO_WORKSPACE_ID);
    expect(records.projectRtpLink.id).toBe(DEMO_PROJECT_RTP_LINK_ID);
    expect(records.projectRtpLink.project_id).toBe(DEMO_PROJECT_ID);
    expect(records.projectRtpLink.rtp_cycle_id).toBe(DEMO_RTP_CYCLE_ID);
    expect(records.countyRun.id).toBe(DEMO_COUNTY_RUN_ID);
    expect(records.countyRun.workspace_id).toBe(DEMO_WORKSPACE_ID);
  });

  it("is idempotent: the same inputs produce structurally equal records", () => {
    const a = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);
    const b = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(a).toEqual(b);
  });

  it("scopes the RTP cycle to the 2026–2045 horizon the proof doc calls out", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.rtpCycle.horizon_start_year).toBe(2026);
    expect(records.rtpCycle.horizon_end_year).toBe(2045);
    expect(records.rtpCycle.status).toBe("draft");
    expect(records.project.plan_type).toBe("regional_transportation_plan");
    expect(records.project.delivery_phase).toBe("analysis");
  });

  it("adds a deterministic local plan fixture for UI settle plan proof", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.plan.id).toBe(DEMO_PLAN_ID);
    expect(records.plan.title).toBe(DEMO_PLAN_TITLE);
    expect(records.plan.plan_type).toBe("regional");
    expect(records.plan.status).toBe("active");
    expect(records.plan.geography_label).toBe("Nevada County, CA");
    expect(records.plan.horizon_year).toBe(2045);
    expect(records.plan.summary).toContain("plans index/detail");
  });

  it("adds a deterministic local program fixture for UI settle program proof", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.program.id).toBe(DEMO_PROGRAM_ID);
    expect(records.program.title).toBe(DEMO_PROGRAM_TITLE);
    expect(records.program.program_type).toBe("rtip");
    expect(records.program.status).toBe("assembling");
    expect(records.program.funding_classification).toBe("mixed");
    expect(records.program.cycle_name).toContain("RTIP");
    expect(records.program.summary).toContain("programs index/detail");

    expect(records.programPlanLink.link_type).toBe("plan");
    expect(records.programPlanLink.linked_id).toBe(DEMO_PLAN_ID);
    expect(records.programPlanLink.label).toBe(DEMO_PLAN_TITLE);

    expect(records.fundingOpportunity.id).toBe(DEMO_FUNDING_OPPORTUNITY_ID);
    expect(records.fundingOpportunity.title).toBe(DEMO_FUNDING_OPPORTUNITY_TITLE);
    expect(records.fundingOpportunity.opportunity_status).toBe("open");
    expect(records.fundingOpportunity.decision_state).toBe("pursue");
    expect(records.fundingOpportunity.expected_award_amount).toBe(1250000);
  });

  it("adds a deterministic local reports fixture for UI settle reports proof", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.report.id).toBe(DEMO_REPORT_ID);
    expect(records.report.title).toBe(DEMO_REPORT_TITLE);
    expect(records.report.project_id).toBeNull();
    expect(records.report.rtp_cycle_id).toBe(DEMO_RTP_CYCLE_ID);
    expect(records.report.report_type).toBe("board_packet");
    expect(records.report.status).toBe("generated");
    expect(records.report.generated_at).toBe(DEMO_REPORT_GENERATED_AT);
    expect(records.report.latest_artifact_kind).toBe("html");
    expect(records.report.latest_artifact_url).toContain(DEMO_REPORT_ARTIFACT_ID);

    expect(records.reportArtifact.id).toBe(DEMO_REPORT_ARTIFACT_ID);
    expect(records.reportArtifact.artifact_kind).toBe("html");
    expect(records.reportArtifact.generated_at).toBe(DEMO_REPORT_GENERATED_AT);
    expect(records.reportArtifact.metadata_json).toMatchObject({
      metadata_schema_version: "2026-04",
      sourceContext: {
        reportOrigin: "rtp_cycle_packet",
        reportReason: "local_ui_ux_settle_fixture",
        rtpCycleId: DEMO_RTP_CYCLE_ID,
        modelingEvidenceCount: 1,
      },
    });
    expect(JSON.stringify(records.reportArtifact.metadata_json)).toContain(DEMO_REPORT_TITLE);

    expect(records.reportSections.length).toBeGreaterThan(0);
    expect(records.reportSections.map((section) => section.section_key)).toContain("cycle_overview");
    expect(new Set(records.reportSections.map((section) => section.id)).size).toBe(
      records.reportSections.length
    );
  });

  it("anchors the demo project to the Grass Valley map center so the marker renders under the shell viewport", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.project.latitude).toBe(DEMO_PROJECT_LATITUDE);
    expect(records.project.longitude).toBe(DEMO_PROJECT_LONGITUDE);
    expect(DEMO_PROJECT_LATITUDE).toBe(39.239137);
    expect(DEMO_PROJECT_LONGITUDE).toBe(-121.033982);
  });

  it("anchors the RTP cycle pin to Nevada City so it sits beside (not on top of) the Grass Valley project marker", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.rtpCycle.anchor_latitude).toBe(DEMO_RTP_ANCHOR_LATITUDE);
    expect(records.rtpCycle.anchor_longitude).toBe(DEMO_RTP_ANCHOR_LONGITUDE);
    expect(DEMO_RTP_ANCHOR_LATITUDE).toBe(39.2616);
    expect(DEMO_RTP_ANCHOR_LONGITUDE).toBe(-121.0161);
    // Must not collide with the project marker exactly.
    expect(DEMO_RTP_ANCHOR_LATITUDE).not.toBe(DEMO_PROJECT_LATITUDE);
    expect(DEMO_RTP_ANCHOR_LONGITUDE).not.toBe(DEMO_PROJECT_LONGITUDE);
  });

  it("produces the existing-conditions chapter attached to the demo RTP cycle", () => {
    const records = buildSeedRecords(ownerUserId, bundleManifest, validationSummary);

    expect(records.existingConditionsChapter.id).toBe(DEMO_EXISTING_CONDITIONS_CHAPTER_ID);
    expect(records.existingConditionsChapter.workspace_id).toBe(DEMO_WORKSPACE_ID);
    expect(records.existingConditionsChapter.rtp_cycle_id).toBe(DEMO_RTP_CYCLE_ID);
    expect(records.existingConditionsChapter.chapter_key).toBe(DEMO_EXISTING_CONDITIONS_CHAPTER_KEY);
    expect(records.existingConditionsChapter.section_type).toBe("performance");
    expect(records.existingConditionsChapter.status).toBe("ready_for_review");
    expect(records.existingConditionsChapter.sort_order).toBe(5);
    expect(records.existingConditionsChapter.required).toBe(true);
    expect(records.existingConditionsChapter.created_by).toBe(ownerUserId);
  });
});

describe("buildNctcCountyOnrampManifest", () => {
  it("adapts the frozen legacy NCTC bundle into the county-onramp manifest shape", () => {
    const manifest = buildNctcCountyOnrampManifest(bundleManifest, validationSummary);

    expect(manifest.schema_version).toBe("openplan.county_onramp_manifest.v1");
    expect(manifest.name).toBe("nevada-county-runtime-norenumber-freeze-20260324");
    expect(manifest.county_fips).toBe("06057");
    expect(manifest.summary.run.zone_count).toBe(26);
    expect(manifest.summary.run.population_total).toBeCloseTo(102322);
    expect(manifest.summary.run.jobs_total).toBe(48252);
    expect(manifest.summary.run.loaded_links).toBe(54944);
    expect(manifest.summary.run.final_gap).toBeCloseTo(0.009548);
    expect(manifest.summary.run.total_trips).toBe(628262.2);
    expect(manifest.summary.validation?.counts_source_csv).toContain("caltrans_2023_priority_counts.csv");
    expect(manifest.artifacts.validation_summary_json).toBe("validation/validation_summary.json");
  });
});

describe("buildNctcModelingEvidenceBundle", () => {
  it("produces deterministic screening-grade evidence for the NCTC demo seed", () => {
    const bundle = buildNctcModelingEvidenceBundle(bundleManifest, validationSummary);

    expect(bundle.sourceManifests.map((source) => source.sourceKey)).toEqual([
      "census_tiger_boundary",
      "census_acs_zone_attributes",
      "osm_road_network",
      "observed_count_validation",
    ]);
    expect(bundle.validationResults.map((result) => result.metricKey)).toEqual([
      "assignment_final_gap",
      "count_station_matches",
      "median_absolute_percent_error",
      "critical_absolute_percent_error",
      "facility_ranking_spearman_rho",
    ]);
    expect(bundle.claimDecision.claimStatus).toBe("screening_grade");
    expect(bundle.claimDecision.statusReason).toContain("237.62%");
  });
});

describe("buildExistingConditionsChapterMarkdown", () => {
  it("opens with the screening-grade warning block", () => {
    const md = buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary);
    expect(md.startsWith("> **Screening-grade prototype")).toBe(true);
  });

  it("surfaces real manifest values with locale-formatted integers", () => {
    const md = buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary);

    expect(md).toContain("Nevada County");
    expect(md).toContain("06057");
    expect(md).toContain("973.796 square miles");
    expect(md).toContain("102,322"); // total_population rounded and comma-formatted
    expect(md).toContain("628,262"); // total_trips rounded
    expect(md).toContain("54,944"); // network.links
    expect(md).toContain("4,829"); // loaded_links
  });

  it("surfaces validation metrics and the critical-facility threshold reason", () => {
    const md = buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary);

    expect(md).toContain("27.4%"); // median APE
    expect(md).toContain("237.62%"); // max APE at configured 2 digits
    expect(md).toContain("0.40"); // Spearman rho at 2 digits
    expect(md).toContain("critical-facility threshold");
  });

  it("preserves every model caveat verbatim", () => {
    const md = buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary);

    const caveats = validationSummary.model_caveats as string[];
    for (const caveat of caveats) {
      expect(md).toContain(caveat);
    }
  });

  it("renders the facility ranking table with both supplied rows", () => {
    const md = buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary);

    expect(md).toContain("SR 20 at Jct Rte 49");
    expect(md).toContain("SR 174 at Brunswick Rd");
    expect(md).toContain("73,666");
    expect(md).toContain("34,775");
  });

  it("traces every number back to the frozen run id in the closing section", () => {
    const md = buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary);

    expect(md).toContain("nevada-county-runtime-norenumber-freeze-20260324");
    expect(md).toContain("What this chapter is not");
    expect(md).toContain("What this chapter demonstrates");
  });

  it("handles missing validation metrics gracefully with em-dash fallbacks", () => {
    const sparseSummary: Record<string, unknown> = {
      status_label: "internal prototype only",
      model_caveats: [],
      screening_gate: {},
      metrics: {},
    };
    const md = buildExistingConditionsChapterMarkdown(bundleManifest, sparseSummary);

    expect(md).toContain("—");
    expect(md).toContain("Screening-grade prototype"); // header block still present
  });
});
