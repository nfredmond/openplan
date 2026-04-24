import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  canReviewAccessRequests,
  canTransitionAccessRequestStatus,
  getAccessRequestTransitionOptions,
  isAccessRequestTriageStatus,
  type AccessRequestStatus,
} from "@/lib/access-requests";
import { readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ACCESS_REQUEST_TRIAGE_MAX_BODY_BYTES = 4 * 1024;

const paramsSchema = z.object({
  accessRequestId: z.string().uuid(),
});

const triageSchema = z.object({
  status: z.string().refine(isAccessRequestTriageStatus, {
    message: "Unsupported access request status",
  }),
});

type RouteContext = {
  params: Promise<{ accessRequestId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("admin.access_requests.triage", request);
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    audit.warn("access_request_triage_invalid_id");
    return NextResponse.json({ error: "Invalid access request id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    audit.warn("access_request_triage_unauthenticated");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canReviewAccessRequests(user.email)) {
    audit.warn("access_request_triage_forbidden", { userId: user.id });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bodyRead = await readJsonWithLimit(request, ACCESS_REQUEST_TRIAGE_MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    audit.warn("access_request_triage_body_too_large", {
      byteLength: bodyRead.byteLength,
      maxBytes: ACCESS_REQUEST_TRIAGE_MAX_BODY_BYTES,
    });
    return bodyRead.response;
  }

  if (bodyRead.parseError) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsedBody = triageSchema.safeParse(bodyRead.data);
  if (!parsedBody.success) {
    audit.warn("access_request_triage_validation_failed", { issues: parsedBody.error.issues.length });
    return NextResponse.json({ error: "Invalid access request triage payload" }, { status: 400 });
  }

  const targetStatus = parsedBody.data.status;
  const serviceSupabase = createServiceRoleClient();

  const { data: currentRequest, error: lookupError } = await serviceSupabase
    .from("access_requests")
    .select("id, status")
    .eq("id", parsedParams.data.accessRequestId)
    .maybeSingle();

  if (lookupError) {
    audit.error("access_request_triage_lookup_failed", {
      accessRequestId: parsedParams.data.accessRequestId,
      message: lookupError.message,
      code: lookupError.code ?? null,
    });
    return NextResponse.json({ error: "Failed to load access request" }, { status: 500 });
  }

  if (!currentRequest) {
    return NextResponse.json({ error: "Access request not found" }, { status: 404 });
  }

  const currentStatus = currentRequest.status as AccessRequestStatus;
  if (!canTransitionAccessRequestStatus(currentStatus, targetStatus)) {
    audit.warn("access_request_triage_invalid_transition", {
      accessRequestId: currentRequest.id,
      currentStatus,
      targetStatus,
    });
    return NextResponse.json(
      {
        error: "Invalid access request status transition",
        currentStatus,
        allowedStatuses: getAccessRequestTransitionOptions(currentStatus),
      },
      { status: 409 },
    );
  }

  const reviewedAt = new Date().toISOString();
  const { data: updatedRequest, error: updateError } = await serviceSupabase
    .from("access_requests")
    .update({
      status: targetStatus,
      reviewed_by_user_id: user.id,
      reviewed_at: reviewedAt,
    })
    .eq("id", currentRequest.id)
    .select("id, status, reviewed_at")
    .single();

  if (updateError || !updatedRequest) {
    audit.error("access_request_triage_update_failed", {
      accessRequestId: currentRequest.id,
      message: updateError?.message ?? null,
      code: updateError?.code ?? null,
    });
    return NextResponse.json({ error: "Failed to update access request status" }, { status: 500 });
  }

  audit.info("access_request_triaged", {
    accessRequestId: updatedRequest.id,
    previousStatus: currentStatus,
    status: updatedRequest.status,
    reviewedByUserId: user.id,
  });

  return NextResponse.json({
    success: true,
    request: {
      id: updatedRequest.id,
      status: updatedRequest.status,
      reviewedAt: updatedRequest.reviewed_at,
    },
  });
}
