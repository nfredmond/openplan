import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("project evidence bundle live authorization and immutability", () => {
  let service: SupabaseClient;
  let owner: SupabaseClient;
  let viewer: SupabaseClient;
  let outsider: SupabaseClient;
  let workspaceA = "";
  let workspaceB = "";
  let projectA = "";
  let projectB = "";
  let ownerId = "";
  let viewerId = "";
  let outsiderId = "";
  let bundleId = "";
  const password = "EvidenceBundleRls!2026";

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "evidence-bundle-service");
    owner = liveClient(env.API_URL, env.ANON_KEY, "evidence-bundle-owner");
    viewer = liveClient(env.API_URL, env.ANON_KEY, "evidence-bundle-viewer");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "evidence-bundle-outsider");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const created = await Promise.all(
      ["owner", "viewer", "outsider"].map((role) =>
        service.auth.admin.createUser({
          email: `evidence-bundle-${role}-${suffix}@example.test`,
          password,
          email_confirm: true,
        })
      )
    );
    for (const result of created) {
      if (result.error || !result.data.user) throw new Error(result.error?.message ?? "user creation failed");
    }
    ownerId = created[0].data.user!.id;
    viewerId = created[1].data.user!.id;
    outsiderId = created[2].data.user!.id;
    workspaceA = randomUUID();
    workspaceB = randomUUID();
    projectA = randomUUID();
    projectB = randomUUID();
    bundleId = randomUUID();

    const workspaces = await service.from("workspaces").insert([
      { id: workspaceA, name: `Evidence A ${suffix}`, slug: `evidence-a-${suffix}` },
      { id: workspaceB, name: `Evidence B ${suffix}`, slug: `evidence-b-${suffix}` },
    ]);
    if (workspaces.error) throw new Error(workspaces.error.message);
    const memberships = await service.from("workspace_members").insert([
      { workspace_id: workspaceA, user_id: ownerId, role: "owner" },
      { workspace_id: workspaceA, user_id: viewerId, role: "viewer" },
      { workspace_id: workspaceB, user_id: outsiderId, role: "owner" },
    ]);
    if (memberships.error) throw new Error(memberships.error.message);
    const projects = await service.from("projects").insert([
      { id: projectA, workspace_id: workspaceA, name: "Evidence project A", created_by: ownerId },
      { id: projectB, workspace_id: workspaceB, name: "Evidence project B", created_by: outsiderId },
    ]);
    if (projects.error) throw new Error(projects.error.message);

    await owner.auth.signInWithPassword({ email: `evidence-bundle-owner-${suffix}@example.test`, password });
    await viewer.auth.signInWithPassword({ email: `evidence-bundle-viewer-${suffix}@example.test`, password });
    await outsider.auth.signInWithPassword({ email: `evidence-bundle-outsider-${suffix}@example.test`, password });
  }, 60_000);

  afterAll(async () => {
    await owner?.auth.signOut();
    await viewer?.auth.signOut();
    await outsider?.auth.signOut();
    if (service && workspaceA && workspaceB) {
      const deleted = await service.from("workspaces").delete().in("id", [workspaceA, workspaceB]);
      if (deleted.error) throw new Error(`Evidence RLS workspace cleanup failed: ${deleted.error.message}`);
      for (const userId of [ownerId, viewerId, outsiderId]) {
        const memberships = await service.from("workspace_members").select("workspace_id").eq("user_id", userId);
        for (const row of (memberships.data ?? []) as Array<{ workspace_id: string }>) {
          const personal = await service.from("workspaces").delete().eq("id", row.workspace_id);
          if (personal.error) throw new Error(`Evidence RLS personal workspace cleanup failed: ${personal.error.message}`);
        }
        const removed = await service.auth.admin.deleteUser(userId);
        if (removed.error) throw new Error(removed.error.message);
      }
    }
  }, 60_000);

  it("allows owner creation, viewer read, and no cross-workspace read or create", async () => {
    const created = await owner.from("project_evidence_bundles").insert({
      id: bundleId,
      workspace_id: workspaceA,
      project_id: projectA,
      project_revision: "2026-08-26T00:00:00Z",
      selection_json: [{ candidateId: "project_geopackage:test", revisionToken: "a".repeat(64) }],
      selected_count: 1,
      generated_by: ownerId,
      status: "preparing",
    });
    expect(created.error).toBeNull();

    const viewerRead = await viewer.from("project_evidence_bundles").select("id,status").eq("id", bundleId);
    expect(viewerRead.error).toBeNull();
    expect(viewerRead.data).toEqual([{ id: bundleId, status: "preparing" }]);

    const outsiderRead = await outsider.from("project_evidence_bundles").select("id").eq("id", bundleId);
    expect(outsiderRead.error).toBeNull();
    expect(outsiderRead.data).toEqual([]);

    const viewerCreate = await viewer.from("project_evidence_bundles").insert({
      workspace_id: workspaceA,
      project_id: projectA,
      project_revision: "2026-08-26T00:00:00Z",
      selection_json: [],
      selected_count: 0,
      generated_by: viewerId,
      status: "preparing",
    });
    expect(viewerCreate.error?.message ?? "").toMatch(/row-level security/i);

    const crossCreate = await owner.from("project_evidence_bundles").insert({
      workspace_id: workspaceB,
      project_id: projectB,
      project_revision: "2026-08-26T00:00:00Z",
      selection_json: [],
      selected_count: 0,
      generated_by: ownerId,
      status: "preparing",
    });
    expect(crossCreate.error?.message ?? "").toMatch(/row-level security|project workspace/i);
  });

  it("denies authenticated finalization and permits one service-authored terminal transition", async () => {
    const refusedFinalize = await owner
      .from("project_evidence_bundles")
      .update({ status: "failed", failure_code: "rls_test", completed_at: new Date().toISOString() })
      .eq("id", bundleId);
    expect(refusedFinalize.error?.message ?? "").toMatch(/permission denied|row-level security/i);

    const stillPreparing = await service
      .from("project_evidence_bundles")
      .select("status")
      .eq("id", bundleId)
      .single();
    expect(stillPreparing.data?.status).toBe("preparing");

    const finalized = await service
      .from("project_evidence_bundles")
      .update({ status: "failed", failure_code: "rls_test", completed_at: new Date().toISOString() })
      .eq("id", bundleId);
    expect(finalized.error).toBeNull();

    const rewritten = await owner
      .from("project_evidence_bundles")
      .update({ failure_code: "rewritten" })
      .eq("id", bundleId)
      .select("failure_code");
    expect(rewritten.error?.message ?? "").toMatch(/permission denied|row-level security/i);
    const unchanged = await service
      .from("project_evidence_bundles")
      .select("failure_code")
      .eq("id", bundleId)
      .single();
    expect(unchanged.data?.failure_code).toBe("rls_test");

    const removed = await service.from("project_evidence_bundles").delete().eq("id", bundleId);
    expect(removed.error?.message ?? "").toMatch(/immutable/i);
  });
});
