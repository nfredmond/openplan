import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

const PROJECT_REVISION = "2026-08-26T20:00:00Z";
let frozenProjectRevision = PROJECT_REVISION;
let frozenGeneratedAt = "2026-08-26T20:01:00Z";
let frozenCompletedAt = "2026-08-26T20:02:00Z";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function emptyTestZip(comment: string) {
  const commentBytes = Buffer.from(comment, "utf8");
  const bytes = Buffer.alloc(22 + commentBytes.length);
  bytes.writeUInt32LE(0x06054b50, 0);
  bytes.writeUInt16LE(commentBytes.length, 20);
  commentBytes.copy(bytes, 22);
  return bytes;
}

const REPORT_PDF_BYTES = Buffer.from("%PDF-1.4\n%%EOF\n", "utf8");
const REPORT_PDF_SHA256 = sha256(REPORT_PDF_BYTES);
const PRIMARY_BUNDLE_BYTES = emptyTestZip("primary");
const MALFORMED_BUNDLE_BYTES = emptyTestZip("missing-descriptor");
const NUMERIC_REVISION_BUNDLE_BYTES = emptyTestZip("numeric-revision");
const APPROVAL_STORAGE_BUNDLE_BYTES = emptyTestZip("approval-storage");
const MISSING_OBJECT_BUNDLE_BYTES = emptyTestZip("missing-object");
const STALE_BUNDLE_BYTES = emptyTestZip("stale");

function descriptor(params: { stableEvidenceId: string; revisionToken: string | null; checksumSha256: string | null }) {
  return {
    schemaVersion: "openplan.evidence_descriptor.v1",
    stableEvidenceId: params.stableEvidenceId,
    source: { kind: "openplan_record", label: "Governed test evidence", citation: null },
    asOfDate: frozenProjectRevision,
    retrievedAt: frozenGeneratedAt,
    evidenceStatus: "reference",
    claimTier: null,
    uncertainty: [],
    limits: [],
    revisionToken: params.revisionToken,
    checksumSha256: params.checksumSha256,
    support: { status: "not_a_numeric_claim", reason: null },
  };
}

function readyManifest(params: {
  bundleId: string;
  workspaceId: string;
  projectId: string;
  planId: string;
  pdfId: string;
}) {
  const planChecksum = "1".repeat(64);
  const pdfChecksum = REPORT_PDF_SHA256;
  const pdfRevision = "3".repeat(64);
  const planRevision = "6".repeat(64);
  return {
    schemaVersion: "project_evidence_manifest.v2",
    bundleId: params.bundleId,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    projectRevision: frozenProjectRevision,
    generatedAt: frozenGeneratedAt,
    generatedBy: "openplan_authenticated_planner",
    purpose: "retained_evidence_snapshot",
    approvalOrPublication: false,
    inventory: { inventoryTruncated: false },
    entries: [
      {
        path: "project/linked-plan.json",
        originalRecord: { sourceId: "linked_data", recordId: params.planId, parentRecordId: null },
        contentType: "application/json",
        retrieval: { state: "available", retrievedAt: frozenGeneratedAt },
        revisionToken: planRevision,
        checksumSha256: planChecksum,
        byteSize: 4,
        inclusion: { status: "included", reason: null },
        evidence: descriptor({
          stableEvidenceId: "4".repeat(64),
          revisionToken: planRevision,
          checksumSha256: planChecksum,
        }),
      },
      {
        path: "files/report_artifacts/board-packet.pdf",
        originalRecord: { sourceId: "report_artifacts", recordId: params.pdfId, parentRecordId: null },
        contentType: "application/pdf",
        retrieval: { state: "available", retrievedAt: frozenGeneratedAt },
        revisionToken: pdfRevision,
        checksumSha256: pdfChecksum,
        byteSize: REPORT_PDF_BYTES.length,
        inclusion: { status: "included", reason: null },
        evidence: descriptor({
          stableEvidenceId: "5".repeat(64),
          revisionToken: pdfRevision,
          checksumSha256: pdfChecksum,
        }),
      },
    ],
    selectedLinkedPlan: { id: params.planId, revisionToken: planRevision },
    currentBoardOrReportPdf: { recordId: params.pdfId, checksumSha256: pdfChecksum },
    layerStatusTable: "openplan_layer_status",
  };
}

liveDescribe("decision package exact-hash authority", () => {
  let service: SupabaseClient;
  let creator: SupabaseClient;
  let approver: SupabaseClient;
  let otherAdmin: SupabaseClient;
  let outsider: SupabaseClient;
  let workspaceA = "";
  let workspaceB = "";
  let projectA = "";
  let creatorId = "";
  let approverId = "";
  let otherAdminId = "";
  let outsiderId = "";
  let bundleId = "";
  let malformedBundleId = "";
  let numericRevisionBundleId = "";
  let missingObjectBundleId = "";
  let approvalStorageBundleId = "";
  let approvalStorageSubmissionId = "";
  let planId = "";
  let reportId = "";
  let pdfId = "";
  let submissionId = "";
  const bundleHash = sha256(PRIMARY_BUNDLE_BYTES);
  const password = "DecisionPackageRls!2026";
  const bundleObjectPaths: string[] = [];
  let reportStoragePath = "";
  let suffix = "";

  async function uploadBundleObject(id: string, bytes: Uint8Array) {
    const storagePath = `${workspaceA}/${projectA}/${id}.zip`;
    const upload = await service.storage.from("project-evidence-bundles").upload(storagePath, bytes, {
      contentType: "application/zip",
      upsert: false,
    });
    if (upload.error) throw new Error(upload.error.message);
    bundleObjectPaths.push(storagePath);
    return storagePath;
  }

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "decision-package-service");
    creator = liveClient(env.API_URL, env.ANON_KEY, "decision-package-creator");
    approver = liveClient(env.API_URL, env.ANON_KEY, "decision-package-approver");
    otherAdmin = liveClient(env.API_URL, env.ANON_KEY, "decision-package-other-admin");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "decision-package-outsider");
    suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const users = await Promise.all(["creator", "approver", "other", "outsider"].map((role) =>
      service.auth.admin.createUser({
        email: `decision-package-${role}-${suffix}@example.test`,
        password,
        email_confirm: true,
      }),
    ));
    for (const user of users) if (user.error || !user.data.user) throw new Error(user.error?.message ?? "user creation failed");
    [creatorId, approverId, otherAdminId, outsiderId] = users.map((user) => user.data.user!.id);
    workspaceA = randomUUID();
    workspaceB = randomUUID();
    projectA = randomUUID();
    bundleId = randomUUID();
    malformedBundleId = randomUUID();
    numericRevisionBundleId = randomUUID();
    missingObjectBundleId = randomUUID();
    approvalStorageBundleId = randomUUID();
    planId = randomUUID();
    reportId = randomUUID();
    pdfId = randomUUID();
    const workspaces = await service.from("workspaces").insert([
      { id: workspaceA, name: `Decision A ${suffix}`, slug: `decision-a-${suffix}` },
      { id: workspaceB, name: `Decision B ${suffix}`, slug: `decision-b-${suffix}` },
    ]);
    if (workspaces.error) throw new Error(workspaces.error.message);
    const memberships = await service.from("workspace_members").insert([
      { workspace_id: workspaceA, user_id: creatorId, role: "member" },
      { workspace_id: workspaceA, user_id: approverId, role: "owner" },
      { workspace_id: workspaceA, user_id: otherAdminId, role: "admin" },
      { workspace_id: workspaceB, user_id: outsiderId, role: "owner" },
    ]);
    if (memberships.error) throw new Error(memberships.error.message);
    const project = await service.from("projects").insert({
      id: projectA,
      workspace_id: workspaceA,
      name: "Governed project",
      created_by: creatorId,
      updated_at: PROJECT_REVISION,
    });
    if (project.error) throw new Error(project.error.message);
    const plan = await service.from("plans").insert({
      id: planId,
      workspace_id: workspaceA,
      project_id: projectA,
      title: "Governed linked plan",
      plan_type: "corridor",
      status: "active",
      created_by: creatorId,
      updated_at: PROJECT_REVISION,
    });
    if (plan.error) throw new Error(plan.error.message);
    const report = await service.from("reports").insert({
      id: reportId,
      workspace_id: workspaceA,
      project_id: projectA,
      title: "Current board packet",
      report_type: "board_packet",
      status: "generated",
      created_by: creatorId,
      updated_at: PROJECT_REVISION,
    });
    if (report.error) throw new Error(report.error.message);
    reportStoragePath = `${workspaceA}/${reportId}/${pdfId}.pdf`;
    const reportUpload = await service.storage.from("report-artifacts").upload(reportStoragePath, REPORT_PDF_BYTES, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (reportUpload.error) throw new Error(reportUpload.error.message);
    const artifact = await service.from("report_artifacts").insert({
      id: pdfId,
      report_id: reportId,
      artifact_kind: "pdf",
      storage_path: reportStoragePath,
      generated_by: creatorId,
      generated_at: PROJECT_REVISION,
      metadata_json: { checksumSha256: REPORT_PDF_SHA256 },
      updated_at: PROJECT_REVISION,
    });
    if (artifact.error) throw new Error(artifact.error.message);
    const currentProject = await service.from("projects").select("updated_at").eq("id", projectA).single();
    if (currentProject.error || !currentProject.data?.updated_at) {
      throw new Error(currentProject.error?.message ?? "project revision read failed");
    }
    frozenProjectRevision = String(currentProject.data.updated_at);
    frozenGeneratedAt = new Date(Math.max(Date.parse(frozenProjectRevision), Date.now()) + 1_000).toISOString();
    frozenCompletedAt = new Date(Date.parse(frozenGeneratedAt) + 1_000).toISOString();
    const malformedManifest = readyManifest({
      bundleId: malformedBundleId,
      workspaceId: workspaceA,
      projectId: projectA,
      planId,
      pdfId,
    });
    delete (malformedManifest.entries[1] as Partial<(typeof malformedManifest.entries)[number]>).evidence;
    const numericRevisionManifest = readyManifest({
      bundleId: numericRevisionBundleId,
      workspaceId: workspaceA,
      projectId: projectA,
      planId,
      pdfId,
    });
    const numericPlanEntry = numericRevisionManifest.entries[0] as unknown as {
      revisionToken: unknown;
      evidence: { revisionToken: unknown };
    };
    numericPlanEntry.revisionToken = 123;
    numericPlanEntry.evidence.revisionToken = 123;
    const [path, malformedPath, numericRevisionPath, approvalStoragePath] = await Promise.all([
      uploadBundleObject(bundleId, PRIMARY_BUNDLE_BYTES),
      uploadBundleObject(malformedBundleId, MALFORMED_BUNDLE_BYTES),
      uploadBundleObject(numericRevisionBundleId, NUMERIC_REVISION_BUNDLE_BYTES),
      uploadBundleObject(approvalStorageBundleId, APPROVAL_STORAGE_BUNDLE_BYTES),
    ]);
    const bundleRow = (params: {
      id: string;
      manifest: ReturnType<typeof readyManifest>;
      bytes: Uint8Array;
      storagePath: string;
    }) => ({
      id: params.id,
      workspace_id: workspaceA,
      project_id: projectA,
      project_revision: frozenProjectRevision,
      selection_json: [],
      manifest_json: params.manifest,
      manifest_sha256: sha256(Buffer.from(`manifest-${params.id}`)),
      checksums_sha256: sha256(Buffer.from(`checksums-${params.id}`)),
      bundle_sha256: sha256(params.bytes),
      storage_bucket: "project-evidence-bundles",
      storage_path: params.storagePath,
      byte_count: params.bytes.length,
      selected_count: 0,
      generated_by: creatorId,
      status: "ready",
      completed_at: frozenCompletedAt,
      generated_at: frozenGeneratedAt,
    });
    const bundle = await service.from("project_evidence_bundles").insert([
      bundleRow({
        id: bundleId,
        manifest: readyManifest({ bundleId, workspaceId: workspaceA, projectId: projectA, planId, pdfId }),
        bytes: PRIMARY_BUNDLE_BYTES,
        storagePath: path,
      }),
      bundleRow({
        id: malformedBundleId,
        manifest: malformedManifest,
        bytes: MALFORMED_BUNDLE_BYTES,
        storagePath: malformedPath,
      }),
      bundleRow({
        id: numericRevisionBundleId,
        manifest: numericRevisionManifest,
        bytes: NUMERIC_REVISION_BUNDLE_BYTES,
        storagePath: numericRevisionPath,
      }),
      bundleRow({
        id: approvalStorageBundleId,
        manifest: readyManifest({
          bundleId: approvalStorageBundleId,
          workspaceId: workspaceA,
          projectId: projectA,
          planId,
          pdfId,
        }),
        bytes: APPROVAL_STORAGE_BUNDLE_BYTES,
        storagePath: approvalStoragePath,
      }),
      bundleRow({
        id: missingObjectBundleId,
        manifest: readyManifest({ bundleId: missingObjectBundleId, workspaceId: workspaceA, projectId: projectA, planId, pdfId }),
        bytes: MISSING_OBJECT_BUNDLE_BYTES,
        storagePath: `${workspaceA}/${projectA}/${missingObjectBundleId}.zip`,
      }),
    ]);
    if (bundle.error) throw new Error(bundle.error.message);
    await creator.auth.signInWithPassword({ email: `decision-package-creator-${suffix}@example.test`, password });
    await approver.auth.signInWithPassword({ email: `decision-package-approver-${suffix}@example.test`, password });
    await otherAdmin.auth.signInWithPassword({ email: `decision-package-other-${suffix}@example.test`, password });
    await outsider.auth.signInWithPassword({ email: `decision-package-outsider-${suffix}@example.test`, password });
  }, 60_000);

  afterAll(async () => {
    await creator?.auth.signOut();
    await approver?.auth.signOut();
    await otherAdmin?.auth.signOut();
    await outsider?.auth.signOut();
    if (service && workspaceA && workspaceB) {
      if (bundleObjectPaths.length > 0) {
        const bundleObjects = await service.storage.from("project-evidence-bundles").remove(bundleObjectPaths);
        if (bundleObjects.error) throw new Error(bundleObjects.error.message);
      }
      if (reportStoragePath) {
        const reportObject = await service.storage.from("report-artifacts").remove([reportStoragePath]);
        if (reportObject.error) throw new Error(reportObject.error.message);
      }
      const removed = await service.from("workspaces").delete().in("id", [workspaceA, workspaceB]);
      if (removed.error) throw new Error(removed.error.message);
      for (const userId of [creatorId, approverId, otherAdminId, outsiderId]) {
        const memberships = await service.from("workspace_members").select("workspace_id").eq("user_id", userId);
        for (const row of (memberships.data ?? []) as Array<{ workspace_id: string }>) {
          const personal = await service.from("workspaces").delete().eq("id", row.workspace_id);
          if (personal.error) throw new Error(personal.error.message);
        }
        const deleted = await service.auth.admin.deleteUser(userId);
        if (deleted.error) throw new Error(deleted.error.message);
      }
    }
  }, 60_000);

  it("allows a creator/member to submit to a different owner using the exact bundle hash", async () => {
    const missingObjectBypass = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: missingObjectBundleId,
      bundle_sha256: sha256(MISSING_OBJECT_BUNDLE_BYTES),
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    });
    expect(missingObjectBypass.error?.message ?? "").toMatch(/exact immutable stored ZIP object/i);

    const malformedBypass = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: malformedBundleId,
      bundle_sha256: sha256(MALFORMED_BUNDLE_BYTES),
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    });
    expect(malformedBypass.error?.message ?? "").toMatch(/complete ready v2 manifest/i);

    const numericRevisionBypass = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: numericRevisionBundleId,
      bundle_sha256: sha256(NUMERIC_REVISION_BUNDLE_BYTES),
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    });
    expect(numericRevisionBypass.error?.message ?? "").toMatch(/complete ready v2 manifest/i);

    const inserted = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    }).select("id").single();
    expect(inserted.error).toBeNull();
    submissionId = inserted.data!.id;

    const approvalStorageSubmission = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: approvalStorageBundleId,
      bundle_sha256: sha256(APPROVAL_STORAGE_BUNDLE_BYTES),
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    }).select("id").single();
    expect(approvalStorageSubmission.error).toBeNull();
    approvalStorageSubmissionId = approvalStorageSubmission.data!.id;

    const mismatch = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: bundleId,
      bundle_sha256: "d".repeat(64),
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    });
    expect(mismatch.error?.message ?? "").toMatch(/exact bundle hash/i);

    const selfAssigned = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      submitted_by: creatorId,
      assigned_approver_id: creatorId,
    });
    expect(selfAssigned.error?.message ?? "").toMatch(/distinct|differ|violates/i);

    const duplicate = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    });
    expect(duplicate.error?.message ?? "").toMatch(/duplicate|unique/i);

    const duplicateHashBundleId = randomUUID();
    const duplicateHashPath = await uploadBundleObject(duplicateHashBundleId, PRIMARY_BUNDLE_BYTES);
    const duplicateHashBundle = await service.from("project_evidence_bundles").insert({
      id: duplicateHashBundleId,
      workspace_id: workspaceA,
      project_id: projectA,
      project_revision: frozenProjectRevision,
      selection_json: [],
      manifest_json: readyManifest({
        bundleId: duplicateHashBundleId,
        workspaceId: workspaceA,
        projectId: projectA,
        planId,
        pdfId,
      }),
      manifest_sha256: "a".repeat(64),
      checksums_sha256: "b".repeat(64),
      bundle_sha256: bundleHash,
      storage_bucket: "project-evidence-bundles",
      storage_path: duplicateHashPath,
      byte_count: PRIMARY_BUNDLE_BYTES.length,
      selected_count: 0,
      generated_by: creatorId,
      status: "ready",
      completed_at: frozenCompletedAt,
      generated_at: frozenGeneratedAt,
    });
    expect(duplicateHashBundle.error).toBeNull();
    const duplicateHash = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: duplicateHashBundleId,
      bundle_sha256: bundleHash,
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    });
    expect(duplicateHash.error?.message ?? "").toMatch(/duplicate|unique/i);
  });

  it("refuses approval when the immutable stored ZIP disappears but still permits return", async () => {
    const storagePath = `${workspaceA}/${projectA}/${approvalStorageBundleId}.zip`;
    const removed = await service.storage.from("project-evidence-bundles").remove([storagePath]);
    expect(removed.error).toBeNull();

    const approvalBypass = await approver.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: approvalStorageSubmissionId,
      bundle_id: approvalStorageBundleId,
      bundle_sha256: sha256(APPROVAL_STORAGE_BUNDLE_BYTES),
      decision: "approved",
      decided_by: approverId,
    });
    expect(approvalBypass.error?.message ?? "").toMatch(/exact immutable stored ZIP object/i);

    const returned = await approver.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: approvalStorageSubmissionId,
      bundle_id: approvalStorageBundleId,
      bundle_sha256: sha256(APPROVAL_STORAGE_BUNDLE_BYTES),
      decision: "returned",
      reason: "The retained ZIP is unavailable and must be frozen again.",
      decided_by: approverId,
    });
    expect(returned.error).toBeNull();
  });

  it("isolates workspaces and exposes the pending item only to its assigned approver queue", async () => {
    const outside = await outsider.from("project_decision_package_submissions").select("id").eq("id", submissionId);
    expect(outside.error).toBeNull();
    expect(outside.data).toEqual([]);
    const crossWorkspaceSubmission = await outsider.from("project_decision_package_submissions").insert({
      workspace_id: workspaceB,
      project_id: projectA,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      submitted_by: outsiderId,
      assigned_approver_id: approverId,
    });
    expect(crossWorkspaceSubmission.error?.message ?? "").toMatch(/exact bundle hash and scope/i);
    const crossWorkspaceDecision = await outsider.from("project_decision_package_decisions").insert({
      workspace_id: workspaceB,
      project_id: projectA,
      submission_id: submissionId,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      decision: "approved",
      decided_by: outsiderId,
    });
    expect(crossWorkspaceDecision.error?.message ?? "").toMatch(/submitted exact bundle hash and scope/i);
    const queue = await approver.from("project_decision_package_my_work")
      .select("id,queue_state")
      .eq("workspace_id", workspaceA)
      .eq("id", submissionId);
    expect(queue.error).toBeNull();
    expect(queue.data).toEqual([{ id: submissionId, queue_state: "pending_review" }]);
    const assignedButWrongWorkspace = await approver.from("project_decision_package_my_work")
      .select("id")
      .eq("workspace_id", workspaceB)
      .eq("id", submissionId);
    expect(assignedButWrongWorkspace.error).toBeNull();
    expect(assignedButWrongWorkspace.data).toEqual([]);
    const outsiderQueue = await outsider.from("project_decision_package_my_work")
      .select("id")
      .eq("workspace_id", workspaceA)
      .eq("id", submissionId);
    expect(outsiderQueue.error).toBeNull();
    expect(outsiderQueue.data).toEqual([]);
    const notAssignedQueue = await otherAdmin.from("project_decision_package_my_work").select("id").eq("id", submissionId);
    expect(notAssignedQueue.data).toEqual([]);
  });

  it("allows only the assigned approver and creates an immutable exact-hash receipt", async () => {
    const wrongApprover = await otherAdmin.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: submissionId,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      decision: "approved",
      decided_by: otherAdminId,
    });
    expect(wrongApprover.error?.message ?? "").toMatch(/assigned approver/i);

    const selfApproval = await creator.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: submissionId,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      decision: "approved",
      decided_by: creatorId,
    });
    expect(selfApproval.error?.message ?? "").toMatch(/assigned approver|self-approval|row-level security/i);

    const approved = await approver.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: submissionId,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      decision: "approved",
      decided_by: approverId,
    }).select("id,receipt_json,receipt_canonical_json,receipt_sha256").single();
    expect(approved.error).toBeNull();
    expect(approved.data?.receipt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(approved.data?.receipt_sha256).not.toBe("0".repeat(64));
    expect(approved.data?.receipt_json).toMatchObject({
      bundleSha256: bundleHash,
      decision: "approved",
      approvalOrPublication: false,
      statutoryAdoption: false,
      modelValidation: false,
      approverAuthority: {
        workspaceRole: "owner",
        requiredAction: "decision_packages.approve",
        assignedApproverId: approverId,
      },
    });
    expect(JSON.parse(approved.data!.receipt_canonical_json)).toEqual(approved.data!.receipt_json);
    expect(createHash("sha256").update(approved.data!.receipt_canonical_json).digest("hex"))
      .toBe(approved.data!.receipt_sha256);

    const contradictory = await approver.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: submissionId,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      decision: "returned",
      reason: "A contradictory second receipt must not exist.",
      decided_by: approverId,
    });
    expect(contradictory.error?.message ?? "").toMatch(/duplicate|unique/i);

    const rewrite = await service.from("project_decision_package_decisions")
      .update({ reason: "rewritten" }).eq("id", approved.data!.id);
    expect(rewrite.error?.message ?? "").toMatch(/append-only/i);
    const rewriteSubmission = await service.from("project_decision_package_submissions")
      .update({ note: "rewritten" }).eq("id", submissionId);
    expect(rewriteSubmission.error?.message ?? "").toMatch(/append-only/i);
  });

  it("keeps a pending package returnable when current-use freshness changes", async () => {
    const staleBundleId = randomUUID();
    const staleBundleHash = sha256(STALE_BUNDLE_BYTES);
    const staleStoragePath = await uploadBundleObject(staleBundleId, STALE_BUNDLE_BYTES);
    const created = await service.from("project_evidence_bundles").insert({
      id: staleBundleId,
      workspace_id: workspaceA,
      project_id: projectA,
      project_revision: frozenProjectRevision,
      selection_json: [],
      manifest_json: readyManifest({
        bundleId: staleBundleId,
        workspaceId: workspaceA,
        projectId: projectA,
        planId,
        pdfId,
      }),
      manifest_sha256: "f".repeat(64),
      checksums_sha256: "0".repeat(64),
      bundle_sha256: staleBundleHash,
      storage_bucket: "project-evidence-bundles",
      storage_path: staleStoragePath,
      byte_count: STALE_BUNDLE_BYTES.length,
      selected_count: 0,
      generated_by: creatorId,
      status: "ready",
      completed_at: frozenCompletedAt,
      generated_at: frozenGeneratedAt,
    });
    expect(created.error).toBeNull();
    const submitted = await creator.from("project_decision_package_submissions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      bundle_id: staleBundleId,
      bundle_sha256: staleBundleHash,
      submitted_by: creatorId,
      assigned_approver_id: approverId,
    }).select("id").single();
    expect(submitted.error).toBeNull();

    const changed = await service.from("projects")
      .update({ summary: "Changed after the package was submitted." })
      .eq("id", projectA);
    expect(changed.error).toBeNull();

    const staleApproval = await approver.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: submitted.data!.id,
      bundle_id: staleBundleId,
      bundle_sha256: staleBundleHash,
      decision: "approved",
      decided_by: approverId,
    });
    expect(staleApproval.error?.message ?? "").toMatch(/project changed after freezing/i);

    const returned = await approver.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: submitted.data!.id,
      bundle_id: staleBundleId,
      bundle_sha256: staleBundleHash,
      decision: "returned",
      reason: "Freeze a new package after the project change.",
      decided_by: approverId,
    }).select("receipt_json").single();
    expect(returned.error).toBeNull();
    expect(returned.data?.receipt_json).toMatchObject({ decision: "returned" });
  });
});
