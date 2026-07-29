import { randomUUID } from "node:crypto";
import { type SupabaseClient } from "@supabase/supabase-js";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * LIVE TEST — the viewer tier is enforced by the DATABASE, not just the API.
 *
 * `rls-isolation.test.ts` proves tenant isolation: workspace A cannot see or
 * touch workspace B. It says nothing about ROLE, and the string "viewer" does
 * not appear in it. That gap was the defect: viewer shipped as an API-layer
 * promise while `authenticated` still held INSERT/UPDATE/DELETE grants on every
 * workspace table and the RLS policies asked only about membership.
 *
 * These assertions go through PostgREST with a real signed-in session and the
 * public anon key — precisely the path a viewer with devtools would use, and the
 * one every route guard in the product is blind to.
 *
 * The last test matters as much as the denials: the SAME user, promoted to
 * member, must be able to write. Otherwise this suite would pass just as
 * happily against a database where writing is simply broken for everyone.
 *
 * Run with: npm run test:rls-live
 */

const liveDescribe = LIVE_RLS ? describe : describe.skip;

const client = (url: string, key: string) => liveClient(url, key, "openplan-viewer");

liveDescribe("viewer write denial (live)", () => {
  let service: SupabaseClient;
  let viewer: SupabaseClient;

  const password = "OpenPlanViewer!2026";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const reportId = randomUUID();
  let userId = "";

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = client(env.API_URL, env.SERVICE_ROLE_KEY);
    viewer = client(env.API_URL, env.ANON_KEY);

    const email = `rls-viewer-${suffix}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw new Error(`Failed to create viewer user: ${created.error?.message ?? "missing user"}`);
    }
    userId = created.data.user.id;

    const mustInsert = async (table: string, row: Record<string, unknown>) => {
      const { error } = await service.from(table).insert(row);
      if (error) throw new Error(`Failed to seed ${table}: ${error.message}`);
    };

    await mustInsert("workspaces", {
      id: workspaceId,
      name: `Viewer denial ${suffix}`,
      slug: `viewer-denial-${suffix}`,
    });
    await mustInsert("workspace_members", { workspace_id: workspaceId, user_id: userId, role: "viewer" });
    await mustInsert("projects", { id: projectId, workspace_id: workspaceId, name: `Viewer probe ${suffix}` });
    await mustInsert("reports", {
      id: reportId,
      workspace_id: workspaceId,
      project_id: projectId,
      title: `Viewer probe report ${suffix}`,
      report_type: "project_status",
    });

    const signIn = await viewer.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`Failed to sign in viewer: ${signIn.error.message}`);
  }, 60_000);

  afterAll(async () => {
    if (!service) return;
    await viewer?.auth.signOut();
    await service.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await service.auth.admin.deleteUser(userId);
  });

  it("lets a viewer READ workspace content", async () => {
    const { data, error } = await viewer.from("projects").select("id, name").eq("workspace_id", workspaceId);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toContain(projectId);
  });

  it("refuses a viewer INSERT", async () => {
    const { error } = await viewer
      .from("projects")
      .insert({ workspace_id: workspaceId, name: `viewer-created ${suffix}` });

    // A restrictive WITH CHECK failure is a hard error, not a silent no-op.
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/row-level security/i);
  });

  it("refuses a viewer UPDATE, and does not change the row", async () => {
    const { data } = await viewer
      .from("projects")
      .update({ name: `TAMPERED ${suffix}` })
      .eq("id", projectId)
      .select("id");

    // An UPDATE whose USING clause matches nothing reports success over zero
    // rows — so the row itself is what has to be re-read.
    expect(data ?? []).toEqual([]);

    const { data: after } = await service.from("projects").select("name").eq("id", projectId).single();
    expect(after?.name).toBe(`Viewer probe ${suffix}`);
  });

  it("refuses a viewer DELETE, and does not remove the row", async () => {
    const { data } = await viewer.from("projects").delete().eq("id", projectId).select("id");
    expect(data ?? []).toEqual([]);

    const { count } = await service
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("id", projectId);
    expect(count).toBe(1);
  });

  it("refuses a viewer write to a table that reaches its workspace through a parent", async () => {
    // report_sections has no workspace_id of its own; its gate resolves the
    // workspace through reports. This is the 20260728000007 family.
    const { error } = await viewer
      .from("report_sections")
      .insert({ report_id: reportId, section_key: `viewer-probe-${suffix}`, title: "Viewer probe" });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/row-level security/i);
  });

  it("lets the SAME user write once promoted to member", async () => {
    const promoted = await service
      .from("workspace_members")
      .update({ role: "member" })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    expect(promoted.error).toBeNull();

    const { data, error } = await viewer
      .from("projects")
      .update({ name: `Promoted write ${suffix}` })
      .eq("id", projectId)
      .select("id");

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([projectId]);
  });
});
