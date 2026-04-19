import { describe, expect, it } from "vitest";

import {
  DEMO_COUNTY_RUN_ID,
  DEMO_EXISTING_CONDITIONS_CHAPTER_ID,
  DEMO_EXISTING_CONDITIONS_CHAPTER_KEY,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_RTP_LINK_ID,
  DEMO_RTP_CYCLE_ID,
  DEMO_WORKSPACE_ID,
  buildExistingConditionsChapterMarkdown,
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
    expect(records.rtpCycle.created_by).toBe(ownerUserId);
    expect(records.projectRtpLink.created_by).toBe(ownerUserId);
    expect(records.countyRun.created_by).toBe(ownerUserId);
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
