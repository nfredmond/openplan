import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ACCESS_REQUEST_RECENT_LOOKBACK_MINUTES,
  buildAccessRequestSupportMetadata,
  evaluateAccessRequestSafety,
  loadRecentAccessRequestsForSafety,
  normalizeAccessRequestEmail,
  type AccessRequestSafetyClient,
} from "@/lib/access-requests";
import { readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ACCESS_REQUEST_MAX_BODY_BYTES = 16 * 1024;
const DUPLICATE_KEY_CODE = "23505";

const accessRequestSchema = z.object({
  agencyName: z.string().trim().min(2).max(140),
  contactName: z.string().trim().min(2).max(140),
  contactEmail: z.string().trim().email().max(220),
  roleTitle: z.string().trim().max(140).optional(),
  region: z.string().trim().max(180).optional(),
  useCase: z.string().trim().min(10).max(2400),
  expectedWorkspaceName: z.string().trim().max(140).optional(),
  sourcePath: z.string().trim().max(220).optional(),
  // Honeypot field: real users never see it.
  website: z.string().trim().max(500).optional(),
});

function cleanOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isDuplicateOpenRequestError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  if (error.code === DUPLICATE_KEY_CODE) return true;
  return /duplicate key/i.test(error.message ?? "") && /access_requests_one_open_per_email/i.test(error.message ?? "");
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("request_access.create", request);

  const bodyRead = await readJsonWithLimit(request, ACCESS_REQUEST_MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    audit.warn("request_access_body_too_large", {
      byteLength: bodyRead.byteLength,
      maxBytes: ACCESS_REQUEST_MAX_BODY_BYTES,
    });
    return bodyRead.response;
  }

  if (bodyRead.parseError) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = accessRequestSchema.safeParse(bodyRead.data);
  if (!parsed.success) {
    audit.warn("request_access_validation_failed", { issues: parsed.error.issues.length });
    return NextResponse.json({ error: "Invalid access request", details: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.website) {
    audit.info("request_access_honeypot_discarded");
    return NextResponse.json(
      {
        success: true,
        message: "Request received. The OpenPlan team will review it before any workspace is provisioned.",
      },
      { status: 201 },
    );
  }

  const serviceSupabase = createServiceRoleClient();
  const emailNormalized = normalizeAccessRequestEmail(parsed.data.contactEmail);
  const lookbackStart = new Date(Date.now() - ACCESS_REQUEST_RECENT_LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const recentActivity = await loadRecentAccessRequestsForSafety(
    serviceSupabase as unknown as AccessRequestSafetyClient,
    lookbackStart,
  );

  if (recentActivity.error) {
    audit.error("request_access_recent_lookup_failed", {
      message: recentActivity.error.message ?? null,
      code: recentActivity.error.code ?? null,
    });
    return NextResponse.json({ error: "Failed to verify recent access request activity" }, { status: 500 });
  }

  const safety = evaluateAccessRequestSafety({
    request,
    accessRequest: parsed.data,
    recentRequests: recentActivity.requests,
  });

  if (safety.isRateLimited) {
    audit.warn("request_access_rate_limited", {
      recentFromClientCount: safety.recentFromClientCount,
    });
    return NextResponse.json(
      { error: "Too many recent access requests from this connection. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  if (safety.isDuplicate) {
    audit.info("request_access_duplicate_recent_content", {
      duplicateRequestId: safety.duplicateRecentRequestId,
      emailDomain: emailNormalized.split("@")[1] ?? null,
    });
    return NextResponse.json(
      {
        success: true,
        duplicate: true,
        message: "Request already received. The OpenPlan team will review it before any workspace is provisioned.",
      },
      { status: 200 },
    );
  }

  const { data, error } = await serviceSupabase
    .from("access_requests")
    .insert({
      agency_name: parsed.data.agencyName.trim(),
      contact_name: parsed.data.contactName.trim(),
      contact_email: parsed.data.contactEmail.trim(),
      email_normalized: emailNormalized,
      role_title: cleanOptional(parsed.data.roleTitle),
      region: cleanOptional(parsed.data.region),
      use_case: parsed.data.useCase.trim(),
      expected_workspace_name: cleanOptional(parsed.data.expectedWorkspaceName),
      source_path: cleanOptional(parsed.data.sourcePath) ?? request.nextUrl.pathname,
      metadata_json: buildAccessRequestSupportMetadata(request, parsed.data),
    })
    .select("id, status, created_at")
    .single();

  if (isDuplicateOpenRequestError(error)) {
    audit.info("request_access_duplicate_open_request", { emailDomain: emailNormalized.split("@")[1] ?? null });
    return NextResponse.json(
      {
        success: true,
        duplicate: true,
        message: "Request already received. The OpenPlan team will review it before any workspace is provisioned.",
      },
      { status: 200 },
    );
  }

  if (error || !data) {
    audit.error("request_access_insert_failed", {
      message: error?.message ?? null,
      code: error?.code ?? null,
    });
    return NextResponse.json({ error: "Failed to submit access request" }, { status: 500 });
  }

  audit.info("request_access_submitted", {
    requestId: data.id,
    status: data.status,
    emailDomain: emailNormalized.split("@")[1] ?? null,
  });

  return NextResponse.json(
    {
      success: true,
      requestId: data.id,
      status: data.status,
      message: "Request received. The OpenPlan team will review it before any workspace is provisioned.",
    },
    { status: 201 },
  );
}
