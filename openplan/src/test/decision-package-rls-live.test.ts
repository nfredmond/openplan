import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

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
  let submissionId = "";
  const bundleHash = "a".repeat(64);
  const password = "DecisionPackageRls!2026";
  let suffix = "";

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
      id: projectA, workspace_id: workspaceA, name: "Governed project", created_by: creatorId,
    });
    if (project.error) throw new Error(project.error.message);
    const path = `${workspaceA}/${projectA}/${bundleId}.zip`;
    const bundle = await service.from("project_evidence_bundles").insert({
      id: bundleId,
      workspace_id: workspaceA,
      project_id: projectA,
      project_revision: "2026-08-26T20:00:00Z",
      selection_json: [],
      manifest_json: { schemaVersion: "project_evidence_manifest.v2" },
      manifest_sha256: "b".repeat(64),
      checksums_sha256: "c".repeat(64),
      bundle_sha256: bundleHash,
      storage_bucket: "project-evidence-bundles",
      storage_path: path,
      byte_count: 4,
      selected_count: 0,
      generated_by: creatorId,
      status: "ready",
      completed_at: "2026-08-26T20:01:00Z",
      generated_at: "2026-08-26T20:00:00Z",
    });
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
  });

  it("isolates workspaces and exposes the pending item only to its assigned approver queue", async () => {
    const outside = await outsider.from("project_decision_package_submissions").select("id").eq("id", submissionId);
    expect(outside.error).toBeNull();
    expect(outside.data).toEqual([]);
    const queue = await approver.from("project_decision_package_my_work").select("id,queue_state").eq("id", submissionId);
    expect(queue.error).toBeNull();
    expect(queue.data).toEqual([{ id: submissionId, queue_state: "pending_review" }]);
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

    const approved = await approver.from("project_decision_package_decisions").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      submission_id: submissionId,
      bundle_id: bundleId,
      bundle_sha256: bundleHash,
      decision: "approved",
      decided_by: approverId,
    }).select("id,receipt_json,receipt_sha256").single();
    expect(approved.error).toBeNull();
    expect(approved.data?.receipt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(approved.data?.receipt_sha256).not.toBe("0".repeat(64));
    expect(approved.data?.receipt_json).toMatchObject({
      bundleSha256: bundleHash,
      decision: "approved",
      approvalOrPublication: false,
      statutoryAdoption: false,
      modelValidation: false,
    });

    const rewrite = await service.from("project_decision_package_decisions")
      .update({ reason: "rewritten" }).eq("id", approved.data!.id);
    expect(rewrite.error?.message ?? "").toMatch(/append-only/i);
    const rewriteSubmission = await service.from("project_decision_package_submissions")
      .update({ note: "rewritten" }).eq("id", submissionId);
    expect(rewriteSubmission.error?.message ?? "").toMatch(/append-only/i);
  });
});
