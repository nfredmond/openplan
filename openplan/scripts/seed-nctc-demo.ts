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

export const DEMO_USER_EMAIL = "nctc-demo@openplan-demo.natford.example";
export const DEMO_WORKSPACE_NAME = "Nevada County Transportation Commission (demo)";
export const DEMO_WORKSPACE_SLUG = "nctc-demo";
export const DEMO_PROJECT_NAME = "NCTC 2045 RTP (proof-of-capability)";
export const DEMO_PROJECT_SUMMARY =
  "Proof-of-capability demo: what OpenPlan produces when a rural RTPA like Nevada County runs an RTP cycle through it, grounded in real NCTC geography and a real screening-grade AequilibraE assignment. Internal prototype only — not a calibrated planning-grade model.";
export const DEMO_RTP_CYCLE_TITLE = "NCTC 2045 RTP — demo cycle";
export const DEMO_COUNTY_RUN_NAME = "nevada-county-runtime-norenumber-freeze-20260324";

export type SeedRecords = {
  workspace: Record<string, unknown>;
  membership: Record<string, unknown>;
  project: Record<string, unknown>;
  rtpCycle: Record<string, unknown>;
  projectRtpLink: Record<string, unknown>;
  countyRun: Record<string, unknown>;
};

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
  let demoUserId = DEMO_USER_ID;
  const { data: existingUser } = await supabase.auth.admin.getUserById(DEMO_USER_ID);
  if (!existingUser?.user) {
    const { data: created, error: createUserError } = await supabase.auth.admin.createUser({
      email: DEMO_USER_EMAIL,
      email_confirm: true,
      user_metadata: { name: "NCTC Demo Operator", is_demo: true },
      // Service-role admin API does not let us set an explicit id directly.
      // We record whatever id gets assigned and use it for membership.
    });
    if (createUserError) {
      throw new Error(`Failed to create demo user: ${createUserError.message}`);
    }
    demoUserId = created.user?.id ?? DEMO_USER_ID;
    console.log(`[seed:nctc] created demo user: ${demoUserId}`);
  } else {
    console.log(`[seed:nctc] reusing existing demo user: ${DEMO_USER_ID}`);
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

  console.log("");
  console.log("[seed:nctc] done.");
  console.log(`  workspace:   ${DEMO_WORKSPACE_ID} (${DEMO_WORKSPACE_NAME})`);
  console.log(`  project:     ${DEMO_PROJECT_ID}`);
  console.log(`  rtp_cycle:   ${DEMO_RTP_CYCLE_ID}`);
  console.log(`  county_run:  ${DEMO_COUNTY_RUN_ID}`);
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
