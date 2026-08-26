import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { AERIAL_ARTIFACT_BUCKET } from "@/lib/aerial/artifact-custody";
import { resolveTenantScopedStorageTarget } from "@/lib/files/tenant-scoped-storage";

/**
 * Download an aerial artifact OpenPlan holds in its own custody.
 *
 * WHY THIS DID NOT EXIST. The custody engine has fetched artifact bytes into
 * the private `aerial-artifacts` bucket since 2026-07-30, sha256-verified, with
 * a ledger row per artifact — and NO route could mint a download URL for any of
 * them. `redactArtifactDescriptors` strips the worker's signed URLs from the
 * job row (correctly: they are bearer credentials), so once custody ran, the
 * deliverable existed in OpenPlan's storage and was unreachable by anyone.
 * Custody was write-only: the exact defect it was built to end, one level up.
 *
 * Mirrors `/api/reports/[reportId]/artifacts/[artifactId]/download` segment for
 * segment: authorize the PARENT resources (job -> workspace membership), verify
 * the custody row belongs to that job and its object path to that job's own
 * prefix, mint a short-lived signed URL, redirect.
 *
 * ONLY `held` ROWS ARE DOWNLOADABLE. A pending/failed/refused row has no bytes
 * behind it, and the honest answer is the row's own recorded failure sentence
 * (assembled by `describeAerialCustodyFailure` from a closed vocabulary), never
 * a raw storage error and never a 404 that reads as "no such artifact".
 */

// Matches the report-artifact and model-run-artifact routes: a short-lived link
// minted per request for an already-authorized reader, never a stored URL.
const AERIAL_ARTIFACT_SIGNED_URL_TTL_SECONDS = 15 * 60;

const paramsSchema = z.object({
  jobId: z.string().uuid(),
  custodyId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ jobId: string; custodyId: string }>;
};

type ProcessingJobRow = {
  id: string;
  workspace_id: string;
  mission_id: string;
};

type CustodyRow = {
  id: string;
  workspace_id: string;
  mission_id: string;
  processing_job_id: string;
  kind: string;
  ordinal: number;
  state: string;
  storage_bucket: string | null;
  storage_path: string | null;
  byte_size: number | null;
  checksum_sha256: string | null;
  content_type: string | null;
  source_expires_at: string;
  failure_code: string | null;
  failure_detail: string | null;
};

/**
 * What a non-held row's refusal says. The stored `failure_detail` is preferred —
 * it is the sentence the custody engine recorded from its closed vocabulary at
 * the moment the attempt failed, so it names the actual cause. A `pending` row
 * has no failure to cite, so it gets the honest in-progress sentence instead.
 */
function notHeldDetail(row: CustodyRow): string {
  if (row.failure_detail) return row.failure_detail;
  if (row.state === "pending") {
    return "This artifact has not been taken into OpenPlan's custody yet. If the processing worker's link is still valid, the custody retry on the mission page can finish the job; there are no stored bytes to download until it does.";
  }
  return "This artifact is not in OpenPlan's custody and no failure reason was recorded, so there are no stored bytes to download.";
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("aerial-processing.artifact-download", request);

  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid artifact download params" }, { status: 400 });
  }
  const { jobId, custodyId } = parsedParams.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceRoleClient();

  const { data: jobData, error: jobError } = await service
    .from("aerial_processing_jobs")
    .select("id, workspace_id, mission_id")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    audit.error("processing_job_lookup_failed", { jobId, message: jobError.message });
    return NextResponse.json({ error: "Failed to load processing job" }, { status: 500 });
  }
  if (!jobData) {
    return NextResponse.json({ error: "Processing job not found" }, { status: 404 });
  }
  const job = jobData as ProcessingJobRow;

  // Explicit membership check against the job's own workspace — the same
  // posture as the sibling aerial routes. Any role may download: this is a
  // read of workspace content, so viewers are included.
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

  // Scoped to the parent job, so a custody id from another job cannot be
  // dereferenced through a job this caller happens to be able to read.
  const { data: custodyData, error: custodyError } = await service
    .from("aerial_artifact_custody")
    .select(
      "id, workspace_id, mission_id, processing_job_id, kind, ordinal, state, storage_bucket, storage_path, byte_size, checksum_sha256, content_type, source_expires_at, failure_code, failure_detail"
    )
    .eq("id", custodyId)
    .eq("processing_job_id", job.id)
    .maybeSingle();

  if (custodyError) {
    audit.error("custody_row_lookup_failed", { custodyId, message: custodyError.message });
    return NextResponse.json({ error: "Failed to load artifact custody" }, { status: 500 });
  }
  const custody = (custodyData ?? null) as CustodyRow | null;
  if (!custody) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  // Belt and braces: the custody row's own workspace must be the job's. The
  // engine writes them together, so a mismatch is a forged or corrupted row —
  // refuse as not-found rather than dereference across the boundary.
  if (custody.workspace_id !== job.workspace_id) {
    audit.warn("custody_row_workspace_mismatch", {
      custodyId: custody.id,
      jobId: job.id,
    });
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  if (custody.state !== "held") {
    // Answer with the row's OWN recorded vocabulary — the closed-vocabulary
    // sentence custody wrote down — never a raw storage error, and never a 404
    // pretending the record does not exist.
    audit.info("custody_artifact_not_held", {
      custodyId: custody.id,
      jobId: job.id,
      state: custody.state,
      failureCode: custody.failure_code,
    });
    return NextResponse.json(
      {
        error: "artifact_not_held",
        state: custody.state,
        failureCode: custody.failure_code,
        detail: notHeldDetail(custody),
      },
      { status: 409 }
    );
  }

  const storagePath = typeof custody.storage_path === "string" ? custody.storage_path : "";
  const expectedPrefix = `${job.workspace_id}/${job.mission_id}/${job.id}/`;
  const ref = resolveTenantScopedStorageTarget(storagePath, {
    bucket: AERIAL_ARTIFACT_BUCKET,
    objectPathPrefix: expectedPrefix,
  });

  // The engine derives every path from ids OpenPlan owns, so a held row whose
  // object lives outside this job's own prefix — or in another bucket — is not
  // something this route will sign for.
  if (
    !ref || custody.storage_bucket !== ref.bucket
  ) {
    audit.warn("custody_storage_ref_out_of_scope", {
      custodyId: custody.id,
      jobId: job.id,
      bucket: custody.storage_bucket,
    });
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  // The stored object's own basename — `<kind>[-<ordinal>].<ext>`, built by the
  // engine from a sanitized extension — is already a filename a planner can
  // recognise in a downloads folder.
  const filename = storagePath.split("/").pop() || `${custody.kind}.bin`;

  const { data: signed, error: signError } = await service.storage
    .from(ref.bucket)
    .createSignedUrl(ref.objectPath, AERIAL_ARTIFACT_SIGNED_URL_TTL_SECONDS, {
      download: filename,
    });

  if (signError || !signed?.signedUrl) {
    audit.error("custody_artifact_sign_failed", {
      custodyId: custody.id,
      jobId: job.id,
      message: signError?.message ?? "no signed url",
    });
    return NextResponse.json({ error: "Failed to sign artifact URL" }, { status: 500 });
  }

  // The signed URL itself is never logged — it is a bearer credential for the
  // agency's own imagery, exactly like the worker URLs custody exists to retire.
  audit.info("custody_artifact_download_signed", {
    custodyId: custody.id,
    jobId: job.id,
    workspaceId: job.workspace_id,
    kind: custody.kind,
    byteSize: custody.byte_size,
  });
  return NextResponse.redirect(signed.signedUrl);
}
