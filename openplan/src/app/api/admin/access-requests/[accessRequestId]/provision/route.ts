import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ACCESS_REQUEST_PROVISIONING_SIDE_EFFECTS,
  canProvisionAccessRequestStatus,
  canReviewAccessRequests,
  type AccessRequestStatus,
} from "@/lib/access-requests";
import { applyBillingSubscriptionMutation } from "@/lib/billing/subscriptions";
import { readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { resolveStageGateTemplateBinding } from "@/lib/stage-gates/template-loader";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createWorkspaceInvitation } from "@/lib/workspaces/invitations";

export const runtime = "nodejs";

const ACCESS_REQUEST_PROVISION_MAX_BODY_BYTES = 4 * 1024;
const DUPLICATE_KEY_CODE = "23505";
const PROVISIONED_PLAN = "pilot";
const PROVISIONED_SUBSCRIPTION_STATUS = "pilot";

const paramsSchema = z.object({
  accessRequestId: z.string().uuid(),
});

const provisionSchema = z
  .object({
    workspaceName: z.string().trim().min(1).max(120).optional(),
    slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
    stageGateTemplateId: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

type RouteContext = {
  params: Promise<{ accessRequestId: string }>;
};

type CurrentAccessRequestRow = {
  id: string;
  status: AccessRequestStatus;
  provisioned_workspace_id: string | null;
  agency_name: string;
  contact_email: string;
  expected_workspace_name: string | null;
};

type ProvisionedWorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  stage_gate_template_id: string;
  stage_gate_template_version: string;
};

type AccessRequestProvisioningRpcRow = {
  id: string;
  status: AccessRequestStatus;
  reviewed_at: string;
  review_event_id: string;
  provisioned_workspace_id: string;
};

type AccessRequestProvisioningRpcClient = {
  rpc: (
    functionName: "record_access_request_provisioning",
    args: {
      p_access_request_id: string;
      p_previous_status: AccessRequestStatus;
      p_workspace_id: string;
      p_owner_invitation_id: string;
      p_reviewer_user_id: string;
    },
  ) => {
    single: () => Promise<{
      data: AccessRequestProvisioningRpcRow | null;
      error: { message?: string; code?: string | null } | null;
    }>;
  };
};

function normalizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || "workspace";
}

function slugWithSuffix(baseSlug: string, attempt: number): string {
  if (attempt === 0) {
    return baseSlug;
  }

  const suffix = randomUUID().replace(/-/g, "").slice(0, 4);
  const maxBaseLength = 48 - 1 - suffix.length;
  const trimmedBase = baseSlug.slice(0, Math.max(1, maxBaseLength));
  return `${trimmedBase}-${suffix}`;
}

function isDuplicateSlugError(error: { code?: string | null; message?: string } | null): boolean {
  if (!error) {
    return false;
  }

  if (error.code === DUPLICATE_KEY_CODE) {
    return true;
  }

  return /duplicate key/i.test(error.message ?? "") && /slug/i.test(error.message ?? "");
}

async function cleanupProvisionedWorkspace(
  serviceSupabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  audit: ReturnType<typeof createApiAuditLogger>,
) {
  const { error: memberCleanupError } = await serviceSupabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId);

  if (memberCleanupError) {
    audit.warn("access_request_provision_cleanup_members_failed", {
      workspaceId,
      message: memberCleanupError.message,
      code: memberCleanupError.code ?? null,
    });
  }

  const { error: invitationCleanupError } = await serviceSupabase
    .from("workspace_invitations")
    .delete()
    .eq("workspace_id", workspaceId);

  if (invitationCleanupError) {
    audit.warn("access_request_provision_cleanup_invitations_failed", {
      workspaceId,
      message: invitationCleanupError.message,
      code: invitationCleanupError.code ?? null,
    });
  }

  const { error: workspaceCleanupError } = await serviceSupabase
    .from("workspaces")
    .delete()
    .eq("id", workspaceId);

  if (workspaceCleanupError) {
    audit.warn("access_request_provision_cleanup_workspace_failed", {
      workspaceId,
      message: workspaceCleanupError.message,
      code: workspaceCleanupError.code ?? null,
    });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("admin.access_requests.provision", request);
  const startedAt = Date.now();
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    audit.warn("access_request_provision_invalid_id");
    return NextResponse.json({ error: "Invalid access request id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    audit.warn("access_request_provision_unauthenticated");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canReviewAccessRequests(user.email)) {
    audit.warn("access_request_provision_forbidden", { userId: user.id });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bodyRead = await readJsonWithLimit(request, ACCESS_REQUEST_PROVISION_MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    audit.warn("access_request_provision_body_too_large", {
      byteLength: bodyRead.byteLength,
      maxBytes: ACCESS_REQUEST_PROVISION_MAX_BODY_BYTES,
    });
    return bodyRead.response;
  }

  if (bodyRead.parseError) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsedBody = provisionSchema.safeParse(bodyRead.data ?? {});
  if (!parsedBody.success) {
    audit.warn("access_request_provision_validation_failed", { issues: parsedBody.error.issues.length });
    return NextResponse.json({ error: "Invalid access request provisioning payload" }, { status: 400 });
  }

  let stageGateBinding: ReturnType<typeof resolveStageGateTemplateBinding>;
  try {
    stageGateBinding = resolveStageGateTemplateBinding(parsedBody.data.stageGateTemplateId);
  } catch {
    audit.warn("access_request_provision_unsupported_stage_gate_template", {
      requestedTemplateId: parsedBody.data.stageGateTemplateId ?? null,
    });
    return NextResponse.json({ error: "Unsupported stage-gate template" }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleClient();
  const { data: currentRequest, error: lookupError } = await serviceSupabase
    .from("access_requests")
    .select("id, status, provisioned_workspace_id, agency_name, contact_email, expected_workspace_name")
    .eq("id", parsedParams.data.accessRequestId)
    .maybeSingle();

  if (lookupError) {
    audit.error("access_request_provision_lookup_failed", {
      accessRequestId: parsedParams.data.accessRequestId,
      message: lookupError.message,
      code: lookupError.code ?? null,
    });
    return NextResponse.json({ error: "Failed to load access request" }, { status: 500 });
  }

  if (!currentRequest) {
    return NextResponse.json({ error: "Access request not found" }, { status: 404 });
  }

  const accessRequest = currentRequest as CurrentAccessRequestRow;
  if (accessRequest.provisioned_workspace_id) {
    audit.warn("access_request_provision_already_linked", {
      accessRequestId: accessRequest.id,
      provisionedWorkspaceId: accessRequest.provisioned_workspace_id,
    });
    return NextResponse.json(
      {
        error: "Access request is already linked to a provisioned workspace",
        provisionedWorkspaceId: accessRequest.provisioned_workspace_id,
      },
      { status: 409 },
    );
  }

  const currentStatus = accessRequest.status;
  if (!canProvisionAccessRequestStatus(currentStatus)) {
    audit.warn("access_request_provision_invalid_status", {
      accessRequestId: accessRequest.id,
      currentStatus,
    });
    return NextResponse.json(
      {
        error: "Access request is not ready for workspace provisioning",
        currentStatus,
        allowedStatuses: ["contacted", "invited"],
      },
      { status: 409 },
    );
  }

  const workspaceName = (
    parsedBody.data.workspaceName ??
    accessRequest.expected_workspace_name ??
    accessRequest.agency_name
  ).trim();
  const baseSlug = parsedBody.data.slug ?? normalizeSlug(workspaceName);
  let workspace: ProvisionedWorkspaceRow | null = null;

  for (let attempt = 0; attempt <= 3; attempt += 1) {
    const slug = slugWithSuffix(baseSlug, attempt);
    const { data, error } = await serviceSupabase
      .from("workspaces")
      .insert({
        name: workspaceName,
        slug,
        plan: PROVISIONED_PLAN,
        stage_gate_template_id: stageGateBinding.templateId,
        stage_gate_template_version: stageGateBinding.templateVersion,
        stage_gate_binding_source: stageGateBinding.bindingMode,
      })
      .select("id, slug, name, plan, stage_gate_template_id, stage_gate_template_version")
      .single();

    if (!error && data) {
      workspace = data as ProvisionedWorkspaceRow;
      break;
    }

    if (isDuplicateSlugError(error) && attempt < 3) {
      audit.warn("access_request_provision_slug_conflict", {
        accessRequestId: accessRequest.id,
        baseSlug,
        retryAttempt: attempt + 1,
      });
      continue;
    }

    audit.error("access_request_provision_workspace_insert_failed", {
      accessRequestId: accessRequest.id,
      message: error?.message ?? "unknown",
      code: error?.code ?? null,
    });
    return NextResponse.json({ error: "Failed to provision workspace" }, { status: 500 });
  }

  if (!workspace) {
    audit.error("access_request_provision_workspace_insert_exhausted", {
      accessRequestId: accessRequest.id,
      baseSlug,
    });
    return NextResponse.json({ error: "Failed to provision workspace" }, { status: 500 });
  }

  try {
    const billingResult = await applyBillingSubscriptionMutation(serviceSupabase, {
      workspaceId: workspace.id,
      subscriptionPlan: PROVISIONED_PLAN,
      subscriptionStatus: PROVISIONED_SUBSCRIPTION_STATUS,
      metadata: {
        source: "access_request_provisioning",
        accessRequestId: accessRequest.id,
      },
    });

    if (billingResult.error || billingResult.ledgerMissing) {
      throw new Error(
        billingResult.error?.message ?? "Billing ledger schema is unavailable for access request provisioning",
      );
    }

    const ownerInvitation = await createWorkspaceInvitation({
      supabase: serviceSupabase,
      workspaceId: workspace.id,
      email: accessRequest.contact_email,
      role: "owner",
      invitedByUserId: user.id,
      origin: request.nextUrl.origin,
    });

    const { data: updatedRequest, error: updateError } = await (
      serviceSupabase as unknown as AccessRequestProvisioningRpcClient
    )
      .rpc("record_access_request_provisioning", {
        p_access_request_id: accessRequest.id,
        p_previous_status: currentStatus,
        p_workspace_id: workspace.id,
        p_owner_invitation_id: ownerInvitation.invitation.id,
        p_reviewer_user_id: user.id,
      })
      .single();

    if (updateError?.code === "40001") {
      audit.warn("access_request_provision_concurrent_status_change", {
        accessRequestId: accessRequest.id,
        currentStatus,
        workspaceId: workspace.id,
      });
      await cleanupProvisionedWorkspace(serviceSupabase, workspace.id, audit);
      return NextResponse.json(
        {
          error: "Access request status changed before provisioning could be recorded",
        },
        { status: 409 },
      );
    }

    if (updateError || !updatedRequest) {
      audit.error("access_request_provision_record_failed", {
        accessRequestId: accessRequest.id,
        workspaceId: workspace.id,
        message: updateError?.message ?? null,
        code: updateError?.code ?? null,
      });
      await cleanupProvisionedWorkspace(serviceSupabase, workspace.id, audit);
      return NextResponse.json({ error: "Failed to record access request provisioning" }, { status: 500 });
    }

    audit.info("access_request_workspace_provisioned", {
      accessRequestId: updatedRequest.id,
      workspaceId: workspace.id,
      slug: workspace.slug,
      previousStatus: currentStatus,
      status: updatedRequest.status,
      reviewedByUserId: user.id,
      reviewEventId: updatedRequest.review_event_id,
      ownerInvitationId: ownerInvitation.invitation.id,
      sideEffects: ACCESS_REQUEST_PROVISIONING_SIDE_EFFECTS,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        success: true,
        sideEffects: ACCESS_REQUEST_PROVISIONING_SIDE_EFFECTS,
        request: {
          id: updatedRequest.id,
          status: updatedRequest.status,
          reviewedAt: updatedRequest.reviewed_at,
          reviewEventId: updatedRequest.review_event_id,
          provisionedWorkspaceId: updatedRequest.provisioned_workspace_id,
        },
        workspace: {
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          plan: workspace.plan,
        },
        ownerInvitation: {
          id: ownerInvitation.invitation.id,
          expiresAt: ownerInvitation.invitation.expires_at,
          invitationUrl: ownerInvitation.invitationUrl,
          delivery: "manual",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    audit.error("access_request_provision_failed_after_workspace_insert", {
      accessRequestId: accessRequest.id,
      workspaceId: workspace.id,
      message: error instanceof Error ? error.message : "unknown",
    });

    await cleanupProvisionedWorkspace(serviceSupabase, workspace.id, audit);
    return NextResponse.json({ error: "Failed to provision workspace" }, { status: 500 });
  }
}
