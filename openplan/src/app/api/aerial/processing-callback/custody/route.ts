import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { isAuthenticatedAerialProcessingCallback } from "@/lib/api/aerial-processing-auth";
import { processingCallbackSchema } from "@/lib/aerial/processing-contract";
import { assignArtifactOrdinals } from "@/lib/aerial/artifact-custody";
import { runAerialCustodyPass } from "@/lib/aerial/artifact-custody-server";

export const runtime = "nodejs";

/**
 * FINISH TAKING CUSTODY of a processing job's artifacts.
 *
 * WHY THIS EXISTS. Custody runs inside the processing callback, under a
 * wall-clock budget, because that is the only moment the worker's signed URLs
 * are known-good. A budget means some artifacts are left `pending`, a network
 * blip leaves others `failed`, and a raised size ceiling makes a `refused` one
 * newly takeable. Without this route every one of those is a dead end, and the
 * deliverable quietly expires — which is precisely the defect custody was built
 * to end. Deferral has to have a door.
 *
 * WHERE THE URL COMES FROM. `aerial_artifact_custody` deliberately stores the
 * source HOST and expiry, never the signed URL, because workspace members read
 * that table. The URLs survive only in `aerial_processing_callbacks.payload`,
 * the verbatim vendor delivery, which migration 20260730000004 makes
 * service-role-only. This route reads it with the service role AFTER
 * authorizing the caller, and the URL never leaves the custody engine.
 *
 * WHO MAY CALL IT. Either the deployment operator (the same bearer token the
 * worker's callbacks carry — so this is a valid cron/sweep target) or a signed-in
 * workspace member with write access to the job's workspace. A viewer cannot:
 * taking custody writes storage objects and rows. The member path's in-product
 * caller is `AerialCustodyRetry` on the mission page, offered whenever the
 * custody posture says something is still saveable.
 */

const bodySchema = z.object({
  processingJobId: z.string().uuid(),
});

type ProcessingJobRow = {
  id: string;
  workspace_id: string;
  mission_id: string;
  status: string;
};

type CustodyRow = {
  kind: string;
  ordinal: number;
  state: string;
};

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("aerial-processing.custody-retry", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = bodySchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid custody retry payload", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const processingJobId = parsed.data.processingJobId;
    const operatorAuthenticated = isAuthenticatedAerialProcessingCallback(request);

    // AUTHENTICATE BEFORE DISCLOSING EXISTENCE. The job lookup below runs with
    // the service role, which RLS does not apply to, so answering 404 for an
    // unknown id and 401 for a known one would let an unauthenticated caller use
    // this endpoint to confirm that a given processing-job id exists in someone
    // else's workspace. Identity is established first; only then does the answer
    // depend on the row.
    let memberClient: Awaited<ReturnType<typeof createClient>> | null = null;
    let userId: string | null = null;

    if (!operatorAuthenticated) {
      memberClient = await createClient();
      const {
        data: { user },
      } = await memberClient.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = user.id;
    }

    const service = createServiceRoleClient();

    const { data: jobData, error: jobError } = await service
      .from("aerial_processing_jobs")
      .select("id, workspace_id, mission_id, status")
      .eq("id", processingJobId)
      .maybeSingle();

    if (jobError) {
      audit.error("processing_job_lookup_failed", {
        processingJobId,
        message: jobError.message,
        code: jobError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load processing job" }, { status: 500 });
    }
    if (!jobData) {
      return NextResponse.json({ error: "unknown_processing_job" }, { status: 404 });
    }

    const job = jobData as ProcessingJobRow;

    if (memberClient && userId) {
      // Member path. Authorization is an explicit membership + role check
      // against the job's own workspace, the same posture as the dispatch route.
      const supabase = memberClient;
      const user = { id: userId };

      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", job.workspace_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError) {
        audit.error("membership_check_failed", {
          workspaceId: job.workspace_id,
          message: membershipError.message,
        });
        return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
      }
      if (!membership) {
        return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
      }
      if (isReadOnlyWorkspaceRole((membership as { role?: string }).role)) {
        return NextResponse.json(
          { error: "Viewers have read-only access to this workspace" },
          { status: 403 }
        );
      }
    }

    // What is still outstanding. Rows already `held` are skipped entirely — that
    // is what keeps a retry from storing a second copy or re-spending the
    // bandwidth of an artifact already safe.
    const { data: custodyData, error: custodyError } = await service
      .from("aerial_artifact_custody")
      .select("kind, ordinal, state")
      .eq("processing_job_id", job.id);

    if (custodyError) {
      audit.error("custody_rows_lookup_failed", {
        processingJobId: job.id,
        message: custodyError.message,
        code: custodyError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load artifact custody" }, { status: 500 });
    }

    const custodyRows = (custodyData ?? []) as CustodyRow[];
    const outstanding = new Set(
      custodyRows.filter((row) => row.state !== "held").map((row) => `${row.kind}:${row.ordinal}`)
    );

    if (custodyRows.length > 0 && outstanding.size === 0) {
      audit.info("custody_already_complete", { processingJobId: job.id });
      return NextResponse.json(
        { ok: true, custodyState: "complete", retriedCount: 0, heldCount: custodyRows.length },
        { status: 200 }
      );
    }

    // The signed URLs live only here, in the verbatim vendor delivery.
    const { data: ledgerData, error: ledgerError } = await service
      .from("aerial_processing_callbacks")
      .select("payload, occurred_at")
      .eq("processing_job_id", job.id)
      .eq("status", "succeeded")
      .order("occurred_at", { ascending: false })
      .limit(1);

    if (ledgerError) {
      audit.error("callback_ledger_lookup_failed", {
        processingJobId: job.id,
        message: ledgerError.message,
        code: ledgerError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load processing callback" }, { status: 500 });
    }

    const ledgerRow = (ledgerData ?? [])[0] as { payload?: unknown } | undefined;
    const parsedCallback = ledgerRow
      ? processingCallbackSchema.safeParse(ledgerRow.payload)
      : null;

    if (!parsedCallback?.success || !parsedCallback.data.artifacts?.length) {
      // A missing source is NOT "nothing to do". Say which it is.
      audit.warn("custody_source_unavailable", {
        processingJobId: job.id,
        hasLedgerRow: Boolean(ledgerRow),
      });
      return NextResponse.json(
        {
          error: "custody_source_unavailable",
          detail:
            "No succeeded processing callback is on record for this job, so OpenPlan has no download source to retry. The flight has to be re-processed to produce fresh artifact links.",
        },
        { status: 409 }
      );
    }

    const candidates = assignArtifactOrdinals(parsedCallback.data.artifacts)
      .map(({ artifact, ordinal }) => ({
        kind: artifact.kind,
        ordinal,
        downloadUrl: artifact.downloadUrl,
        expiresAt: artifact.expiresAt,
        sizeBytes: artifact.sizeBytes ?? null,
        contentType: artifact.contentType ?? null,
      }))
      // On the first ever retry there may be no custody rows at all (the
      // callback pass could not write them); then every artifact is a candidate.
      .filter((candidate) =>
        custodyRows.length === 0 ? true : outstanding.has(`${candidate.kind}:${candidate.ordinal}`)
      );

    const result = await runAerialCustodyPass({
      supabase: service,
      job: {
        processingJobId: job.id,
        workspaceId: job.workspace_id,
        missionId: job.mission_id,
      },
      candidates,
      elapsedMs: Date.now() - startedAt,
    });

    // Keep the evidence package's claim in step with what is actually held. A
    // package that said "pending" because nothing was in custody must be able to
    // stop saying it once the bytes arrive — otherwise the retry succeeds and no
    // planner-visible surface changes.
    const { error: packageUpdateError } = await service
      .from("aerial_evidence_packages")
      .update({ verification_readiness: result.posture.verificationReadiness })
      .eq("processing_job_id", job.id);

    if (packageUpdateError) {
      audit.warn("evidence_package_readiness_update_failed", {
        processingJobId: job.id,
        message: packageUpdateError.message,
      });
    }

    audit.info("aerial_artifact_custody_retry", {
      processingJobId: job.id,
      workspaceId: job.workspace_id,
      operatorAuthenticated,
      retriedCount: candidates.length,
      custodyState: result.posture.state,
      heldCount: result.posture.heldCount,
      unrecoverableCount: result.posture.unrecoverableCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        ok: true,
        custodyState: result.posture.state,
        retriedCount: candidates.length,
        heldCount: result.posture.heldCount,
        pendingCount: result.posture.pendingCount,
        failedCount: result.posture.failedCount,
        refusedCount: result.posture.refusedCount,
        unrecoverableCount: result.posture.unrecoverableCount,
        label: result.posture.label,
        detail: result.posture.detail,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("aerial_custody_retry_unhandled_error", {
      error,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Unexpected error while retrying artifact custody" },
      { status: 500 }
    );
  }
}
