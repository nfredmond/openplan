import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { applyBillingSubscriptionMutation } from "@/lib/billing/subscriptions";
import { createWorkspaceInvitation } from "@/lib/workspaces/invitations";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { resolveStageGateTemplateBinding } from "@/lib/stage-gates/template-loader";

export const runtime = "nodejs";

const provisioningSchema = z
  .object({
    workspaceName: z.string().trim().min(1).max(120),
    slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
    plan: z.enum(["pilot", "starter", "professional", "enterprise"]).optional().default("pilot"),
    subscriptionStatus: z
      .enum(["pilot", "inactive", "checkout_pending", "active", "trialing", "past_due"])
      .optional()
      .default("pilot"),
    ownerUserId: z.string().uuid().optional(),
    ownerEmail: z.string().trim().email().optional(),
    stripeCustomerId: z.string().trim().min(1).max(120).optional(),
    stripeSubscriptionId: z.string().trim().min(1).max(120).optional(),
    stageGateTemplateId: z.string().trim().min(1).max(80).optional(),
  })
  .refine((value) => Boolean(value.ownerUserId || value.ownerEmail), {
    message: "ownerUserId or ownerEmail is required",
    path: ["ownerUserId"],
  });

type ProvisionedWorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  stage_gate_template_id: string;
  stage_gate_template_version: string;
};

const DUPLICATE_KEY_CODE = "23505";

function configuredProvisioningSecret(): string | null {
  return process.env.OPENPLAN_WORKSPACE_PROVISIONING_SECRET?.trim() || null;
}

function requestSecret(request: NextRequest): string | null {
  const explicit = request.headers.get("x-openplan-workspace-provisioning-secret")?.trim();
  if (explicit) {
    return explicit;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return null;
}

function isAuthorized(request: NextRequest): boolean | "missing_config" {
  const expected = configuredProvisioningSecret();
  if (!expected) {
    return "missing_config";
  }

  const supplied = requestSecret(request);
  if (!supplied) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

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
  audit: ReturnType<typeof createApiAuditLogger>
) {
  const { error: memberCleanupError } = await serviceSupabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId);

  if (memberCleanupError) {
    audit.warn("workspace_provision_cleanup_members_failed", {
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
    audit.warn("workspace_provision_cleanup_invitations_failed", {
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
    audit.warn("workspace_provision_cleanup_workspace_failed", {
      workspaceId,
      message: workspaceCleanupError.message,
      code: workspaceCleanupError.code ?? null,
    });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("admin.workspaces.provision", request);
  const startedAt = Date.now();
  const authorized = isAuthorized(request);

  if (authorized === "missing_config") {
    audit.warn("workspace_provisioning_secret_missing");
    return NextResponse.json({ error: "Workspace provisioning is not configured" }, { status: 503 });
  }

  if (!authorized) {
    audit.warn("workspace_provisioning_unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = provisioningSchema.safeParse(payload);
  if (!parsed.success) {
    audit.warn("workspace_provisioning_validation_failed", { issues: parsed.error.issues.length });
    return NextResponse.json({ error: "Invalid workspace provisioning payload" }, { status: 400 });
  }

  const input = parsed.data;
  let stageGateBinding: ReturnType<typeof resolveStageGateTemplateBinding>;
  try {
    stageGateBinding = resolveStageGateTemplateBinding(input.stageGateTemplateId);
  } catch {
    audit.warn("unsupported_stage_gate_template", {
      requestedTemplateId: input.stageGateTemplateId ?? null,
    });
    return NextResponse.json({ error: "Unsupported stage-gate template" }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleClient();
  const baseSlug = input.slug ?? normalizeSlug(input.workspaceName);
  let workspace: ProvisionedWorkspaceRow | null = null;

  for (let attempt = 0; attempt <= 3; attempt += 1) {
    const slug = slugWithSuffix(baseSlug, attempt);
    const { data, error } = await serviceSupabase
      .from("workspaces")
      .insert({
        name: input.workspaceName.trim(),
        slug,
        plan: input.plan,
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
      audit.warn("workspace_slug_conflict", { baseSlug, retryAttempt: attempt + 1 });
      continue;
    }

    audit.error("workspace_insert_failed", {
      message: error?.message ?? "unknown",
      code: error?.code ?? null,
    });
    return NextResponse.json({ error: "Failed to provision workspace" }, { status: 500 });
  }

  if (!workspace) {
    audit.error("workspace_insert_exhausted", { baseSlug });
    return NextResponse.json({ error: "Failed to provision workspace" }, { status: 500 });
  }

  try {
    if (input.ownerUserId) {
      const { error: memberError } = await serviceSupabase
        .from("workspace_members")
        .insert({ workspace_id: workspace.id, user_id: input.ownerUserId, role: "owner" });

      if (memberError) {
        throw new Error(memberError.message);
      }
    }

    const billingResult = await applyBillingSubscriptionMutation(serviceSupabase, {
      workspaceId: workspace.id,
      subscriptionPlan: input.plan,
      subscriptionStatus: input.subscriptionStatus,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      metadata: { source: "workspace_provisioning" },
    });

    if (billingResult.error || billingResult.ledgerMissing) {
      throw new Error(
        billingResult.error?.message ??
          "Billing ledger schema is unavailable for workspace provisioning"
      );
    }

    const ownerInvitation =
      input.ownerEmail && !input.ownerUserId
        ? await createWorkspaceInvitation({
            supabase: serviceSupabase,
            workspaceId: workspace.id,
            email: input.ownerEmail,
            role: "owner",
            invitedByUserId: null,
            origin: request.nextUrl.origin,
          })
        : null;

    audit.info("workspace_provisioned", {
      workspaceId: workspace.id,
      slug: workspace.slug,
      ownerMembershipCreated: Boolean(input.ownerUserId),
      ownerInvitationCreated: Boolean(ownerInvitation),
      subscriptionStatus: input.subscriptionStatus,
      subscriptionPlan: input.plan,
      stripeCustomerAttached: Boolean(input.stripeCustomerId),
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        workspaceId: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        plan: input.plan,
        subscriptionStatus: input.subscriptionStatus,
        ownerMembershipCreated: Boolean(input.ownerUserId),
        ownerInvitation: ownerInvitation
          ? {
              id: ownerInvitation.invitation.id,
              email: ownerInvitation.invitation.email,
              role: ownerInvitation.invitation.role,
              expiresAt: ownerInvitation.invitation.expires_at,
              invitationUrl: ownerInvitation.invitationUrl,
              delivery: "manual",
            }
          : null,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("workspace_provisioning_failed_after_workspace_insert", {
      workspaceId: workspace.id,
      message: error instanceof Error ? error.message : "unknown",
    });

    await cleanupProvisionedWorkspace(serviceSupabase, workspace.id, audit);
    return NextResponse.json({ error: "Failed to provision workspace" }, { status: 500 });
  }
}
