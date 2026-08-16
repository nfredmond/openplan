import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { presentCountyRunDetail } from "@/lib/api/county-onramp-presenters";
import { refreshCountyRunModelingEvidence } from "@/lib/models/evidence-backbone";
import { buildCountyRunProvenanceDocument } from "@/lib/models/county-run-provenance";

/**
 * The appendix document for a county run's traffic figures.
 *
 * A number in a funding application can be audited years after the person who
 * produced it has moved on. This hands a planner one file recording what the
 * figures rest on — the data sources and their vintages, the zone resolution,
 * whether the assignment converged, whether it was checked against real counts
 * and what that found, whether it was fitted to local counts, and the ceiling on
 * what it may be used for.
 *
 * READ-ONLY, and it computes nothing. Every value is copied from what the run
 * already recorded; a figure the run does not have is written as "not recorded"
 * rather than derived, because a plausible number in an appendix is
 * indistinguishable from a measured one.
 *
 * Markdown on purpose: it pastes into a proposal, a Word document or an email
 * with no rendering engine, and an appendix that needs software to open is an
 * appendix that gets left out.
 */

const paramsSchema = z.object({
  countyRunId: z.string().uuid(),
});

const COUNTY_RUN_COLUMNS =
  "id, workspace_id, geography_type, geography_id, geography_label, run_name, stage, status_label, " +
  "enqueue_status, last_enqueued_at, worker_job_id, worker_payload_json, worker_url, " +
  "worker_dispatch_error, requested_runtime_json, manifest_json, validation_summary_json";

type RouteContext = {
  params: Promise<{ countyRunId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.provenance", request);
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
      .select(COUNTY_RUN_COLUMNS)
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

    // Reuses the detail presenter rather than reshaping the row here: the
    // document must describe the same run the page describes, and a second
    // interpretation of the same columns is how two surfaces come to disagree
    // about what a figure means.
    const detail = presentCountyRunDetail({
      row: countyRun as unknown as Parameters<typeof presentCountyRunDetail>[0]["row"],
      artifacts: [],
    });

    // Best-effort: the structured evidence is a nicety and its absence is
    // reported inside the document ("no data sources were recorded") rather
    // than failing the export. A planner who cannot download the record learns
    // nothing; one who downloads a record that says what is missing learns the
    // most important thing about the run.
    const modelingEvidence = detail.manifest
      ? await refreshCountyRunModelingEvidence({
          supabase: supabase as unknown as Parameters<typeof refreshCountyRunModelingEvidence>[0]["supabase"],
          workspaceId: (countyRun as unknown as { workspace_id: string }).workspace_id,
          countyRunId: parsedParams.data.countyRunId,
          manifest: detail.manifest,
          geographyLabel: detail.geographyLabel,
        })
          .then((result) => result?.bundle ?? null)
          .catch(() => null)
      : null;

    const document = buildCountyRunProvenanceDocument({
      runName: detail.runName,
      geographyLabel: detail.geographyLabel ?? null,
      geographyId: detail.geographyId ?? null,
      stage: detail.stage ?? null,
      statusLabel: detail.statusLabel ?? null,
      manifest: detail.manifest ?? null,
      validationSummary: (detail.validationSummary as Record<string, unknown> | null) ?? null,
      modelingEvidence: modelingEvidence ?? detail.modelingEvidence ?? null,
      generatedAt: new Date().toISOString(),
    });

    audit.info("county_run_provenance_exported", {
      countyRunId: parsedParams.data.countyRunId,
      durationMs: Date.now() - startedAt,
    });

    // Filename from the run's own name, reduced to characters a Content-
    // Disposition header and every filesystem accept.
    const filename = `${(detail.runName || "county-run")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "county-run"}-data-sources-and-limits.md`;
    return new NextResponse(document, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        // A record of one moment. Serving a cached copy after a run has been
        // re-validated would hand an auditor a document describing a state the
        // run is no longer in.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    audit.error("county_run_provenance_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while building the modelling record" }, { status: 500 });
  }
}
