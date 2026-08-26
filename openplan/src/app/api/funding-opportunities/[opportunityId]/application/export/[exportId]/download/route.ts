import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { resolveTenantScopedStorageTarget } from "@/lib/files/tenant-scoped-storage";
import {
  APPLICATION_PENDING_SCHEMA_ERROR,
  looksLikePendingAssemblySchema,
} from "@/lib/grants/application";

/**
 * Re-download a stored application export. Mirrors the report-artifact
 * download route segment for segment: authorize the PARENT resource, confine
 * the stored path to that parent's own prefix, mint a short-lived signed URL,
 * redirect. The export register is member-INSERTable, so `storage_path` is
 * caller-influenced data and confinement is load-bearing.
 */

const EXPORT_BUCKET = "grant-application-exports";
const SIGNED_URL_TTL_SECONDS = 15 * 60;

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
  exportId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ opportunityId: string; exportId: string }>;
};

function downloadFilename(title: string, generatedAt: string | null): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const datePart = typeof generatedAt === "string" ? generatedAt.slice(0, 10) : "";
  return [slug || "application-packet", datePart].filter(Boolean).join("-") + ".pdf";
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("funding-opportunities.application.export.download", request);
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid export route params" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await loadFundingOpportunityAccess(
    supabase,
    parsedParams.data.opportunityId,
    user.id,
    "programs.read"
  );

  if (access.error) {
    audit.error("funding_opportunity_access_failed", {
      opportunityId: parsedParams.data.opportunityId,
      message: access.error.message,
    });
    return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
  }
  if (!access.opportunity) {
    return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
  }
  if (!access.membership || !access.allowed) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const opportunity = access.opportunity;

  // Scoped to the parent opportunity, so an export id from another opportunity
  // cannot be dereferenced through one this caller can read.
  const { data: exportData, error: exportError } = await supabase
    .from("funding_opportunity_application_exports")
    .select("id, opportunity_id, storage_path, generated_at")
    .eq("id", parsedParams.data.exportId)
    .eq("opportunity_id", opportunity.id)
    .maybeSingle();

  if (exportError) {
    if (looksLikePendingAssemblySchema(exportError.message)) {
      return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
    }
    audit.error("application_export_lookup_failed", {
      exportId: parsedParams.data.exportId,
      message: exportError.message,
    });
    return NextResponse.json({ error: "Failed to load export" }, { status: 500 });
  }

  const exportRow = (exportData ?? null) as {
    id: string;
    storage_path: string | null;
    generated_at: string | null;
  } | null;
  if (!exportRow) {
    return NextResponse.json({ error: "Export not found" }, { status: 404 });
  }

  const storagePath = typeof exportRow.storage_path === "string" ? exportRow.storage_path.trim() : "";
  const ref = resolveTenantScopedStorageTarget(storagePath, {
    bucket: EXPORT_BUCKET,
    objectPathPrefix: `${opportunity.workspace_id}/${opportunity.id}/`,
    extension: ".pdf",
  });

  if (!ref) {
    audit.warn("application_export_ref_out_of_scope", {
      exportId: exportRow.id,
      opportunityId: opportunity.id,
    });
    return NextResponse.json({ error: "Export not found" }, { status: 404 });
  }

  const service = createServiceRoleClient();
  const { data, error } = await service.storage
    .from(ref.bucket)
    .createSignedUrl(ref.objectPath, SIGNED_URL_TTL_SECONDS, {
      download: downloadFilename(
        typeof opportunity.title === "string" ? opportunity.title : "",
        exportRow.generated_at
      ),
    });

  if (error || !data?.signedUrl) {
    audit.error("application_export_sign_failed", {
      exportId: exportRow.id,
      message: error?.message ?? "no signed url",
    });
    return NextResponse.json({ error: "Failed to sign export URL" }, { status: 500 });
  }

  audit.info("application_export_download_signed", {
    opportunityId: opportunity.id,
    exportId: exportRow.id,
  });
  return NextResponse.redirect(data.signedUrl);
}
