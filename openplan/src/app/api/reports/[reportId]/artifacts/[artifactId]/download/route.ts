import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadReportAccess } from "@/lib/reports/api";
import { resolveTenantScopedStorageTarget } from "@/lib/files/tenant-scoped-storage";

/**
 * Download a generated report artifact.
 *
 * WHY THIS DID NOT EXIST. `/api/reports/[reportId]/generate` has uploaded PDFs
 * to the private `report-artifacts` bucket since the module shipped, and
 * `reports.latest_artifact_url` was set to `/reports/{id}#artifact-{id}` — an
 * in-app anchor to a ROW IN AN AUDIT TABLE, not a link to the file. There was
 * no signed-URL route anywhere under `/api/reports`, so a generated PDF landed
 * in storage that nothing could ever retrieve. The deliverable existed and was
 * unreachable.
 *
 * Mirrors the one route that already got this right —
 * `/api/models/[modelId]/runs/[modelRunId]/artifacts/[artifactId]/download` —
 * segment for segment: authorize the PARENT resource, confine the storage
 * reference to that parent's own prefix, mint a short-lived signed URL, redirect.
 */

// Matches the model-run artifact route and the engagement photo TTL: a
// short-lived link minted per request for an already-authorized reader, never
// a stored public URL.
const REPORT_ARTIFACT_SIGNED_URL_TTL_SECONDS = 15 * 60;

const ARTIFACT_BUCKET = "report-artifacts";

const paramsSchema = z.object({
  reportId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ reportId: string; artifactId: string }>;
};

type ArtifactRow = {
  id: string;
  report_id: string;
  artifact_kind: string | null;
  storage_path: string | null;
  generated_at: string | null;
  metadata_json: Record<string, unknown> | null;
};

/** A filename a planner can recognise in a downloads folder, not a UUID. */
function downloadFilename(
  title: string | null,
  generatedAt: string | null,
  extension: string
): string {
  const slug = (title ?? "openplan-report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const datePart = typeof generatedAt === "string" ? generatedAt.slice(0, 10) : "";
  return [slug || "openplan-report", datePart].filter(Boolean).join("-") + `.${extension}`;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("reports.artifact.download", request);
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid artifact route params" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await loadReportAccess(supabase, parsedParams.data.reportId, user.id);
  if (access.error) {
    audit.error("report_artifact_access_failed", { message: access.error.message });
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
  if (!access.report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  if (!access.membership || !canAccessWorkspaceAction("reports.read", access.membership.role)) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const report = access.report;

  // Scoped to the parent report, so an artifact id from another report cannot
  // be dereferenced through a report this caller happens to be able to read.
  const { data: artifactData, error: artifactError } = await supabase
    .from("report_artifacts")
    .select("id, report_id, artifact_kind, storage_path, generated_at, metadata_json")
    .eq("id", parsedParams.data.artifactId)
    .eq("report_id", report.id)
    .maybeSingle();

  if (artifactError) {
    audit.error("report_artifact_lookup_failed", {
      artifactId: parsedParams.data.artifactId,
      message: artifactError.message,
    });
    return NextResponse.json({ error: "Failed to load artifact" }, { status: 500 });
  }

  const artifact = (artifactData ?? null) as ArtifactRow | null;
  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const storagePath = typeof artifact.storage_path === "string" ? artifact.storage_path.trim() : "";

  if (storagePath) {
    // `report_artifacts` INSERT is member-writable (its RLS checks only
    // report -> workspace membership), so `storage_path` is caller-influenced
    // data and every dereference is bound to THIS report's own prefix.
    const extension = artifact.artifact_kind === "pdf" ? "pdf" : "html";
    const ref = resolveTenantScopedStorageTarget(storagePath, {
      bucket: ARTIFACT_BUCKET,
      objectPathPrefix: `${report.workspace_id}/${report.id}/`,
      extension: `.${extension}`,
    });

    if (!ref) {
      audit.warn("report_artifact_ref_out_of_scope", {
        artifactId: artifact.id,
        reportId: report.id,
      });
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const service = createServiceRoleClient();
    const { data, error } = await service.storage
      .from(ref.bucket)
      .createSignedUrl(ref.objectPath, REPORT_ARTIFACT_SIGNED_URL_TTL_SECONDS, {
        download: downloadFilename(report.title, artifact.generated_at, extension),
      });

    if (error || !data?.signedUrl) {
      audit.error("report_artifact_sign_failed", {
        artifactId: artifact.id,
        message: error?.message ?? "no signed url",
      });
      return NextResponse.json({ error: "Failed to sign artifact URL" }, { status: 500 });
    }

    audit.info("report_artifact_download_signed", {
      reportId: report.id,
      artifactId: artifact.id,
      artifactKind: artifact.artifact_kind,
    });
    return NextResponse.redirect(data.signedUrl);
  }

  // HTML artifacts are stored inline rather than in the bucket. Serving them is
  // strictly safer than the status quo — the same string is already rendered
  // in-page today — but it is sent as an ATTACHMENT and sandboxed so it can
  // never execute against this origin.
  const inlineHtml = artifact.metadata_json?.htmlContent;
  if (artifact.artifact_kind === "html" && typeof inlineHtml === "string" && inlineHtml.length > 0) {
    audit.info("report_artifact_download_inline_html", {
      reportId: report.id,
      artifactId: artifact.id,
    });
    return new NextResponse(inlineHtml, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${downloadFilename(report.title, artifact.generated_at, "html")}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
        "cache-control": "no-store",
      },
    });
  }

  // A recorded artifact with nothing behind it. Say which, rather than 404ing
  // as if the record did not exist.
  audit.warn("report_artifact_has_no_content", {
    reportId: report.id,
    artifactId: artifact.id,
    artifactKind: artifact.artifact_kind,
  });
  return NextResponse.json(
    {
      error:
        "This artifact record has no stored file. Regenerate the report to produce a downloadable artifact.",
    },
    { status: 409 }
  );
}
