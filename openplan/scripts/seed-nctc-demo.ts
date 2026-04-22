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

export const DEMO_MISSION_DOWNTOWN_ID = "d0000001-0000-4000-8000-000000000008";
export const DEMO_MISSION_SR49_ID = "d0000001-0000-4000-8000-000000000009";
export const DEMO_MISSION_EMPIRE_ID = "d0000001-0000-4000-8000-00000000000a";

export const DEMO_PACKAGE_DOWNTOWN_ID = "d0000001-0000-4000-8000-00000000000b";
export const DEMO_PACKAGE_SR49_ID = "d0000001-0000-4000-8000-00000000000c";
export const DEMO_PACKAGE_EMPIRE_ID = "d0000001-0000-4000-8000-00000000000d";

export const DEMO_CORRIDOR_SR49_ID = "d0000001-0000-4000-8000-00000000000e";
export const DEMO_CORRIDOR_EMPIRE_ID = "d0000001-0000-4000-8000-00000000000f";

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
export const DEMO_RTP_CYCLE_TITLE = "NCTC 2045 RTP — demo cycle";
export const DEMO_COUNTY_RUN_NAME = "nevada-county-runtime-norenumber-freeze-20260324";

export type SeedRecords = {
  workspace: Record<string, unknown>;
  membership: Record<string, unknown>;
  project: Record<string, unknown>;
  rtpCycle: Record<string, unknown>;
  projectRtpLink: Record<string, unknown>;
  countyRun: Record<string, unknown>;
  existingConditionsChapter: Record<string, unknown>;
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

  console.log(
    `[seed:nctc] manifest: screening_grade=${bundleManifest.screening_grade}, ` +
      `zones=${(bundleManifest as { zones?: { zones?: number } }).zones?.zones ?? "?"}, ` +
      `loaded_links=${(bundleManifest as { assignment?: { loaded_links?: number } }).assignment?.loaded_links ?? "?"}`
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

  // 7. county_runs row with manifest_json + validation_summary_json verbatim.
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

  // 8. Existing Conditions / Travel Patterns chapter for the demo cycle.
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

  // 9. Aerial missions with authored AOI polygons. Three missions
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

  // 10. Project corridors — display-only LineStrings on the backdrop.
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

  console.log("");
  console.log("[seed:nctc] done.");
  console.log(`  workspace:   ${DEMO_WORKSPACE_ID} (${DEMO_WORKSPACE_NAME})`);
  console.log(`  project:     ${DEMO_PROJECT_ID}`);
  console.log(`  rtp_cycle:   ${DEMO_RTP_CYCLE_ID}`);
  console.log(`  county_run:  ${DEMO_COUNTY_RUN_ID}`);
  console.log(`  chapter:     ${DEMO_EXISTING_CONDITIONS_CHAPTER_ID} (${DEMO_EXISTING_CONDITIONS_CHAPTER_KEY})`);
  console.log(`  missions:    ${missions.length} (downtown / SR-49 / Empire Mine)`);
  console.log(`  packages:    ${evidencePackages.length}`);
  console.log(`  corridors:   ${corridors.length} (SR-49 / Empire St)`);
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
