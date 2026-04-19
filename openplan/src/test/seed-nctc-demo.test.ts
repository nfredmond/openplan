import { describe, expect, it } from "vitest";

import {
  DEMO_COUNTY_RUN_ID,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_RTP_LINK_ID,
  DEMO_RTP_CYCLE_ID,
  DEMO_WORKSPACE_ID,
  buildSeedRecords,
} from "../../scripts/seed-nctc-demo";

const ownerUserId = "00000000-0000-4000-8000-00000000cafe";

const bundleManifest: Record<string, unknown> = {
  screening_grade: true,
  zones: { zones: 191 },
  assignment: { loaded_links: 2400 },
  run_name: "nevada-county-runtime-norenumber-freeze-20260324",
};

const validationSummary: Record<string, unknown> = {
  status_label: "internal prototype only",
  median_ape_pct: 27.4,
  max_ape_pct: 237.6,
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
});
