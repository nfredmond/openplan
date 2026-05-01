/**
 * Phase Q.1 — NCTC 90% plan example seed.
 *
 * Idempotently seeds a proof-of-capability demo workspace anchored to the
 * Nevada County screening artifact at
 * data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/.
 *
 * This script runs locally against a Supabase project using the
 * service-role key. It does NOT ship as a route — the artifact directory
 * lives outside the Next.js bundle, so a POST-from-disk route would fail
 * on Vercel (see docs/ops/2026-04-19-phase-q-scope.md for the revision
 * rationale).
 *
 * Usage:
 *   pnpm seed:nctc                              # uses .env.local
 *   tsx scripts/seed-nctc-demo.ts --env-file /tmp/openplan.vercel.env
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildCountyRunModelingEvidenceBundle,
  refreshCountyRunModelingEvidence,
} from "../src/lib/models/evidence-backbone";
import type { CountyOnrampManifest } from "../src/lib/models/county-onramp";
import {
  createDefaultTargetedReportSections,
} from "../src/lib/reports/catalog";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");

const DEFAULT_ENV_CANDIDATES = [path.join(APP_ROOT, ".env.local")];

const ARTIFACT_ROOT = path.join(
  REPO_ROOT,
  "data",
  "screening-runs",
  "nevada-county-runtime-norenumber-freeze-20260324"
);

// Deterministic UUIDs so the seed is idempotent across runs.
export const DEMO_WORKSPACE_ID = "d0000001-0000-4000-8000-000000000001";
export const DEMO_USER_ID = "d0000001-0000-4000-8000-000000000002";
export const DEMO_PROJECT_ID = "d0000001-0000-4000-8000-000000000003";
export const DEMO_RTP_CYCLE_ID = "d0000001-0000-4000-8000-000000000004";
export const DEMO_COUNTY_RUN_ID = "d0000001-0000-4000-8000-000000000005";
export const DEMO_PROJECT_RTP_LINK_ID = "d0000001-0000-4000-8000-000000000006";
export const DEMO_EXISTING_CONDITIONS_CHAPTER_ID = "d0000001-0000-4000-8000-000000000007";
export const DEMO_PLAN_ID = "d0000001-0000-4000-8000-000000000015";
export const DEMO_PROGRAM_ID = "d0000001-0000-4000-8000-000000000016";
export const DEMO_PROGRAM_PLAN_LINK_ID = "d0000001-0000-4000-8000-000000000017";
export const DEMO_FUNDING_OPPORTUNITY_ID = "d0000001-0000-4000-8000-000000000018";
export const DEMO_REPORT_ID = "d0000001-0000-4000-8000-000000000019";
export const DEMO_REPORT_ARTIFACT_ID = "d0000001-0000-4000-8000-00000000001a";
export const DEMO_PROJECT_FUNDING_PROFILE_ID = "d0000001-0000-4000-8000-000000000040";
export const DEMO_AWARDED_FUNDING_OPPORTUNITY_ID = "d0000001-0000-4000-8000-000000000041";
export const DEMO_FUNDING_AWARD_ID = "d0000001-0000-4000-8000-000000000042";
export const DEMO_REIMBURSEMENT_INVOICE_ID = "d0000001-0000-4000-8000-000000000043";
export const DEMO_DATA_CONNECTOR_ID = "d0000001-0000-4000-8000-000000000050";
export const DEMO_DATASET_EQUITY_TRACTS_ID = "d0000001-0000-4000-8000-000000000051";
export const DEMO_DATASET_SR49_CORRIDOR_ID = "d0000001-0000-4000-8000-000000000052";
export const DEMO_DATASET_CRASH_POINTS_ID = "d0000001-0000-4000-8000-000000000053";
export const DEMO_DATA_REFRESH_JOB_ID = "d0000001-0000-4000-8000-000000000054";
export const DEMO_SCENARIO_SET_ID = "d0000001-0000-4000-8000-000000000030";
export const DEMO_SCENARIO_BASELINE_RUN_ID = "d0000001-0000-4000-8000-000000000031";
export const DEMO_SCENARIO_ALTERNATIVE_RUN_ID = "d0000001-0000-4000-8000-000000000032";
export const DEMO_SCENARIO_BASELINE_ENTRY_ID = "d0000001-0000-4000-8000-000000000033";
export const DEMO_SCENARIO_ALTERNATIVE_ENTRY_ID = "d0000001-0000-4000-8000-000000000034";
export const DEMO_SCENARIO_COMPARISON_SNAPSHOT_ID = "d0000001-0000-4000-8000-000000000035";
export const DEMO_SCENARIO_ACCESSIBILITY_DELTA_ID = "d0000001-0000-4000-8000-000000000036";
export const DEMO_SCENARIO_SAFETY_DELTA_ID = "d0000001-0000-4000-8000-000000000037";

export const DEMO_MISSION_DOWNTOWN_ID = "d0000001-0000-4000-8000-000000000008";
export const DEMO_MISSION_SR49_ID = "d0000001-0000-4000-8000-000000000009";
export const DEMO_MISSION_EMPIRE_ID = "d0000001-0000-4000-8000-00000000000a";

export const DEMO_PACKAGE_DOWNTOWN_ID = "d0000001-0000-4000-8000-00000000000b";
export const DEMO_PACKAGE_SR49_ID = "d0000001-0000-4000-8000-00000000000c";
export const DEMO_PACKAGE_EMPIRE_ID = "d0000001-0000-4000-8000-00000000000d";

export const DEMO_CORRIDOR_SR49_ID = "d0000001-0000-4000-8000-00000000000e";
export const DEMO_CORRIDOR_EMPIRE_ID = "d0000001-0000-4000-8000-00000000000f";
export const DEMO_ENGAGEMENT_CAMPAIGN_ID = "d0000001-0000-4000-8000-000000000010";
export const DEMO_ENGAGEMENT_ITEM_NEAL_MILL_ID = "d0000001-0000-4000-8000-000000000011";
export const DEMO_ENGAGEMENT_ITEM_LIBRARY_BIKE_ID = "d0000001-0000-4000-8000-000000000012";
export const DEMO_ENGAGEMENT_ITEM_SR20_SPEEDING_ID = "d0000001-0000-4000-8000-000000000013";
export const DEMO_ENGAGEMENT_ITEM_RURAL_BUS_ID = "d0000001-0000-4000-8000-000000000014";

// Census tract GEOIDs — synthetic but realistic (state FIPS 06 + county FIPS 057
// for Nevada County + 6-digit tract suffix). These are hand-authored demo
// polygons; a future slice swaps to real TIGER + ACS ingestion. Each tract
// is a single-ring MultiPolygon so the choropleth can exercise the
// MultiPolygon bbox helper that shipped in Slice K1.
export const DEMO_TRACT_GRASS_VALLEY_CORE_GEOID = "06057010100";
export const DEMO_TRACT_GRASS_VALLEY_SOUTH_GEOID = "06057010200";
export const DEMO_TRACT_NEVADA_CITY_GEOID = "06057010300";
export const DEMO_TRACT_RURAL_EAST_GEOID = "06057010400";

export const DEMO_EXISTING_CONDITIONS_CHAPTER_KEY = "existing_conditions_travel_patterns";
export const DEMO_EXISTING_CONDITIONS_CHAPTER_TITLE =
  "Existing conditions and travel patterns (demo)";

export const DEMO_USER_EMAIL = "nctc-demo@openplan-demo.natford.example";
export const DEMO_WORKSPACE_NAME = "Nevada County Transportation Commission (demo)";
export const DEMO_WORKSPACE_SLUG = "nctc-demo";
export const DEMO_PROJECT_NAME = "NCTC 2045 RTP (proof-of-capability)";
export const DEMO_PROJECT_SUMMARY =
  "Proof-of-capability demo: what OpenPlan produces when a rural RTPA like Nevada County runs an RTP cycle through it, grounded in real NCTC geography and a real screening-grade AequilibraE assignment. Internal prototype only — not a calibrated planning-grade model.";

// Grass Valley anchor — matches DEFAULT_CENTER in the cartographic backdrop
// and the map fallback components, so the demo project marker lands under
// the shell's initial viewport.
export const DEMO_PROJECT_LATITUDE = 39.239137;
export const DEMO_PROJECT_LONGITUDE = -121.033982;
// Nevada City is the Nevada County seat — offset slightly from the Grass
// Valley project anchor so the RTP pin and project marker don't overlap
// when both sit inside the same initial viewport.
export const DEMO_RTP_ANCHOR_LATITUDE = 39.2616;
export const DEMO_RTP_ANCHOR_LONGITUDE = -121.0161;
export const DEMO_RTP_CYCLE_TITLE = "NCTC 2045 RTP — demo cycle";
export const DEMO_PLAN_TITLE = "NCTC 2045 RTP local proof plan";
export const DEMO_PROGRAM_TITLE = "NCTC 2045 RTP programming pipeline";
export const DEMO_FUNDING_OPPORTUNITY_TITLE = "Rural RTP implementation readiness call";
export const DEMO_AWARDED_FUNDING_OPPORTUNITY_TITLE = "NCTC RTP LPP construction award";
export const DEMO_FUNDING_AWARD_TITLE = "NCTC SR-49 safety package construction award";
export const DEMO_REIMBURSEMENT_INVOICE_NUMBER = "NCTC-LPP-2026-001";
export const DEMO_REPORT_TITLE = "NCTC 2045 RTP settle board packet";
export const DEMO_REPORT_GENERATED_AT = "2026-04-30T12:00:00.000Z";
export const DEMO_DATA_HUB_CAPTURED_AT = "2026-04-30T12:40:00.000Z";
export const DEMO_COUNTY_RUN_NAME = "nevada-county-runtime-norenumber-freeze-20260324";
export const DEMO_ENGAGEMENT_CAMPAIGN_TITLE = "NCTC 2045 RTP community input map";
export const DEMO_SCENARIO_SET_TITLE = "NCTC 2045 RTP scenario comparison";
export const DEMO_SCENARIO_BASELINE_LABEL = "Existing conditions baseline";
export const DEMO_SCENARIO_ALTERNATIVE_LABEL = "SR-49 safety package";
export const DEMO_SCENARIO_COMPARISON_LABEL = "SR-49 safety package comparison snapshot";

export type SeedRecords = {
  workspace: Record<string, unknown>;
  membership: Record<string, unknown>;
  project: Record<string, unknown>;
  plan: Record<string, unknown>;
  program: Record<string, unknown>;
  programPlanLink: Record<string, unknown>;
  projectFundingProfile: Record<string, unknown>;
  fundingOpportunity: Record<string, unknown>;
  awardedFundingOpportunity: Record<string, unknown>;
  fundingAward: Record<string, unknown>;
  billingInvoiceRecords: Array<Record<string, unknown>>;
  dataConnector: Record<string, unknown>;
  dataDatasets: Array<Record<string, unknown>>;
  dataRefreshJobs: Array<Record<string, unknown>>;
  dataDatasetProjectLinks: Array<Record<string, unknown>>;
  rtpCycle: Record<string, unknown>;
  projectRtpLink: Record<string, unknown>;
  countyRun: Record<string, unknown>;
  existingConditionsChapter: Record<string, unknown>;
  report: Record<string, unknown>;
  reportArtifact: Record<string, unknown>;
  reportSections: Array<Record<string, unknown>>;
  scenarioRuns: Array<Record<string, unknown>>;
  scenarioSet: Record<string, unknown>;
  scenarioEntries: Array<Record<string, unknown>>;
  scenarioComparisonSnapshot: Record<string, unknown>;
  scenarioComparisonIndicatorDeltas: Array<Record<string, unknown>>;
};

// Realistic AOI polygons near Grass Valley, CA (Nevada County seat,
// anchor 39.239137, -121.033982). Each polygon has 9+ vertices so the
// mission map does not look sparse and so DJI waypoint export produces
// a usable perimeter. Coordinates are [lng, lat] and rings are closed.

export const DEMO_AOI_DOWNTOWN = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-121.039982, 39.243137],
      [-121.035982, 39.243537],
      [-121.031982, 39.243337],
      [-121.027982, 39.242937],
      [-121.026582, 39.239137],
      [-121.027982, 39.235337],
      [-121.033982, 39.234737],
      [-121.039982, 39.235337],
      [-121.041282, 39.239137],
      [-121.039982, 39.243137],
    ],
  ],
};

export const DEMO_AOI_SR49_ALTA_SIERRA = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-121.072, 39.201],
      [-121.060, 39.195],
      [-121.050, 39.189],
      [-121.040, 39.180],
      [-121.034, 39.170],
      [-121.038, 39.164],
      [-121.048, 39.168],
      [-121.058, 39.176],
      [-121.068, 39.184],
      [-121.076, 39.192],
      [-121.072, 39.201],
    ],
  ],
};

// Display-only corridor LineStrings anchored to real Grass Valley roads,
// used to prove the third cartographic geometry kind on the shell backdrop.
// Coordinates are [lng, lat]. Not transportation-modeling network corridors
// — those live in the network_packages chain, unrelated to these rows.

export const DEMO_CORRIDOR_SR49 = {
  type: "LineString" as const,
  coordinates: [
    [-121.039, 39.224],
    [-121.040, 39.215],
    [-121.040, 39.205],
    [-121.038, 39.195],
    [-121.035, 39.185],
    [-121.033, 39.175],
    [-121.034, 39.170],
  ] as [number, number][],
};

export const DEMO_CORRIDOR_EMPIRE_ST = {
  type: "LineString" as const,
  coordinates: [
    [-121.034, 39.219],
    [-121.028, 39.217],
    [-121.022, 39.215],
    [-121.016, 39.213],
    [-121.012, 39.209],
  ] as [number, number][],
};

export const DEMO_ENGAGEMENT_ITEMS = [
  {
    id: DEMO_ENGAGEMENT_ITEM_NEAL_MILL_ID,
    campaign_id: DEMO_ENGAGEMENT_CAMPAIGN_ID,
    title: "Unsafe crossing at Neal + Mill",
    body:
      "The Neal and Mill crossing feels unsafe during school pickup. Families need a marked crosswalk, better lighting, and slower turns into downtown.",
    submitted_by: "Public map comment",
    status: "approved",
    source_type: "public",
    latitude: 39.2178,
    longitude: -121.0614,
  },
  {
    id: DEMO_ENGAGEMENT_ITEM_LIBRARY_BIKE_ID,
    campaign_id: DEMO_ENGAGEMENT_CAMPAIGN_ID,
    title: "Needs better bike parking at library",
    body:
      "The Grass Valley library is a daily destination, but the bike rack is small and hard to see from the entrance. Covered parking would help students and seniors.",
    submitted_by: "Workshop participant",
    status: "approved",
    source_type: "meeting",
    latitude: 39.2196,
    longitude: -121.0641,
  },
  {
    id: DEMO_ENGAGEMENT_ITEM_SR20_SPEEDING_ID,
    campaign_id: DEMO_ENGAGEMENT_CAMPAIGN_ID,
    title: "Speeding on SR-20 near Alta Sierra",
    body:
      "Traffic on SR-20 near Alta Sierra is moving too fast for people turning in and out of neighborhoods. Speed feedback signs or enforcement would help.",
    submitted_by: "Email intake",
    status: "approved",
    source_type: "email",
    latitude: 39.1965,
    longitude: -121.0356,
  },
  {
    id: DEMO_ENGAGEMENT_ITEM_RURAL_BUS_ID,
    campaign_id: DEMO_ENGAGEMENT_CAMPAIGN_ID,
    title: "Later bus service for evening shifts",
    body:
      "Evening workers in Grass Valley and Nevada City need one later bus trip so service works for restaurant and health-care shifts.",
    submitted_by: "Public map comment",
    status: "approved",
    source_type: "public",
    latitude: 39.2579,
    longitude: -121.0174,
  },
] as const;

// Hand-authored Nevada County census tracts. Single-ring MultiPolygons tiled
// around Grass Valley and Nevada City. Boundaries are illustrative and do
// NOT match real TIGER tract boundaries — a future slice replaces these
// with live Census ingestion. Coordinates are [lng, lat]. Each tract sits
// adjacent to but not overlapping its neighbors so the choropleth renders
// as a contiguous surface.
//
// The pct_zero_vehicle values (derived from households_zero_vehicle /
// households in the census_tracts_computed view) are selected to exercise
// all four bins of the equity choropleth: <5%, 5–10%, 10–15%, >15%.
// - Grass Valley core: ~12% (urban density, more zero-vehicle households)
// - Grass Valley south: ~7% (suburban)
// - Nevada City:       ~8% (small-town walkable)
// - Rural east:        ~3% (car-dependent rural)

export const DEMO_TRACT_GRASS_VALLEY_CORE = {
  type: "MultiPolygon" as const,
  coordinates: [
    [
      [
        [-121.045, 39.250],
        [-121.020, 39.250],
        [-121.020, 39.230],
        [-121.045, 39.230],
        [-121.045, 39.250],
      ],
    ],
  ],
};

export const DEMO_TRACT_GRASS_VALLEY_SOUTH = {
  type: "MultiPolygon" as const,
  coordinates: [
    [
      [
        [-121.045, 39.230],
        [-121.020, 39.230],
        [-121.020, 39.210],
        [-121.045, 39.210],
        [-121.045, 39.230],
      ],
    ],
  ],
};

export const DEMO_TRACT_NEVADA_CITY = {
  type: "MultiPolygon" as const,
  coordinates: [
    [
      [
        [-121.020, 39.270],
        [-120.985, 39.270],
        [-120.985, 39.245],
        [-121.020, 39.245],
        [-121.020, 39.270],
      ],
    ],
  ],
};

export const DEMO_TRACT_RURAL_EAST = {
  type: "MultiPolygon" as const,
  coordinates: [
    [
      [
        [-121.020, 39.245],
        [-120.985, 39.245],
        [-120.985, 39.215],
        [-121.020, 39.215],
        [-121.020, 39.245],
      ],
    ],
  ],
};

export const DEMO_AOI_EMPIRE_MINE = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-121.028, 39.213],
      [-121.022, 39.215],
      [-121.016, 39.213],
      [-121.012, 39.209],
      [-121.011, 39.205],
      [-121.014, 39.201],
      [-121.020, 39.199],
      [-121.026, 39.201],
      [-121.030, 39.205],
      [-121.031, 39.209],
      [-121.028, 39.213],
    ],
  ],
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fmtInt(value: unknown): string {
  const n = num(value);
  return n === null ? "—" : Math.round(n).toLocaleString("en-US");
}

function fmtPct(value: unknown, digits = 1): string {
  const n = num(value);
  return n === null ? "—" : `${n.toFixed(digits)}%`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function demoReportSectionId(index: number): string {
  return `d0000001-0000-4000-8000-${(0x20 + index).toString(16).padStart(12, "0")}`;
}

function buildNctcReportArtifactMetadata() {
  const reportSections = buildNctcReportSections();
  const enabledSectionKeys = reportSections
    .filter((section) => section.enabled)
    .map((section) => section.section_key);
  const fundingSnapshot = {
    capturedAt: DEMO_REPORT_GENERATED_AT,
    latestSourceUpdatedAt: DEMO_REPORT_GENERATED_AT,
    linkedProjectCount: 1,
    trackedProjectCount: 1,
    fundedProjectCount: 0,
    likelyCoveredProjectCount: 1,
    gapProjectCount: 1,
    committedFundingAmount: 0,
    likelyFundingAmount: 1250000,
    totalPotentialFundingAmount: 1250000,
    unfundedAfterLikelyAmount: 0,
    paidReimbursementAmount: 0,
    outstandingReimbursementAmount: 0,
    uninvoicedAwardAmount: 0,
    awardRiskCount: 0,
    label: "Likely funding identified",
    reason:
      "The deterministic NCTC local proof packet sees one linked RTP project and one pursued RTP implementation funding opportunity.",
    reimbursementLabel: "No reimbursement draw yet",
    reimbursementReason:
      "The local UI settle fixture stops at packet evidence; it does not create invoices or billing-side reimbursement rows.",
  };

  return {
    metadata_schema_version: "2026-04",
    htmlContent: [
      '<article class="report-html report-html--nctc-settle">',
      "<h1>NCTC 2045 RTP settle board packet</h1>",
      "<p>This local-only proof packet is anchored to the NCTC demo RTP cycle, the linked proof project, the programming pipeline, and the frozen Nevada County screening run.</p>",
      "<h2>Packet basis</h2>",
      "<ul>",
      "<li>RTP cycle: NCTC 2045 RTP - demo cycle.</li>",
      "<li>Linked project: NCTC 2045 RTP (proof-of-capability).</li>",
      "<li>Modeling basis: nevada-county-runtime-norenumber-freeze-20260324.</li>",
      "<li>Public input basis: four approved NCTC community map comments.</li>",
      "</ul>",
      "<h2>Operator note</h2>",
      "<p>This artifact exists only to prove the reports index/detail surfaces with populated local state. It is not a production packet and does not make planning-grade modeling claims.</p>",
      "</article>",
    ].join(""),
    generatedAt: DEMO_REPORT_GENERATED_AT,
    auditability: {
      posture: "local_ui_ux_settle_fixture",
      note:
        "Local-only deterministic report fixture for read-only UI settle capture. It does not bypass production report generation or external storage.",
    },
    sourceContext: {
      reportOrigin: "rtp_cycle_packet",
      reportReason: "local_ui_ux_settle_fixture",
      rtpCycleId: DEMO_RTP_CYCLE_ID,
      rtpCycleTitle: DEMO_RTP_CYCLE_TITLE,
      rtpCycleUpdatedAt: DEMO_REPORT_GENERATED_AT,
      chapterCount: 8,
      chapterCompleteCount: 0,
      chapterReadyForReviewCount: 1,
      linkedProjectCount: 1,
      engagementCampaignCount: 1,
      cycleLevelCampaignCount: 1,
      chapterLevelCampaignCount: 0,
      engagementPendingCommentCount: 0,
      engagementApprovedCommentCount: DEMO_ENGAGEMENT_ITEMS.length,
      engagementReadyCommentCount: DEMO_ENGAGEMENT_ITEMS.length,
      publicReviewSummary: {
        label: "Review loop active",
        detail:
          "The local NCTC fixture includes one active cycle-level engagement campaign and approved map comments ready for packet review.",
        tone: "info",
        actionItems: ["Review approved community map comments before board-packet signoff."],
      },
      rtpFundingSnapshot: fundingSnapshot,
      readiness: {
        label: "Local proof ready",
        reason:
          "The demo RTP cycle has geography, horizon, a linked project, a populated existing-conditions chapter, and a local report artifact.",
      },
      workflow: {
        label: "Packet review ready",
        detail:
          "Use this fixture to inspect reports index/detail UX only; production packet generation remains governed by the API path.",
      },
      modelingEvidence: [
        {
          countyRunId: DEMO_COUNTY_RUN_ID,
          runName: DEMO_COUNTY_RUN_NAME,
          claimStatus: "screening_grade",
          statusReason:
            "Frozen Nevada County run is screening-grade only and is included as transparent context, not calibrated model proof.",
        },
      ],
      modelingEvidenceCount: 1,
      modelingEvidenceClaimStatuses: ["screening_grade"],
      enabledSectionCount: enabledSectionKeys.length,
      enabledSectionKeys,
      packetPresetAlignment: {
        presetStage: "draft",
        presetLabel: "Draft packet preset",
        statusLabel: "Preset aligned",
        detail:
          "The local fixture uses the draft RTP board-packet section set expected for the seeded cycle status.",
      },
    },
    generationMode: "local_ui_ux_settle_fixture",
  };
}

function buildNctcReportSections() {
  return createDefaultTargetedReportSections("board_packet", "rtp_cycle", {
    rtpCycleStatus: "draft",
  }).map((section, index) => ({
    id: demoReportSectionId(index),
    report_id: DEMO_REPORT_ID,
    section_key: section.sectionKey,
    title: section.title,
    enabled: section.enabled,
    sort_order: section.sortOrder,
    config_json: section.configJson ?? {},
  }));
}

type FacilityRow = {
  station?: string;
  observed_volume?: number;
  modeled_daily_pce?: number;
  obs_rank?: number;
  mod_rank?: number;
};

export function buildExistingConditionsChapterMarkdown(
  bundleManifest: Record<string, unknown>,
  validationSummary: Record<string, unknown>
): string {
  const boundary = (bundleManifest.boundary ?? {}) as Record<string, unknown>;
  const zones = (bundleManifest.zones ?? {}) as Record<string, unknown>;
  const demand = (bundleManifest.demand ?? {}) as Record<string, unknown>;
  const assignment = (bundleManifest.assignment ?? {}) as Record<string, unknown>;
  const assignmentNetwork = (assignment.network ?? {}) as Record<string, unknown>;
  const convergence = (assignment.convergence ?? {}) as Record<string, unknown>;
  const network = (bundleManifest.network ?? {}) as Record<string, unknown>;
  const metrics = (validationSummary.metrics ?? {}) as Record<string, unknown>;
  const gate = (validationSummary.screening_gate ?? {}) as Record<string, unknown>;
  const facilityRanking = Array.isArray(validationSummary.facility_ranking)
    ? (validationSummary.facility_ranking as FacilityRow[])
    : [];
  const caveats = Array.isArray(validationSummary.model_caveats)
    ? (validationSummary.model_caveats as string[])
    : [];

  const areaSqMi = num(boundary.area_sq_mi);
  const bbox = Array.isArray(boundary.bbox) ? (boundary.bbox as number[]) : null;

  const facilityTable = facilityRanking.length
    ? [
        "| Station | Observed | Modeled (PCE) | Obs rank | Mod rank |",
        "|---|---:|---:|---:|---:|",
        ...facilityRanking.map(
          (row) =>
            `| ${row.station ?? "—"} | ${fmtInt(row.observed_volume)} | ${fmtInt(
              row.modeled_daily_pce
            )} | ${row.obs_rank ?? "—"} | ${row.mod_rank ?? "—"} |`
        ),
      ].join("\n")
    : "*Facility ranking not available in this validation summary.*";

  const caveatList = caveats.length
    ? caveats.map((c) => `- ${c}`).join("\n")
    : "- (no caveats recorded in the validation summary)";

  const gateReasons = Array.isArray(gate.reasons)
    ? (gate.reasons as string[]).map((r) => `- ${r}`).join("\n")
    : "";

  return [
    `> **Screening-grade prototype — not a calibrated planning model.**`,
    `> The baseline numbers in this chapter come from an AequilibraE screening`,
    `> run built from OSM default speeds/capacities, tract-fragment TAZs, and`,
    `> tract-scale demographic proxies. A production RTP chapter would require`,
    `> calibrated TAZs, surveyed trip rates, station counts beyond the five`,
    `> Caltrans priority stations used here, and an equity-impact analysis the`,
    `> screening model does not support.`,
    ``,
    `## Study area`,
    ``,
    `${boundary.label ?? "Nevada County"}, California (FIPS ${
      boundary.source_path ?? "06057"
    }), covering ${areaSqMi !== null ? `${areaSqMi.toLocaleString("en-US")} square miles` : "—"}${
      bbox
        ? ` bounded by (${bbox[0].toFixed(4)}, ${bbox[1].toFixed(4)}) to (${bbox[2].toFixed(
            4
          )}, ${bbox[3].toFixed(4)})`
        : ""
    }.`,
    ``,
    `## Baseline demographics`,
    ``,
    `| Metric | Value | Source |`,
    `|---|---:|---|`,
    `| Total population | ${fmtInt(zones.total_population)} | ACS 5-year tract attributes |`,
    `| Households | ${fmtInt(zones.total_households)} | ACS 5-year tract attributes |`,
    `| Worker residents | ${fmtInt(zones.total_worker_residents)} | LODES + ACS |`,
    `| Estimated jobs | ${fmtInt(zones.total_jobs_est)} | Tract-scale demographic proxy |`,
    `| Zones (TAZ surrogate) | ${fmtInt(zones.zones)} | ${zones.zone_type ?? "census-tract-fragments"} |`,
    ``,
    `## Travel demand (screening-grade)`,
    ``,
    `Estimated total daily person-trips: **${fmtInt(demand.total_trips)}**.`,
    ``,
    `- Home-based work (HBW): ${fmtInt(demand.hbw_trips)}`,
    `- Home-based other (HBO): ${fmtInt(demand.hbo_trips)}`,
    `- Non-home-based (NHB): ${fmtInt(demand.nhb_trips)}`,
    `- External (through-county): ${fmtInt(demand.external_trips)}`,
    ``,
    `External gateways are inferred from major motorway boundary crossings.`,
    ``,
    `## Network and assignment`,
    ``,
    `OSM-default network: ${fmtInt(assignmentNetwork.links)} links, ${fmtInt(
      assignmentNetwork.nodes
    )} nodes, ${fmtInt(assignmentNetwork.zones)} tract-fragment zones. ${
      fmtPct(network.largest_component_pct, 2)
    } of the road network is in the largest connected component.`,
    ``,
    `Assignment converged at a final relative gap of ${
      num(convergence.final_gap) !== null ? (num(convergence.final_gap) as number).toFixed(5) : "—"
    } (target ${
      num(convergence.target_gap) !== null ? (num(convergence.target_gap) as number).toFixed(5) : "—"
    }) after ${fmtInt(convergence.iterations)} iterations, with ${fmtInt(
      assignment.loaded_links
    )} loaded links.`,
    ``,
    `## Validation against Caltrans priority counts`,
    ``,
    `Five Caltrans 2023 priority count stations were matched 1-for-1 against`,
    `screening model outputs.`,
    ``,
    `| Metric | Value |`,
    `|---|---:|`,
    `| Stations matched | ${validationSummary.stations_matched ?? "—"} / ${validationSummary.stations_total ?? "—"} |`,
    `| Median absolute percent error | ${fmtPct(metrics.median_absolute_percent_error)} |`,
    `| Mean absolute percent error | ${fmtPct(metrics.mean_absolute_percent_error, 2)} |`,
    `| Max absolute percent error | ${fmtPct(metrics.max_absolute_percent_error, 2)} |`,
    `| Min absolute percent error | ${fmtPct(metrics.min_absolute_percent_error)} |`,
    `| Spearman rank correlation | ${
      num(metrics.spearman_rho_facility_ranking) !== null
        ? (num(metrics.spearman_rho_facility_ranking) as number).toFixed(2)
        : "—"
    } |`,
    ``,
    `### Ranking comparison`,
    ``,
    facilityTable,
    ``,
    `### Screening gate`,
    ``,
    `**Status: ${gate.status_label ?? "internal prototype only"}.**`,
    gateReasons,
    ``,
    `### Model caveats (verbatim)`,
    ``,
    caveatList,
    ``,
    `## What this chapter is not`,
    ``,
    `- Not a calibrated travel demand model. A production Nevada County RTP`,
    `  would require local survey data (NHTS expansion, household travel`,
    `  diary), calibrated TAZs instead of tract fragments, and capacity`,
    `  calibration against observed LOS.`,
    `- Not an equity impact analysis. The platform's equity lens (pct`,
    `  minority, pct zero-vehicle, pct poverty from ACS) exists but has`,
    `  not been scored against a project portfolio in this demo.`,
    `- Not a transit or active-transportation accessibility analysis.`,
    ``,
    `## What this chapter demonstrates`,
    ``,
    `OpenPlan produced every table and figure above from a single frozen`,
    `screening-grade AequilibraE run and one validation pass against`,
    `Caltrans priority counts. Every number traces back to`,
    `\`${validationSummary.model_run_id ?? "the frozen run artifact"}\`,`,
    `so agency staff (or auditors) can verify any cell against the`,
    `underlying source file. A production RTP chapter would replace the`,
    `screening caveats with calibrated inputs and surveyed trip rates; the`,
    `platform's chapter structure, evidence linkage, and adoption-packet`,
    `flow remain the same.`,
    ``,
  ].join("\n");
}

export function buildNctcCountyOnrampManifest(
  bundleManifest: Record<string, unknown>,
  validationSummary: Record<string, unknown>
): CountyOnrampManifest {
  const artifacts = record(bundleManifest.artifacts);
  const zones = record(bundleManifest.zones);
  const demand = record(bundleManifest.demand);
  const assignment = record(bundleManifest.assignment);
  const assignmentNetwork = record(assignment.network);
  const convergence = record(assignment.convergence);
  const runtime = record(bundleManifest.runtime);
  const validationCreatedAt = text(validationSummary.created_at);
  const runName = text(bundleManifest.run_name) ?? DEMO_COUNTY_RUN_NAME;

  return {
    schema_version: "openplan.county_onramp_manifest.v1",
    generated_at: validationCreatedAt ?? "2026-03-24T19:42:28.445852+00:00",
    name: runName,
    county_fips: "06057",
    county_prefix: "NEVADA",
    run_dir: ARTIFACT_ROOT,
    mode: "existing-run",
    stage: "validated-screening",
    artifacts: {
      scaffold_csv: text(artifacts.validation_candidate_audit_csv) ?? "validation/validation_candidate_audit.csv",
      review_packet_md: text(artifacts.validation_report) ?? "validation/validation_report.md",
      run_summary_json: text(artifacts.run_summary_json) ?? "run_summary.json",
      bundle_manifest_json: text(artifacts.bundle_manifest_json) ?? "bundle_manifest.json",
      validation_summary_json: text(artifacts.validation_summary) ?? "validation/validation_summary.json",
    },
    runtime: {
      keep_project: true,
      force: false,
      overall_demand_scalar: num(runtime.overall_demand_scalar),
      external_demand_scalar: num(runtime.external_demand_scalar),
      hbw_scalar: num(runtime.hbw_scalar),
      hbo_scalar: num(runtime.hbo_scalar),
      nhb_scalar: num(runtime.nhb_scalar),
    },
    summary: {
      run: {
        zone_count: num(zones.zones),
        population_total: num(zones.total_population),
        jobs_total: num(zones.total_jobs_est),
        loaded_links: num(assignmentNetwork.links) ?? num(assignment.loaded_links),
        final_gap: num(convergence.final_gap),
        total_trips: num(demand.total_trips),
      },
      validation: validationSummary,
      bundle_validation: {
        status_label: text(validationSummary.status_label) ?? "internal prototype only",
        legacy_bundle_manifest: true,
      },
    },
  };
}

export function buildNctcModelingEvidenceBundle(
  bundleManifest: Record<string, unknown>,
  validationSummary: Record<string, unknown>
) {
  return buildCountyRunModelingEvidenceBundle({
    workspaceId: DEMO_WORKSPACE_ID,
    countyRunId: DEMO_COUNTY_RUN_ID,
    geographyLabel: "Nevada County, CA",
    manifest: buildNctcCountyOnrampManifest(bundleManifest, validationSummary),
  });
}

export function buildSeedRecords(
  ownerUserId: string,
  bundleManifest: Record<string, unknown>,
  validationSummary: Record<string, unknown>
): SeedRecords {
  return {
    workspace: {
      id: DEMO_WORKSPACE_ID,
      name: DEMO_WORKSPACE_NAME,
      slug: DEMO_WORKSPACE_SLUG,
      plan: "pilot",
      subscription_plan: "pilot",
      subscription_status: "pilot",
      is_demo: true,
    },
    membership: {
      workspace_id: DEMO_WORKSPACE_ID,
      user_id: ownerUserId,
      role: "owner",
    },
    project: {
      id: DEMO_PROJECT_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      name: DEMO_PROJECT_NAME,
      summary: DEMO_PROJECT_SUMMARY,
      status: "active",
      plan_type: "regional_transportation_plan",
      delivery_phase: "analysis",
      latitude: DEMO_PROJECT_LATITUDE,
      longitude: DEMO_PROJECT_LONGITUDE,
      created_by: ownerUserId,
    },
    plan: {
      id: DEMO_PLAN_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      title: DEMO_PLAN_TITLE,
      plan_type: "regional",
      status: "active",
      geography_label: "Nevada County, CA",
      horizon_year: 2045,
      summary:
        "Local-only proof-pack fixture for the plans index/detail UI settle capture, grounded in the NCTC demo project and inherited engagement context.",
      created_by: ownerUserId,
    },
    program: {
      id: DEMO_PROGRAM_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      title: DEMO_PROGRAM_TITLE,
      program_type: "rtip",
      status: "assembling",
      cycle_name: "FY 2027/28–2030/31 RTIP",
      funding_classification: "mixed",
      sponsor_agency: "Nevada County Transportation Commission",
      owner_label: "NCTC programming desk",
      cadence_label: "biennial RTIP cycle",
      fiscal_year_start: 2027,
      fiscal_year_end: 2031,
      nomination_due_at: "2026-09-15T17:00:00Z",
      adoption_target_at: "2026-12-11T17:00:00Z",
      summary:
        "Local-only proof-pack fixture for the programs index/detail UI settle capture, linking the NCTC RTP proof plan to an RTIP-style funding readiness lane.",
      created_by: ownerUserId,
    },
    programPlanLink: {
      id: DEMO_PROGRAM_PLAN_LINK_ID,
      program_id: DEMO_PROGRAM_ID,
      link_type: "plan",
      linked_id: DEMO_PLAN_ID,
      label: DEMO_PLAN_TITLE,
      created_by: ownerUserId,
    },
    projectFundingProfile: {
      id: DEMO_PROJECT_FUNDING_PROFILE_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      funding_need_amount: 2400000,
      local_match_need_amount: 300000,
      notes:
        "Local-only grants proof fixture: anchors the NCTC RTP implementation funding need so /grants can render gap, award, and reimbursement posture with real project math.",
      created_by: ownerUserId,
    },
    fundingOpportunity: {
      id: DEMO_FUNDING_OPPORTUNITY_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      program_id: DEMO_PROGRAM_ID,
      project_id: DEMO_PROJECT_ID,
      title: DEMO_FUNDING_OPPORTUNITY_TITLE,
      opportunity_status: "open",
      decision_state: "pursue",
      agency_name: "California Transportation Commission",
      owner_label: "NCTC programming desk",
      cadence_label: "biennial call",
      expected_award_amount: 1250000,
      opens_at: "2026-07-01T16:00:00Z",
      closes_at: "2026-09-15T17:00:00Z",
      decision_due_at: "2026-12-11T17:00:00Z",
      summary:
        "Demo funding lane for capturing a populated programs detail surface with project, plan, and readiness context. Internal prototype only.",
      created_by: ownerUserId,
    },
    awardedFundingOpportunity: {
      id: DEMO_AWARDED_FUNDING_OPPORTUNITY_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      program_id: DEMO_PROGRAM_ID,
      project_id: DEMO_PROJECT_ID,
      title: DEMO_AWARDED_FUNDING_OPPORTUNITY_TITLE,
      opportunity_status: "awarded",
      decision_state: "awarded",
      agency_name: "California Transportation Commission",
      owner_label: "NCTC programming desk",
      cadence_label: "local partnership program cycle",
      expected_award_amount: 900000,
      opens_at: "2026-02-02T17:00:00Z",
      closes_at: "2026-03-27T17:00:00Z",
      decision_due_at: "2026-04-17T17:00:00Z",
      fit_notes:
        "Awarded local-only fixture supporting the SR-49 safety package funding stack in the UI settle grants proof.",
      readiness_notes:
        "Use as deterministic awarded opportunity evidence only; not a real agency award.",
      decision_rationale:
        "Seeded so the grants workbench can show an awarded opportunity connected to a committed award and reimbursement record.",
      decided_at: "2026-04-17T18:00:00Z",
      summary:
        "Local-only awarded opportunity fixture for /grants desktop/mobile populated capture. Internal prototype only.",
      created_by: ownerUserId,
    },
    fundingAward: {
      id: DEMO_FUNDING_AWARD_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      program_id: DEMO_PROGRAM_ID,
      funding_opportunity_id: DEMO_AWARDED_FUNDING_OPPORTUNITY_ID,
      title: DEMO_FUNDING_AWARD_TITLE,
      awarded_amount: 900000,
      match_amount: 180000,
      match_posture: "secured",
      obligation_due_at: "2026-06-30T17:00:00Z",
      spending_status: "active",
      risk_flag: "watch",
      notes:
        "Local-only grants proof fixture: committed award record tied to the NCTC RTP implementation funding stack.",
      created_by: ownerUserId,
    },
    billingInvoiceRecords: [
      {
        id: DEMO_REIMBURSEMENT_INVOICE_ID,
        workspace_id: DEMO_WORKSPACE_ID,
        project_id: DEMO_PROJECT_ID,
        funding_award_id: DEMO_FUNDING_AWARD_ID,
        invoice_number: DEMO_REIMBURSEMENT_INVOICE_NUMBER,
        consultant_name: "NCTC local proof consultant",
        billing_basis: "progress_payment",
        status: "submitted",
        period_start: "2026-03-01",
        period_end: "2026-03-31",
        invoice_date: "2026-04-10",
        due_date: "2026-04-20",
        amount: 225000,
        retention_percent: 5,
        retention_amount: 11250,
        net_amount: 213750,
        supporting_docs_status: "complete",
        submitted_to: "Caltrans Local Assistance",
        caltrans_posture: "federal_aid_candidate",
        notes:
          "Local-only reimbursement fixture for /grants UI settle capture; no billing, payment, or external submission is implied.",
        created_by: ownerUserId,
      },
    ],
    dataConnector: {
      id: DEMO_DATA_CONNECTOR_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      key: "nctc-rtp-evidence-catalog",
      display_name: "NCTC RTP evidence catalog",
      source_type: "custom",
      category: "local",
      status: "active",
      cadence: "manual",
      auth_mode: "manual_upload",
      endpoint_url: null,
      owner_label: "NCTC demo operator",
      description:
        "Local-only Data Hub fixture that registers the evidence stack behind the NCTC RTP proof workspace.",
      policy_monitor_enabled: true,
      last_sync_at: DEMO_DATA_HUB_CAPTURED_AT,
      last_success_at: DEMO_DATA_HUB_CAPTURED_AT,
      last_error_at: null,
      last_error_message: null,
      created_by: ownerUserId,
      created_at: DEMO_DATA_HUB_CAPTURED_AT,
      updated_at: DEMO_DATA_HUB_CAPTURED_AT,
    },
    dataDatasets: [
      {
        id: DEMO_DATASET_EQUITY_TRACTS_ID,
        workspace_id: DEMO_WORKSPACE_ID,
        connector_id: DEMO_DATA_CONNECTOR_ID,
        name: "Nevada County ACS equity tract context",
        status: "ready",
        geography_scope: "tract",
        geometry_attachment: "analysis_tracts",
        thematic_metric_key: "zeroVehiclePct",
        thematic_metric_label: "Zero-vehicle households",
        coverage_summary:
          "Four hand-authored Nevada County demo tracts used to prove tract-level equity lineage in Analysis Studio and Data Hub.",
        vintage_label: "ACS 5-year demo extract, 2022 posture",
        source_url: "https://www.census.gov/programs-surveys/acs",
        license_label: "US Census public data",
        citation_text:
          "Synthetic Nevada County demo tracts derived for OpenPlan UI proof; production use requires live TIGER/ACS ingestion and citation.",
        schema_version: "openplan.data_hub.dataset.v1",
        checksum: "sha256:nctc-demo-equity-tracts-20260430",
        row_count: 4,
        refresh_cadence: "annual",
        last_refreshed_at: DEMO_DATA_HUB_CAPTURED_AT,
        notes:
          "Thematic-ready tract dataset for proving evidence lineage, not a replacement for official ACS/TIGER records.",
        created_by: ownerUserId,
        created_at: DEMO_DATA_HUB_CAPTURED_AT,
        updated_at: DEMO_DATA_HUB_CAPTURED_AT,
      },
      {
        id: DEMO_DATASET_SR49_CORRIDOR_ID,
        workspace_id: DEMO_WORKSPACE_ID,
        connector_id: DEMO_DATA_CONNECTOR_ID,
        name: "SR-49 safety package corridor screening",
        status: "ready",
        geography_scope: "corridor",
        geometry_attachment: "analysis_corridor",
        thematic_metric_key: "safetyScore",
        thematic_metric_label: "Safety score",
        coverage_summary:
          "Scenario-ready corridor scoring fixture for the SR-49 package comparison in the NCTC RTP proof workspace.",
        vintage_label: "Screening run freeze 2026-03-24",
        source_url: null,
        license_label: "Internal demo fixture",
        citation_text:
          "OpenPlan NCTC screening-grade corridor fixture, frozen 2026-03-24; not a calibrated planning model.",
        schema_version: "openplan.analysis.corridor_score.v1",
        checksum: "sha256:nctc-demo-sr49-corridor-20260430",
        row_count: 2,
        refresh_cadence: "manual",
        last_refreshed_at: DEMO_DATA_HUB_CAPTURED_AT,
        notes:
          "Carries the baseline and SR-49 safety package corridor scores that feed scenario comparison proof.",
        created_by: ownerUserId,
        created_at: DEMO_DATA_HUB_CAPTURED_AT,
        updated_at: DEMO_DATA_HUB_CAPTURED_AT,
      },
      {
        id: DEMO_DATASET_CRASH_POINTS_ID,
        workspace_id: DEMO_WORKSPACE_ID,
        connector_id: DEMO_DATA_CONNECTOR_ID,
        name: "SR-49 and Grass Valley safety comment/crash points",
        status: "ready",
        geography_scope: "point",
        geometry_attachment: "analysis_crash_points",
        thematic_metric_key: "severityBucket",
        thematic_metric_label: "Severity bucket",
        coverage_summary:
          "Point-level safety and public-input evidence fixture for proving crash/comment overlays in a governed Data Hub registry.",
        vintage_label: "Demo outreach + safety snapshot, 2026-04",
        source_url: null,
        license_label: "Internal demo fixture",
        citation_text:
          "OpenPlan NCTC local proof points combining authored engagement items and safety-screening context for UI proof only.",
        schema_version: "openplan.analysis.safety_points.v1",
        checksum: "sha256:nctc-demo-crash-points-20260430",
        row_count: DEMO_ENGAGEMENT_ITEMS.length,
        refresh_cadence: "manual",
        last_refreshed_at: DEMO_DATA_HUB_CAPTURED_AT,
        notes:
          "Thematic-ready crash-point attachment so Data Hub can prove point-overlay provenance and linked-project evidence.",
        created_by: ownerUserId,
        created_at: DEMO_DATA_HUB_CAPTURED_AT,
        updated_at: DEMO_DATA_HUB_CAPTURED_AT,
      },
    ],
    dataRefreshJobs: [
      {
        id: DEMO_DATA_REFRESH_JOB_ID,
        workspace_id: DEMO_WORKSPACE_ID,
        connector_id: DEMO_DATA_CONNECTOR_ID,
        dataset_id: DEMO_DATASET_EQUITY_TRACTS_ID,
        job_name: "Validate NCTC demo Data Hub evidence catalog",
        job_type: "validation",
        status: "succeeded",
        refresh_mode: "manual",
        started_at: "2026-04-30T12:38:00.000Z",
        completed_at: DEMO_DATA_HUB_CAPTURED_AT,
        records_written: 10,
        triggered_by_label: "seed:nctc",
        error_summary: null,
        created_by: ownerUserId,
        created_at: "2026-04-30T12:38:00.000Z",
      },
    ],
    dataDatasetProjectLinks: [
      {
        dataset_id: DEMO_DATASET_EQUITY_TRACTS_ID,
        project_id: DEMO_PROJECT_ID,
        relationship_type: "baseline",
        linked_by: ownerUserId,
        linked_at: DEMO_DATA_HUB_CAPTURED_AT,
      },
      {
        dataset_id: DEMO_DATASET_SR49_CORRIDOR_ID,
        project_id: DEMO_PROJECT_ID,
        relationship_type: "primary_input",
        linked_by: ownerUserId,
        linked_at: DEMO_DATA_HUB_CAPTURED_AT,
      },
      {
        dataset_id: DEMO_DATASET_CRASH_POINTS_ID,
        project_id: DEMO_PROJECT_ID,
        relationship_type: "evidence",
        linked_by: ownerUserId,
        linked_at: DEMO_DATA_HUB_CAPTURED_AT,
      },
    ],
    rtpCycle: {
      id: DEMO_RTP_CYCLE_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      title: DEMO_RTP_CYCLE_TITLE,
      status: "draft",
      geography_label: "Nevada County, CA (FIPS 06057)",
      horizon_start_year: 2026,
      horizon_end_year: 2045,
      summary:
        "Proof-of-capability RTP cycle anchored to the NCTC screening-grade model run. Internal prototype only.",
      anchor_latitude: DEMO_RTP_ANCHOR_LATITUDE,
      anchor_longitude: DEMO_RTP_ANCHOR_LONGITUDE,
      created_by: ownerUserId,
    },
    projectRtpLink: {
      id: DEMO_PROJECT_RTP_LINK_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      rtp_cycle_id: DEMO_RTP_CYCLE_ID,
      portfolio_role: "candidate",
      created_by: ownerUserId,
    },
    countyRun: {
      id: DEMO_COUNTY_RUN_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      geography_type: "county_fips",
      geography_id: "06057",
      geography_label: "Nevada County, CA",
      run_name: DEMO_COUNTY_RUN_NAME,
      stage: "validated-screening",
      status_label:
        (validationSummary.status_label as string | undefined) ?? "internal prototype only",
      mode: "existing-run",
      manifest_json: bundleManifest,
      validation_summary_json: validationSummary,
      created_by: ownerUserId,
    },
    existingConditionsChapter: {
      id: DEMO_EXISTING_CONDITIONS_CHAPTER_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      rtp_cycle_id: DEMO_RTP_CYCLE_ID,
      chapter_key: DEMO_EXISTING_CONDITIONS_CHAPTER_KEY,
      title: DEMO_EXISTING_CONDITIONS_CHAPTER_TITLE,
      section_type: "performance",
      status: "ready_for_review",
      sort_order: 5,
      required: true,
      guidance:
        "Describe the study area, baseline demographics, travel demand, network, and validation posture. This demo chapter is populated from the frozen NCTC screening run — every number traces back to the bundled manifest and validation summary.",
      summary:
        "Proof-of-capability baseline-conditions chapter for the NCTC demo RTP cycle, composed directly from the screening-grade AequilibraE run + Caltrans count validation.",
      content_markdown: buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary),
      created_by: ownerUserId,
    },
    report: {
      id: DEMO_REPORT_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: null,
      rtp_cycle_id: DEMO_RTP_CYCLE_ID,
      modeling_county_run_id: DEMO_COUNTY_RUN_ID,
      title: DEMO_REPORT_TITLE,
      report_type: "board_packet",
      status: "generated",
      summary:
        "Local-only proof-pack fixture for the reports index/detail UI settle capture, grounded in the NCTC RTP cycle and frozen screening-grade model context.",
      created_by: ownerUserId,
      generated_at: DEMO_REPORT_GENERATED_AT,
      latest_artifact_kind: "html",
      latest_artifact_url: `/reports/${DEMO_REPORT_ID}#artifact-${DEMO_REPORT_ARTIFACT_ID}`,
      metadata_json: {
        queueTrace: {
          action: "seed_local_fixture",
          actedAt: DEMO_REPORT_GENERATED_AT,
          actorUserId: ownerUserId,
          source: "seed:nctc",
          detail: "Seeded deterministic local UI settle report fixture.",
        },
      },
      rtp_basis_stale: false,
      rtp_basis_stale_reason: null,
      rtp_basis_stale_run_id: null,
      rtp_basis_stale_marked_at: null,
    },
    reportArtifact: {
      id: DEMO_REPORT_ARTIFACT_ID,
      report_id: DEMO_REPORT_ID,
      artifact_kind: "html",
      storage_path: null,
      generated_by: ownerUserId,
      generated_at: DEMO_REPORT_GENERATED_AT,
      metadata_json: buildNctcReportArtifactMetadata(),
    },
    reportSections: buildNctcReportSections(),
    scenarioRuns: [
      {
        id: DEMO_SCENARIO_BASELINE_RUN_ID,
        workspace_id: DEMO_WORKSPACE_ID,
        title: "NCTC existing conditions screening run",
        query_text:
          "Local NCTC UI settle fixture: existing-conditions screening metrics from the frozen Nevada County run.",
        corridor_geojson: DEMO_CORRIDOR_SR49,
        metrics: {
          overallScore: 58,
          accessibilityScore: 58,
          safetyScore: 61,
          equityScore: 54,
          totalTransitStops: 18,
          totalFatalCrashes: 5,
          pctDisadvantaged: 21.4,
          pctZeroVehicle: 7.6,
          dataQuality: {
            posture: "local_ui_ux_settle_fixture",
            sourceRun: DEMO_COUNTY_RUN_NAME,
          },
        },
        result_geojson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                label: DEMO_SCENARIO_BASELINE_LABEL,
                source: "seed:nctc",
              },
              geometry: DEMO_CORRIDOR_SR49,
            },
          ],
        },
        summary_text:
          "Existing-conditions baseline for the local NCTC scenario proof. Screening-grade only; not a calibrated planning model.",
        ai_interpretation:
          "Local fixture summary. Use only for UI settle capture and scenario-readiness proof.",
        created_at: "2026-04-30T12:10:00.000Z",
      },
      {
        id: DEMO_SCENARIO_ALTERNATIVE_RUN_ID,
        workspace_id: DEMO_WORKSPACE_ID,
        title: "NCTC SR-49 safety package screening run",
        query_text:
          "Local NCTC UI settle fixture: SR-49 safety package comparison metrics against the existing-conditions baseline.",
        corridor_geojson: DEMO_CORRIDOR_SR49,
        metrics: {
          overallScore: 66,
          accessibilityScore: 64,
          safetyScore: 70,
          equityScore: 57,
          totalTransitStops: 20,
          totalFatalCrashes: 4,
          pctDisadvantaged: 21.4,
          pctZeroVehicle: 7.6,
          dataQuality: {
            posture: "local_ui_ux_settle_fixture",
            sourceRun: DEMO_COUNTY_RUN_NAME,
          },
        },
        result_geojson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                label: DEMO_SCENARIO_ALTERNATIVE_LABEL,
                source: "seed:nctc",
              },
              geometry: DEMO_CORRIDOR_SR49,
            },
          ],
        },
        summary_text:
          "Alternative package fixture for SR-49 crossing, signal, and shoulder treatments. Screening-grade only; intended for UI settle capture.",
        ai_interpretation:
          "Local fixture summary. Use only for UI settle capture and scenario-readiness proof.",
        created_at: "2026-04-30T12:20:00.000Z",
      },
    ],
    scenarioSet: {
      id: DEMO_SCENARIO_SET_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      title: DEMO_SCENARIO_SET_TITLE,
      summary:
        "Local-only proof-pack fixture for the scenarios index/detail UI settle capture, comparing the NCTC existing-conditions baseline with a targeted SR-49 safety package.",
      planning_question:
        "Does the SR-49 safety package improve access and safety enough to advance into the NCTC 2045 RTP programming pipeline?",
      status: "active",
      baseline_entry_id: DEMO_SCENARIO_BASELINE_ENTRY_ID,
      created_by: ownerUserId,
      created_at: "2026-04-30T12:05:00.000Z",
      updated_at: "2026-04-30T12:30:00.000Z",
    },
    scenarioEntries: [
      {
        id: DEMO_SCENARIO_BASELINE_ENTRY_ID,
        scenario_set_id: DEMO_SCENARIO_SET_ID,
        entry_type: "baseline",
        label: DEMO_SCENARIO_BASELINE_LABEL,
        slug: "existing-conditions-baseline",
        summary:
          "Baseline entry for the frozen Nevada County screening run, preserved as the comparison anchor for the local UI settle proof.",
        assumptions_json: {
          horizonYear: 2045,
          sourceRun: DEMO_COUNTY_RUN_NAME,
          posture: "screening_grade",
        },
        attached_run_id: DEMO_SCENARIO_BASELINE_RUN_ID,
        status: "ready",
        sort_order: 0,
        created_by: ownerUserId,
        created_at: "2026-04-30T12:12:00.000Z",
        updated_at: "2026-04-30T12:12:00.000Z",
      },
      {
        id: DEMO_SCENARIO_ALTERNATIVE_ENTRY_ID,
        scenario_set_id: DEMO_SCENARIO_SET_ID,
        entry_type: "alternative",
        label: DEMO_SCENARIO_ALTERNATIVE_LABEL,
        slug: "sr-49-safety-package",
        summary:
          "Targeted SR-49 package with crossing, signal, and shoulder treatments for scenario-detail comparison proof.",
        assumptions_json: {
          packageType: "safety_and_access",
          corridor: "SR-49 through Grass Valley",
          modeledAs: "screening_delta_fixture",
        },
        attached_run_id: DEMO_SCENARIO_ALTERNATIVE_RUN_ID,
        status: "ready",
        sort_order: 1,
        created_by: ownerUserId,
        created_at: "2026-04-30T12:22:00.000Z",
        updated_at: "2026-04-30T12:22:00.000Z",
      },
    ],
    scenarioComparisonSnapshot: {
      id: DEMO_SCENARIO_COMPARISON_SNAPSHOT_ID,
      scenario_set_id: DEMO_SCENARIO_SET_ID,
      baseline_entry_id: DEMO_SCENARIO_BASELINE_ENTRY_ID,
      candidate_entry_id: DEMO_SCENARIO_ALTERNATIVE_ENTRY_ID,
      label: DEMO_SCENARIO_COMPARISON_LABEL,
      summary:
        "Seeded local comparison snapshot so scenario detail renders persistent comparison state without empty proof.",
      narrative:
        "The SR-49 safety package improves the local fixture scorecard while preserving the screening-grade caveat inherited from the frozen Nevada County run.",
      caveats_json: [
        "Local UI settle fixture only.",
        "Screening-grade metrics are not calibrated planning-model outputs.",
      ],
      metadata_json: {
        source: "seed:nctc",
        posture: "local_ui_ux_settle_fixture",
      },
      status: "ready",
      created_by: ownerUserId,
      created_at: "2026-04-30T12:30:00.000Z",
      updated_at: "2026-04-30T12:30:00.000Z",
    },
    scenarioComparisonIndicatorDeltas: [
      {
        id: DEMO_SCENARIO_ACCESSIBILITY_DELTA_ID,
        comparison_snapshot_id: DEMO_SCENARIO_COMPARISON_SNAPSHOT_ID,
        indicator_key: "accessibilityScore",
        indicator_label: "Accessibility score",
        unit_label: "points",
        delta_json: {
          baseline: 58,
          candidate: 64,
          delta: 6,
        },
        summary_text:
          "Seeded comparison delta: access improves under the SR-49 package fixture.",
        sort_order: 0,
        created_at: "2026-04-30T12:30:00.000Z",
        updated_at: "2026-04-30T12:30:00.000Z",
      },
      {
        id: DEMO_SCENARIO_SAFETY_DELTA_ID,
        comparison_snapshot_id: DEMO_SCENARIO_COMPARISON_SNAPSHOT_ID,
        indicator_key: "safetyScore",
        indicator_label: "Safety score",
        unit_label: "points",
        delta_json: {
          baseline: 61,
          candidate: 70,
          delta: 9,
        },
        summary_text:
          "Seeded comparison delta: safety posture improves under the SR-49 package fixture.",
        sort_order: 1,
        created_at: "2026-04-30T12:30:00.000Z",
        updated_at: "2026-04-30T12:30:00.000Z",
      },
    ],
  };
}

type Args = {
  envFile?: string;
  dryRun: boolean;
};

function usage(): string {
  return [
    "Usage:",
    "  pnpm seed:nctc [--env-file path/to/.env] [--dry-run]",
    "",
    "Purpose:",
    "  Idempotently seed the NCTC proof-of-capability demo workspace,",
    "  project, RTP cycle, and county-run (with manifest + validation",
    "  summary loaded from the local screening artifact tree).",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    switch (value) {
      case "--env-file":
        parsed.envFile = argv[i + 1] ?? "";
        i += 1;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        break;
    }
  }
  return parsed;
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const trimmed = rawValue.trim();
    const normalized =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ? trimmed.slice(1, -1)
        : trimmed;
    env[key] = normalized;
  }
  return env;
}

function loadEnv(envFile?: string): string[] {
  const loaded: string[] = [];
  const candidates = envFile ? [envFile, ...DEFAULT_ENV_CANDIDATES] : DEFAULT_ENV_CANDIDATES;
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      const parsed = parseEnvFile(fs.readFileSync(candidate, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (!process.env[key]?.trim()) {
          process.env[key] = value;
        }
      }
      loaded.push(candidate);
    }
  }
  return loaded;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readJson(relativePath: string): Record<string, unknown> {
  const full = path.join(ARTIFACT_ROOT, relativePath);
  if (!fs.existsSync(full)) {
    throw new Error(`Artifact file not found: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const loadedEnvFiles = loadEnv(args.envFile);

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!fs.existsSync(ARTIFACT_ROOT)) {
    throw new Error(
      `Artifact root not found: ${ARTIFACT_ROOT}. Expected the NCTC screening run to be present in the repo at this path.`
    );
  }

  console.log(`[seed:nctc] loaded env from: ${loadedEnvFiles.join(", ") || "(none — using process env)"}`);
  console.log(`[seed:nctc] artifact root: ${ARTIFACT_ROOT}`);
  if (args.dryRun) {
    console.log(`[seed:nctc] DRY RUN — will read artifacts but write nothing.`);
  }

  const bundleManifest = readJson("bundle_manifest.json");
  const validationSummary = readJson(path.join("validation", "validation_summary.json"));
  const countyRunOnrampManifest = buildNctcCountyOnrampManifest(bundleManifest, validationSummary);
  const modelingEvidenceBundle = buildNctcModelingEvidenceBundle(bundleManifest, validationSummary);

  console.log(
    `[seed:nctc] manifest: screening_grade=${bundleManifest.screening_grade}, ` +
      `zones=${(bundleManifest as { zones?: { zones?: number } }).zones?.zones ?? "?"}, ` +
      `loaded_links=${(bundleManifest as { assignment?: { loaded_links?: number } }).assignment?.loaded_links ?? "?"}`
  );
  console.log(
    `[seed:nctc] modeling evidence: claim=${modelingEvidenceBundle.claimDecision.claimStatus}, ` +
      `sources=${modelingEvidenceBundle.sourceManifests.length}, ` +
      `checks=${modelingEvidenceBundle.validationResults.length}`
  );

  if (args.dryRun) {
    console.log("[seed:nctc] dry run complete. No writes attempted.");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Demo user (auth.admin) — create if missing, reuse otherwise.
  // Lookup is by email, not by sentinel DEMO_USER_ID: the service-role admin
  // API assigns its own uid on create, so the real demo user's id won't
  // match DEMO_USER_ID on re-runs. Paginated listUsers + email match is the
  // idempotent path until supabase-js exposes a native email lookup.
  let demoUserId: string | null = null;
  {
    const perPage = 200;
    for (let page = 1; page <= 50 && !demoUserId; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) {
        throw new Error(`Failed to list auth users: ${error.message}`);
      }
      const match = (data?.users ?? []).find((u) => u.email === DEMO_USER_EMAIL);
      if (match) {
        demoUserId = match.id;
        break;
      }
      if ((data?.users?.length ?? 0) < perPage) break;
    }
  }

  if (demoUserId) {
    console.log(`[seed:nctc] reusing existing demo user: ${demoUserId}`);
  } else {
    const { data: created, error: createUserError } = await supabase.auth.admin.createUser({
      email: DEMO_USER_EMAIL,
      email_confirm: true,
      user_metadata: { name: "NCTC Demo Operator", is_demo: true },
    });
    if (createUserError || !created?.user?.id) {
      throw new Error(`Failed to create demo user: ${createUserError?.message ?? "no user returned"}`);
    }
    demoUserId = created.user.id;
    console.log(`[seed:nctc] created demo user: ${demoUserId}`);
  }

  // 2. Workspace (is_demo=true, pilot subscription so billing gates pass).
  const { error: workspaceError } = await supabase.from("workspaces").upsert(
    {
      id: DEMO_WORKSPACE_ID,
      name: DEMO_WORKSPACE_NAME,
      slug: DEMO_WORKSPACE_SLUG,
      plan: "pilot",
      subscription_plan: "pilot",
      subscription_status: "pilot",
      is_demo: true,
    },
    { onConflict: "id" }
  );
  if (workspaceError) {
    throw new Error(`Failed to upsert workspace: ${workspaceError.message}`);
  }
  console.log(`[seed:nctc] upserted workspace ${DEMO_WORKSPACE_ID}`);

  // 3. workspace_members owner row.
  const { error: membershipError } = await supabase.from("workspace_members").upsert(
    {
      workspace_id: DEMO_WORKSPACE_ID,
      user_id: demoUserId,
      role: "owner",
    },
    { onConflict: "workspace_id,user_id" }
  );
  if (membershipError) {
    throw new Error(`Failed to upsert workspace membership: ${membershipError.message}`);
  }
  console.log(`[seed:nctc] upserted membership owner=${demoUserId}`);

  // 4. Project.
  const { error: projectError } = await supabase.from("projects").upsert(
    {
      id: DEMO_PROJECT_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      name: DEMO_PROJECT_NAME,
      summary: DEMO_PROJECT_SUMMARY,
      status: "active",
      plan_type: "regional_transportation_plan",
      delivery_phase: "analysis",
      latitude: DEMO_PROJECT_LATITUDE,
      longitude: DEMO_PROJECT_LONGITUDE,
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (projectError) {
    throw new Error(`Failed to upsert project: ${projectError.message}`);
  }
  console.log(`[seed:nctc] upserted project ${DEMO_PROJECT_ID}`);

  // 4a. Local plan fixture for plans index/detail UI settle proof.
  const { error: planError } = await supabase.from("plans").upsert(
    {
      id: DEMO_PLAN_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      title: DEMO_PLAN_TITLE,
      plan_type: "regional",
      status: "active",
      geography_label: "Nevada County, CA",
      horizon_year: 2045,
      summary:
        "Local-only proof-pack fixture for the plans index/detail UI settle capture, grounded in the NCTC demo project and inherited engagement context.",
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (planError) {
    throw new Error(`Failed to upsert plan: ${planError.message}`);
  }
  console.log(`[seed:nctc] upserted plan ${DEMO_PLAN_ID}`);

  // 4b. Local program fixture for programs index/detail UI settle proof.
  const { error: programError } = await supabase.from("programs").upsert(
    {
      id: DEMO_PROGRAM_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      title: DEMO_PROGRAM_TITLE,
      program_type: "rtip",
      status: "assembling",
      cycle_name: "FY 2027/28–2030/31 RTIP",
      funding_classification: "mixed",
      sponsor_agency: "Nevada County Transportation Commission",
      owner_label: "NCTC programming desk",
      cadence_label: "biennial RTIP cycle",
      fiscal_year_start: 2027,
      fiscal_year_end: 2031,
      nomination_due_at: "2026-09-15T17:00:00Z",
      adoption_target_at: "2026-12-11T17:00:00Z",
      summary:
        "Local-only proof-pack fixture for the programs index/detail UI settle capture, linking the NCTC RTP proof plan to an RTIP-style funding readiness lane.",
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (programError) {
    throw new Error(`Failed to upsert program: ${programError.message}`);
  }
  console.log(`[seed:nctc] upserted program ${DEMO_PROGRAM_ID}`);

  const { error: programPlanLinkError } = await supabase.from("program_links").upsert(
    {
      id: DEMO_PROGRAM_PLAN_LINK_ID,
      program_id: DEMO_PROGRAM_ID,
      link_type: "plan",
      linked_id: DEMO_PLAN_ID,
      label: DEMO_PLAN_TITLE,
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (programPlanLinkError) {
    throw new Error(`Failed to upsert program plan link: ${programPlanLinkError.message}`);
  }
  console.log(`[seed:nctc] upserted program plan link ${DEMO_PROGRAM_PLAN_LINK_ID}`);

  const grantsSeedRecords = buildSeedRecords(demoUserId, bundleManifest, validationSummary);

  const { error: projectFundingProfileError } = await supabase.from("project_funding_profiles").upsert(
    grantsSeedRecords.projectFundingProfile,
    { onConflict: "project_id" }
  );
  if (projectFundingProfileError) {
    throw new Error(`Failed to upsert project funding profile: ${projectFundingProfileError.message}`);
  }
  console.log(`[seed:nctc] upserted project funding profile ${DEMO_PROJECT_FUNDING_PROFILE_ID}`);

  const { error: fundingOpportunityError } = await supabase.from("funding_opportunities").upsert(
    {
      id: DEMO_FUNDING_OPPORTUNITY_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      program_id: DEMO_PROGRAM_ID,
      project_id: DEMO_PROJECT_ID,
      title: DEMO_FUNDING_OPPORTUNITY_TITLE,
      opportunity_status: "open",
      decision_state: "pursue",
      agency_name: "California Transportation Commission",
      owner_label: "NCTC programming desk",
      cadence_label: "biennial call",
      expected_award_amount: 1250000,
      opens_at: "2026-07-01T16:00:00Z",
      closes_at: "2026-09-15T17:00:00Z",
      decision_due_at: "2026-12-11T17:00:00Z",
      summary:
        "Demo funding lane for capturing a populated programs detail surface with project, plan, and readiness context. Internal prototype only.",
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (fundingOpportunityError) {
    throw new Error(`Failed to upsert funding opportunity: ${fundingOpportunityError.message}`);
  }
  console.log(`[seed:nctc] upserted funding opportunity ${DEMO_FUNDING_OPPORTUNITY_ID}`);

  const { error: awardedOpportunityError } = await supabase.from("funding_opportunities").upsert(
    grantsSeedRecords.awardedFundingOpportunity,
    { onConflict: "id" }
  );
  if (awardedOpportunityError) {
    throw new Error(`Failed to upsert awarded funding opportunity: ${awardedOpportunityError.message}`);
  }
  console.log(`[seed:nctc] upserted awarded funding opportunity ${DEMO_AWARDED_FUNDING_OPPORTUNITY_ID}`);

  const { error: fundingAwardError } = await supabase.from("funding_awards").upsert(
    grantsSeedRecords.fundingAward,
    { onConflict: "id" }
  );
  if (fundingAwardError) {
    throw new Error(`Failed to upsert funding award: ${fundingAwardError.message}`);
  }
  console.log(`[seed:nctc] upserted funding award ${DEMO_FUNDING_AWARD_ID}`);

  const { error: billingInvoiceRecordsError } = await supabase.from("billing_invoice_records").upsert(
    grantsSeedRecords.billingInvoiceRecords,
    { onConflict: "id" }
  );
  if (billingInvoiceRecordsError) {
    throw new Error(`Failed to upsert reimbursement invoice fixture: ${billingInvoiceRecordsError.message}`);
  }
  console.log(
    `[seed:nctc] upserted ${grantsSeedRecords.billingInvoiceRecords.length} reimbursement invoice fixture`
  );

  // 5. RTP cycle.
  const { error: rtpCycleError } = await supabase.from("rtp_cycles").upsert(
    {
      id: DEMO_RTP_CYCLE_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      title: DEMO_RTP_CYCLE_TITLE,
      status: "draft",
      geography_label: "Nevada County, CA (FIPS 06057)",
      horizon_start_year: 2026,
      horizon_end_year: 2045,
      summary:
        "Proof-of-capability RTP cycle anchored to the NCTC screening-grade model run. Internal prototype only.",
      anchor_latitude: DEMO_RTP_ANCHOR_LATITUDE,
      anchor_longitude: DEMO_RTP_ANCHOR_LONGITUDE,
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (rtpCycleError) {
    throw new Error(`Failed to upsert rtp_cycle: ${rtpCycleError.message}`);
  }
  console.log(`[seed:nctc] upserted rtp_cycle ${DEMO_RTP_CYCLE_ID}`);

  // 6. project -> rtp_cycle link.
  const { error: linkError } = await supabase.from("project_rtp_cycle_links").upsert(
    {
      id: DEMO_PROJECT_RTP_LINK_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      rtp_cycle_id: DEMO_RTP_CYCLE_ID,
      portfolio_role: "candidate",
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (linkError) {
    throw new Error(`Failed to upsert project_rtp_cycle_link: ${linkError.message}`);
  }
  console.log(`[seed:nctc] upserted project_rtp_cycle_link ${DEMO_PROJECT_RTP_LINK_ID}`);

  // 7. Data Hub connector/dataset lineage fixture for populated /data-hub proof.
  const { error: dataConnectorError } = await supabase.from("data_connectors").upsert(
    grantsSeedRecords.dataConnector,
    { onConflict: "id" }
  );
  if (dataConnectorError) {
    throw new Error(`Failed to upsert Data Hub connector: ${dataConnectorError.message}`);
  }

  const { error: dataDatasetsError } = await supabase.from("data_datasets").upsert(
    grantsSeedRecords.dataDatasets,
    { onConflict: "id" }
  );
  if (dataDatasetsError) {
    throw new Error(`Failed to upsert Data Hub datasets: ${dataDatasetsError.message}`);
  }

  const { error: dataRefreshJobsError } = await supabase.from("data_refresh_jobs").upsert(
    grantsSeedRecords.dataRefreshJobs,
    { onConflict: "id" }
  );
  if (dataRefreshJobsError) {
    throw new Error(`Failed to upsert Data Hub refresh jobs: ${dataRefreshJobsError.message}`);
  }

  const { error: dataDatasetProjectLinksError } = await supabase
    .from("data_dataset_project_links")
    .upsert(grantsSeedRecords.dataDatasetProjectLinks, { onConflict: "dataset_id,project_id" });
  if (dataDatasetProjectLinksError) {
    throw new Error(`Failed to upsert Data Hub project links: ${dataDatasetProjectLinksError.message}`);
  }

  console.log(
    `[seed:nctc] upserted Data Hub fixture ${DEMO_DATA_CONNECTOR_ID} ` +
      `(${grantsSeedRecords.dataDatasets.length} datasets, ` +
      `${grantsSeedRecords.dataRefreshJobs.length} refresh job, ` +
      `${grantsSeedRecords.dataDatasetProjectLinks.length} project links)`
  );

  // 8. county_runs row with manifest_json + validation_summary_json verbatim.
  const { error: countyRunError } = await supabase.from("county_runs").upsert(
    {
      id: DEMO_COUNTY_RUN_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      geography_type: "county_fips",
      geography_id: "06057",
      geography_label: "Nevada County, CA",
      run_name: DEMO_COUNTY_RUN_NAME,
      stage: "validated-screening",
      status_label: (validationSummary.status_label as string | undefined) ?? "internal prototype only",
      mode: "existing-run",
      manifest_json: bundleManifest,
      validation_summary_json: validationSummary,
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (countyRunError) {
    throw new Error(`Failed to upsert county_run: ${countyRunError.message}`);
  }
  console.log(`[seed:nctc] upserted county_run ${DEMO_COUNTY_RUN_ID}`);

  // 9. Assignment modeling evidence backbone rows for the demo county run.
  const evidenceResult = await refreshCountyRunModelingEvidence({
    supabase,
    workspaceId: DEMO_WORKSPACE_ID,
    countyRunId: DEMO_COUNTY_RUN_ID,
    manifest: countyRunOnrampManifest,
    geographyLabel: "Nevada County, CA",
  });
  if (evidenceResult.error) {
    if (evidenceResult.error.missingSchema) {
      console.warn(
        `[seed:nctc] skipped modeling evidence; migration not applied (${evidenceResult.error.message})`
      );
    } else {
      throw new Error(`Failed to refresh modeling evidence: ${evidenceResult.error.message}`);
    }
  } else {
    console.log(
      `[seed:nctc] refreshed modeling evidence ` +
        `(${evidenceResult.insertedSourceManifestCount} sources, ` +
        `${evidenceResult.insertedValidationResultCount} checks, ` +
        `claim=${evidenceResult.bundle.claimDecision.claimStatus})`
    );
  }

  // 10. Existing Conditions / Travel Patterns chapter for the demo cycle.
  //    The default trigger seeds 7 standard chapters; this adds an 8th
  //    chapter specific to the NCTC demo, with content_markdown composed
  //    directly from the bundle manifest + validation summary.
  const chapterContent = buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary);
  const { error: chapterError } = await supabase.from("rtp_cycle_chapters").upsert(
    {
      id: DEMO_EXISTING_CONDITIONS_CHAPTER_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      rtp_cycle_id: DEMO_RTP_CYCLE_ID,
      chapter_key: DEMO_EXISTING_CONDITIONS_CHAPTER_KEY,
      title: DEMO_EXISTING_CONDITIONS_CHAPTER_TITLE,
      section_type: "performance",
      status: "ready_for_review",
      sort_order: 5,
      required: true,
      guidance:
        "Describe the study area, baseline demographics, travel demand, network, and validation posture. This demo chapter is populated from the frozen NCTC screening run — every number traces back to the bundled manifest and validation summary.",
      summary:
        "Proof-of-capability baseline-conditions chapter for the NCTC demo RTP cycle, composed directly from the screening-grade AequilibraE run + Caltrans count validation.",
      content_markdown: chapterContent,
      created_by: demoUserId,
    },
    { onConflict: "rtp_cycle_id,chapter_key" }
  );
  if (chapterError) {
    throw new Error(`Failed to upsert existing-conditions chapter: ${chapterError.message}`);
  }
  console.log(
    `[seed:nctc] upserted chapter ${DEMO_EXISTING_CONDITIONS_CHAPTER_KEY} (${chapterContent.length} chars)`
  );

  // 11. Scenario set + comparison fixture for local UI/UX settle proof.
  //     The first scenario_set upsert intentionally leaves baseline_entry_id
  //     null because the baseline entry FK cannot exist until entries are
  //     written. The final upsert below restores the deterministic baseline.
  const scenarioSeedRecords = buildSeedRecords(demoUserId, bundleManifest, validationSummary);
  const { error: scenarioSetInitialError } = await supabase.from("scenario_sets").upsert(
    {
      ...scenarioSeedRecords.scenarioSet,
      baseline_entry_id: null,
    },
    { onConflict: "id" }
  );
  if (scenarioSetInitialError) {
    throw new Error(`Failed to upsert scenario set fixture: ${scenarioSetInitialError.message}`);
  }

  const { error: scenarioRunsError } = await supabase.from("runs").upsert(
    scenarioSeedRecords.scenarioRuns,
    { onConflict: "id" }
  );
  if (scenarioRunsError) {
    throw new Error(`Failed to upsert scenario runs: ${scenarioRunsError.message}`);
  }

  const { error: scenarioEntriesError } = await supabase.from("scenario_entries").upsert(
    scenarioSeedRecords.scenarioEntries,
    { onConflict: "id" }
  );
  if (scenarioEntriesError) {
    throw new Error(`Failed to upsert scenario entries: ${scenarioEntriesError.message}`);
  }

  const { error: scenarioSetFinalError } = await supabase.from("scenario_sets").upsert(
    scenarioSeedRecords.scenarioSet,
    { onConflict: "id" }
  );
  if (scenarioSetFinalError) {
    throw new Error(`Failed to finalize scenario set baseline: ${scenarioSetFinalError.message}`);
  }

  const { error: scenarioComparisonSnapshotError } = await supabase
    .from("scenario_comparison_snapshots")
    .upsert(scenarioSeedRecords.scenarioComparisonSnapshot, { onConflict: "id" });
  if (scenarioComparisonSnapshotError) {
    throw new Error(
      `Failed to upsert scenario comparison snapshot: ${scenarioComparisonSnapshotError.message}`
    );
  }

  const { error: scenarioComparisonDeltasError } = await supabase
    .from("scenario_comparison_indicator_deltas")
    .upsert(scenarioSeedRecords.scenarioComparisonIndicatorDeltas, { onConflict: "id" });
  if (scenarioComparisonDeltasError) {
    throw new Error(
      `Failed to upsert scenario comparison deltas: ${scenarioComparisonDeltasError.message}`
    );
  }

  console.log(
    `[seed:nctc] upserted scenario fixture ${DEMO_SCENARIO_SET_ID} ` +
      `(${scenarioSeedRecords.scenarioEntries.length} entries, ` +
      `${scenarioSeedRecords.scenarioComparisonIndicatorDeltas.length} deltas)`
  );

  // 12. Aerial missions with authored AOI polygons. Three missions
  //    cover distinct NCTC geographies (downtown Grass Valley, the
  //    SR-49 / Alta Sierra corridor south of town, and the Empire
  //    Mine State Historic Park area). Each polygon carries 9+
  //    vertices so the mission map inspector and DJI waypoint export
  //    render meaningfully.
  const missions = [
    {
      id: DEMO_MISSION_DOWNTOWN_ID,
      title: "Downtown Grass Valley aerial survey",
      mission_type: "aoi_capture",
      status: "complete",
      geography_label: "Downtown Grass Valley — Mill/Main/South Auburn",
      notes:
        "Repeat-capture baseline of the downtown core to anchor corridor-condition deltas for the 2045 RTP existing-conditions chapter.",
      aoi_geojson: DEMO_AOI_DOWNTOWN,
      collected_at: "2026-03-12T17:30:00Z",
    },
    {
      id: DEMO_MISSION_SR49_ID,
      title: "SR-49 Alta Sierra corridor survey",
      mission_type: "corridor_survey",
      status: "complete",
      geography_label: "SR-49 corridor — Grass Valley south to Alta Sierra",
      notes:
        "Corridor mission south of Grass Valley covering the SR-49 signalized intersections flagged in the screening-grade validation summary.",
      aoi_geojson: DEMO_AOI_SR49_ALTA_SIERRA,
      collected_at: "2026-03-19T18:05:00Z",
    },
    {
      id: DEMO_MISSION_EMPIRE_ID,
      title: "Empire Mine State Historic Park site inspection",
      mission_type: "site_inspection",
      status: "active",
      geography_label: "Empire Mine State Historic Park — Empire St access",
      notes:
        "Site inspection supporting the recreation-access element of the 2045 RTP. Authored AOI, pending evidence package QA.",
      aoi_geojson: DEMO_AOI_EMPIRE_MINE,
      collected_at: "2026-04-02T16:15:00Z",
    },
  ];
  for (const mission of missions) {
    const { error } = await supabase.from("aerial_missions").upsert(
      {
        ...mission,
        workspace_id: DEMO_WORKSPACE_ID,
        project_id: DEMO_PROJECT_ID,
      },
      { onConflict: "id" }
    );
    if (error) {
      throw new Error(`Failed to upsert aerial mission ${mission.id}: ${error.message}`);
    }
    const ringLen = mission.aoi_geojson.coordinates[0].length;
    console.log(`[seed:nctc] upserted aerial mission ${mission.id} (${ringLen} vertices, status=${mission.status})`);
  }

  const evidencePackages = [
    {
      id: DEMO_PACKAGE_DOWNTOWN_ID,
      mission_id: DEMO_MISSION_DOWNTOWN_ID,
      title: "Downtown Grass Valley ortho + DSM bundle",
      package_type: "measurable_output",
      status: "ready",
      verification_readiness: "ready",
      notes:
        "2.5 cm GSD ortho, DSM, and tie-point report. Ground control recovered; residuals within Part 107 tolerance.",
    },
    {
      id: DEMO_PACKAGE_SR49_ID,
      mission_id: DEMO_MISSION_SR49_ID,
      title: "SR-49 corridor share packet",
      package_type: "share_package",
      status: "shared",
      verification_readiness: "ready",
      notes:
        "PDF share packet with annotated signal spacings, shoulder widths, and observed queuing hotspots from the AequilibraE screening run.",
    },
    {
      id: DEMO_PACKAGE_EMPIRE_ID,
      mission_id: DEMO_MISSION_EMPIRE_ID,
      title: "Empire Mine QA bundle (pending)",
      package_type: "qa_bundle",
      status: "qa_pending",
      verification_readiness: "partial",
      notes:
        "QA bundle awaiting tie-point re-solve after two control panels were obscured by canopy; photographer notes attached.",
    },
  ];
  for (const evidence of evidencePackages) {
    const { error } = await supabase.from("aerial_evidence_packages").upsert(
      {
        ...evidence,
        workspace_id: DEMO_WORKSPACE_ID,
        project_id: DEMO_PROJECT_ID,
      },
      { onConflict: "id" }
    );
    if (error) {
      throw new Error(`Failed to upsert aerial evidence package ${evidence.id}: ${error.message}`);
    }
    console.log(`[seed:nctc] upserted evidence package ${evidence.id} (${evidence.status})`);
  }

  // 13. Project corridors — display-only LineStrings on the backdrop.
  //     Two authored roads anchored on Grass Valley geography: SR-49
  //     through downtown heading south, and Empire St heading east
  //     toward Empire Mine State Historic Park.
  const corridors = [
    {
      id: DEMO_CORRIDOR_SR49_ID,
      name: "SR-49 through Grass Valley",
      corridor_type: "arterial",
      los_grade: "D",
      geometry_geojson: DEMO_CORRIDOR_SR49,
    },
    {
      id: DEMO_CORRIDOR_EMPIRE_ID,
      name: "Empire St to Empire Mine",
      corridor_type: "arterial",
      los_grade: "C",
      geometry_geojson: DEMO_CORRIDOR_EMPIRE_ST,
    },
  ];
  for (const corridor of corridors) {
    const { error } = await supabase.from("project_corridors").upsert(
      {
        ...corridor,
        workspace_id: DEMO_WORKSPACE_ID,
        project_id: DEMO_PROJECT_ID,
      },
      { onConflict: "id" }
    );
    if (error) {
      throw new Error(`Failed to upsert project corridor ${corridor.id}: ${error.message}`);
    }
    const ringLen = corridor.geometry_geojson.coordinates.length;
    console.log(
      `[seed:nctc] upserted project corridor ${corridor.id} (${ringLen} positions, los=${corridor.los_grade})`
    );
  }

  // 14. Community engagement input — approved map comments that render as
  //     low-weight point features on the cartographic shell.
  const { error: engagementCampaignError } = await supabase.from("engagement_campaigns").upsert(
    {
      id: DEMO_ENGAGEMENT_CAMPAIGN_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: DEMO_PROJECT_ID,
      rtp_cycle_id: DEMO_RTP_CYCLE_ID,
      title: DEMO_ENGAGEMENT_CAMPAIGN_TITLE,
      summary:
        "Demo public-input map for the NCTC 2045 RTP proof-of-capability workspace. Items are hand-authored but representative of the comments a small RTPA would triage.",
      status: "active",
      engagement_type: "map_feedback",
      public_description:
        "Shareable map comments collected during the demo RTP outreach window.",
      allow_public_submissions: false,
      created_by: demoUserId,
    },
    { onConflict: "id" }
  );
  if (engagementCampaignError) {
    throw new Error(`Failed to upsert engagement campaign: ${engagementCampaignError.message}`);
  }
  console.log(`[seed:nctc] upserted engagement campaign ${DEMO_ENGAGEMENT_CAMPAIGN_ID}`);

  for (const item of DEMO_ENGAGEMENT_ITEMS) {
    const { error } = await supabase.from("engagement_items").upsert(
      {
        ...item,
        metadata_json: { seed: "nctc_demo", cartographic_layer: true },
        created_by: demoUserId,
      },
      { onConflict: "id" }
    );
    if (error) {
      throw new Error(`Failed to upsert engagement item ${item.id}: ${error.message}`);
    }
    console.log(
      `[seed:nctc] upserted engagement item ${item.id} (${item.status}, ${item.latitude}, ${item.longitude})`
    );
  }

  // 15. Deterministic report packet fixture for local UI/UX settle proof.
  const { error: reportError } = await supabase.from("reports").upsert(
    {
      id: DEMO_REPORT_ID,
      workspace_id: DEMO_WORKSPACE_ID,
      project_id: null,
      rtp_cycle_id: DEMO_RTP_CYCLE_ID,
      modeling_county_run_id: DEMO_COUNTY_RUN_ID,
      title: DEMO_REPORT_TITLE,
      report_type: "board_packet",
      status: "generated",
      summary:
        "Local-only proof-pack fixture for the reports index/detail UI settle capture, grounded in the NCTC RTP cycle and frozen screening-grade model context.",
      created_by: demoUserId,
      generated_at: DEMO_REPORT_GENERATED_AT,
      latest_artifact_kind: "html",
      latest_artifact_url: `/reports/${DEMO_REPORT_ID}#artifact-${DEMO_REPORT_ARTIFACT_ID}`,
      metadata_json: {
        queueTrace: {
          action: "seed_local_fixture",
          actedAt: DEMO_REPORT_GENERATED_AT,
          actorUserId: demoUserId,
          source: "seed:nctc",
          detail: "Seeded deterministic local UI settle report fixture.",
        },
      },
      rtp_basis_stale: false,
      rtp_basis_stale_reason: null,
      rtp_basis_stale_run_id: null,
      rtp_basis_stale_marked_at: null,
    },
    { onConflict: "id" }
  );
  if (reportError) {
    throw new Error(`Failed to upsert report fixture: ${reportError.message}`);
  }
  console.log(`[seed:nctc] upserted report fixture ${DEMO_REPORT_ID}`);

  const reportSections = buildNctcReportSections();
  const { error: reportSectionsError } = await supabase.from("report_sections").upsert(
    reportSections,
    { onConflict: "report_id,section_key" }
  );
  if (reportSectionsError) {
    throw new Error(`Failed to upsert report fixture sections: ${reportSectionsError.message}`);
  }
  console.log(`[seed:nctc] upserted ${reportSections.length} report fixture sections`);

  const { error: reportArtifactError } = await supabase.from("report_artifacts").upsert(
    {
      id: DEMO_REPORT_ARTIFACT_ID,
      report_id: DEMO_REPORT_ID,
      artifact_kind: "html",
      storage_path: null,
      generated_by: demoUserId,
      generated_at: DEMO_REPORT_GENERATED_AT,
      metadata_json: buildNctcReportArtifactMetadata(),
    },
    { onConflict: "id" }
  );
  if (reportArtifactError) {
    throw new Error(`Failed to upsert report fixture artifact: ${reportArtifactError.message}`);
  }
  console.log(`[seed:nctc] upserted report fixture artifact ${DEMO_REPORT_ARTIFACT_ID}`);

  // 16. Public census tracts (equity choropleth demo data).
  //     `census_tracts` is public data (no workspace scoping) and has a
  //     GEOMETRY(MultiPolygon, 4326) NOT NULL column — the Supabase JS
  //     client can't send PostGIS geometry directly, so we upsert through
  //     the `seed_public_census_tract` RPC (service_role only) added in
  //     migration 20260422000068. pct_zero_vehicle / pct_poverty /
  //     pct_nonwhite are derived in the `census_tracts_computed` view, so
  //     we only write the raw counts.
  const tracts = [
    {
      geoid: DEMO_TRACT_GRASS_VALLEY_CORE_GEOID,
      name: "Grass Valley — downtown (demo)",
      geometry: DEMO_TRACT_GRASS_VALLEY_CORE,
      pop_total: 3800,
      pop_white: 3040, // ~20% nonwhite
      households: 1600,
      households_zero_vehicle: 192, // 12% (urban bin: 10–15%)
      median_household_income: 52000,
      pop_below_poverty: 532, // 14% poverty
    },
    {
      geoid: DEMO_TRACT_GRASS_VALLEY_SOUTH_GEOID,
      name: "Grass Valley — south / Alta Sierra (demo)",
      geometry: DEMO_TRACT_GRASS_VALLEY_SOUTH,
      pop_total: 4200,
      pop_white: 3570, // ~15% nonwhite
      households: 1750,
      households_zero_vehicle: 123, // 7% (suburban bin: 5–10%)
      median_household_income: 68000,
      pop_below_poverty: 378, // 9% poverty
    },
    {
      geoid: DEMO_TRACT_NEVADA_CITY_GEOID,
      name: "Nevada City (demo)",
      geometry: DEMO_TRACT_NEVADA_CITY,
      pop_total: 3100,
      pop_white: 2635, // ~15% nonwhite
      households: 1400,
      households_zero_vehicle: 112, // 8% (small-town bin: 5–10%)
      median_household_income: 61000,
      pop_below_poverty: 310, // 10% poverty
    },
    {
      geoid: DEMO_TRACT_RURAL_EAST_GEOID,
      name: "Nevada County — rural east (demo)",
      geometry: DEMO_TRACT_RURAL_EAST,
      pop_total: 5200,
      pop_white: 4680, // ~10% nonwhite
      households: 2100,
      households_zero_vehicle: 63, // 3% (rural bin: <5%)
      median_household_income: 74000,
      pop_below_poverty: 312, // 6% poverty
    },
  ];
  for (const tract of tracts) {
    const { error } = await supabase.rpc("seed_public_census_tract", {
      p_geoid: tract.geoid,
      p_state_fips: "06",
      p_county_fips: "057",
      p_name: tract.name,
      p_geometry_geojson: tract.geometry,
      p_pop_total: tract.pop_total,
      p_pop_white: tract.pop_white,
      p_households: tract.households,
      p_households_zero_vehicle: tract.households_zero_vehicle,
      p_median_household_income: tract.median_household_income,
      p_pop_below_poverty: tract.pop_below_poverty,
    });
    if (error) {
      throw new Error(`Failed to upsert census tract ${tract.geoid}: ${error.message}`);
    }
    const pctZv = ((tract.households_zero_vehicle / tract.households) * 100).toFixed(1);
    console.log(
      `[seed:nctc] upserted census tract ${tract.geoid} (pct_zero_vehicle=${pctZv}%)`
    );
  }

  console.log("");
  console.log("[seed:nctc] done.");
  console.log(`  workspace:   ${DEMO_WORKSPACE_ID} (${DEMO_WORKSPACE_NAME})`);
  console.log(`  project:     ${DEMO_PROJECT_ID}`);
  console.log(`  plan:        ${DEMO_PLAN_ID}`);
  console.log(`  program:     ${DEMO_PROGRAM_ID}`);
  console.log(`  opportunity: ${DEMO_FUNDING_OPPORTUNITY_ID}`);
  console.log(`  grant_award: ${DEMO_FUNDING_AWARD_ID}`);
  console.log(`  invoice:     ${DEMO_REIMBURSEMENT_INVOICE_ID} (${DEMO_REIMBURSEMENT_INVOICE_NUMBER})`);
  console.log(`  data_hub:    ${DEMO_DATA_CONNECTOR_ID} (${grantsSeedRecords.dataDatasets.length} datasets)`);
  console.log(`  report:      ${DEMO_REPORT_ID}`);
  console.log(`  scenario:    ${DEMO_SCENARIO_SET_ID}`);
  console.log(`  rtp_cycle:   ${DEMO_RTP_CYCLE_ID}`);
  console.log(`  county_run:  ${DEMO_COUNTY_RUN_ID}`);
  console.log(`  chapter:     ${DEMO_EXISTING_CONDITIONS_CHAPTER_ID} (${DEMO_EXISTING_CONDITIONS_CHAPTER_KEY})`);
  console.log(`  missions:    ${missions.length} (downtown / SR-49 / Empire Mine)`);
  console.log(`  packages:    ${evidencePackages.length}`);
  console.log(`  corridors:   ${corridors.length} (SR-49 / Empire St)`);
  console.log(`  engagement:  ${DEMO_ENGAGEMENT_ITEMS.length} approved items`);
  console.log(`  evidence:    ${modelingEvidenceBundle.claimDecision.claimStatus}`);
  console.log(`  tracts:      ${tracts.length} (Nevada County public demo)`);
  console.log(`  demo user:   ${demoUserId} (${DEMO_USER_EMAIL})`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error("[seed:nctc] failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
