import { access } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { prepareCountyRunValidationResponseSchema } from "@/lib/api/county-onramp";
import { countyOnrampManifestSchema } from "@/lib/models/county-onramp";
import {
  countyRunFolderIsReachable,
  describeCountyRunFilesUnavailable,
  resolveCountyRunStoredPath,
} from "@/lib/api/county-onramp-run-files";
import { isCountyOnrampWorkerConfigured } from "@/lib/config/deployment-health-facts";

const paramsSchema = z.object({
  countyRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ countyRunId: string }>;
};

const countyCallbackBearerEnvVar = "OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN";

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function pathExists(pathValue: string | null | undefined): Promise<boolean> {
  if (!pathValue) return false;
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.validate", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid county run route params" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: countyRun, error: countyRunError } = await supabase
      .from("county_runs")
      .select("id, manifest_json")
      .eq("id", parsedParams.data.countyRunId)
      .maybeSingle();

    if (countyRunError) {
      audit.error("county_run_lookup_failed", {
        message: countyRunError.message,
        code: countyRunError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load county run" }, { status: 500 });
    }

    if (!countyRun) {
      return NextResponse.json({ error: "County run not found" }, { status: 404 });
    }

    const parsedManifest = countyOnrampManifestSchema.safeParse(countyRun.manifest_json ?? null);
    if (!parsedManifest.success) {
      audit.warn("county_run_manifest_missing", { countyRunId: parsedParams.data.countyRunId });
      return NextResponse.json({ error: "This county run has not brought in its worker output file yet, so there is nothing to work from." }, { status: 400 });
    }

    const manifest = parsedManifest.data;
    const reasons: string[] = [];

    const runDir = manifest.run_dir ? resolveCountyRunStoredPath(manifest.run_dir) : null;
    const runOutputDir = runDir ? join(runDir, "run_output") : null;
    const countsCsvPath = manifest.artifacts.scaffold_csv ? resolveCountyRunStoredPath(manifest.artifacts.scaffold_csv) : null;
    const outputDir = runDir ? join(runDir, "validation") : null;
    const projectDbCandidate = runDir ? join(runDir, "work", "aeq_project", "project_database.sqlite") : null;
    const projectDbPath = (await pathExists(projectDbCandidate)) ? projectDbCandidate : null;
    const scaffold = manifest.summary.scaffold ?? null;

    // A run folder this copy cannot see is a path from another machine, not a
    // run with missing output. Saying "missing" there sends a planner to look
    // for files that are fine where the worker wrote them.
    const filesUnreachable = runDir !== null && !(await countyRunFolderIsReachable(runDir));

    if (!runDir) {
      reasons.push("The worker output file does not record where this run's files were written.");
    } else if (filesUnreachable) {
      reasons.push(describeCountyRunFilesUnavailable("check-validation", isCountyOnrampWorkerConfigured()));
    }
    if (!filesUnreachable && (!runOutputDir || !(await pathExists(runOutputDir)))) {
      reasons.push("County run output directory is missing, so the validator cannot be prepared yet.");
    }
    if (!countsCsvPath) {
      reasons.push("The worker output file does not record where the traffic-count template was written.");
    } else if (!filesUnreachable && !(await pathExists(countsCsvPath))) {
      reasons.push("Registered scaffold CSV file was not found on disk.");
    }
    if (!scaffold) {
      reasons.push("Validation scaffold readiness has not been recorded yet.");
    } else {
      if (scaffold.station_count === 0) {
        reasons.push("Validation scaffold does not currently contain any starter stations.");
      }
      if (scaffold.ready_station_count < scaffold.station_count) {
        reasons.push(
          `Only ${scaffold.ready_station_count} of ${scaffold.station_count} starter stations are validator-ready.`
        );
      }
    }

    const ready = reasons.length === 0;
    const command =
      ready && runOutputDir && countsCsvPath && outputDir
        ? [
            "python3",
            shellEscape("scripts/modeling/validate_screening_observed_counts.py"),
            "--run-output-dir",
            shellEscape(runOutputDir),
            "--counts-csv",
            shellEscape(countsCsvPath),
            "--output-dir",
            shellEscape(outputDir),
            ...(projectDbPath ? ["--project-db", shellEscape(projectDbPath)] : []),
          ].join(" ")
        : null;
    const refreshUrl = `${new URL(request.url).origin}/api/county-runs/${parsedParams.data.countyRunId}/validate/refresh`;
    const hasCallbackBearerAuth = Boolean(process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN?.trim());
    const automationCommand =
      ready && command && hasCallbackBearerAuth
        ? `${command} && curl -sS -X POST ${shellEscape(refreshUrl)} -H 'accept: application/json' -H "authorization: Bearer $${countyCallbackBearerEnvVar}"`
        : null;

    const response = prepareCountyRunValidationResponseSchema.parse({
      countyRunId: parsedParams.data.countyRunId,
      ready,
      statusLabel: ready ? "Ready to validate" : "Validation prep blocked",
      reasons,
      command,
      automationCommand,
      refreshUrl,
      callbackAuthMode: hasCallbackBearerAuth ? "bearer-env" : "session-only",
      runOutputDir,
      countsCsvPath,
      outputDir,
      projectDbPath,
    });

    audit.info("county_run_validation_prepared", {
      countyRunId: parsedParams.data.countyRunId,
      ready,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("county_run_validation_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while preparing county validation" }, { status: 500 });
  }
}
