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

  /**
   * Deleting the workspace this test created is not enough, and the old version
   * of this hook silently proved it: signing up fires the `on_auth_user_created`
   * trigger, which provisions a PERSONAL workspace as well. That second
   * workspace still referenced the user, so `deleteUser` failed — and because
   * its error was never checked, every run of this file left a throwaway account
   * behind. Eleven had accumulated by 2026-08-03.
   *
   * So: delete workspaces by MEMBERSHIP rather than by the id this test knows
   * about, and make a failed deletion fail the run instead of disappearing. An
   * orphaned throwaway user is a defect, not untidiness — it is a real account
   * with a real password sitting in the auth table of whatever database the
   * suite last pointed at.
   */
  afterAll(async () => {
    if (!service) return;
    await viewer?.auth.signOut();
    await service.from("workspaces").delete().eq("id", workspaceId);

    if (userId) {
      const { data: memberships } = await service
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId);
      for (const row of (memberships ?? []) as { workspace_id: string }[]) {
        await service.from("workspaces").delete().eq("id", row.workspace_id);
      }

      const removed = await service.auth.admin.deleteUser(userId);
      if (removed.error) {
        throw new Error(`Viewer-denial probe left user ${userId} behind: ${removed.error.message}`);
      }
    }
  }, 60_000);

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

  /*
    ─────────────────────────────────────────────────────────────────────────
    THE ONE THING A VIEWER MUST BE ABLE TO WRITE.

    A writer can assign a deliverable to a viewer (deliberate — a viewer can be
    the right reviewer) and the nightly sweep writes them a reminder. Until
    20260822000001 the restrictive UPDATE gate asked
    `workspace_member_can_write`, so the viewer could never mark it read: single
    mark-read answered 404, mark-all answered marked:0, and the unread badge
    could only be cleared by a role change or a service-role delete. Three
    correct decisions composed into a dead end that no single lane owned.

    Live, because the whole point is that it is the DATABASE that decides. The
    route returning 200 would prove nothing.
    ─────────────────────────────────────────────────────────────────────────
  */
  describe("a reminder addressed to the viewer", () => {
    const notificationId = randomUUID();
    const othersNotificationId = randomUUID();
    let otherUserId = "";

    beforeAll(async () => {
      // A REAL second user, because `recipient_user_id` references auth.users.
      // The "somebody else's reminder" assertion is worthless without one, and
      // a random uuid simply fails the foreign key.
      const other = await service.auth.admin.createUser({
        email: `rls-viewer-other-${suffix}@example.test`,
        password,
        email_confirm: true,
      });
      if (other.error || !other.data.user) {
        throw new Error(`Failed to create second user: ${other.error?.message ?? "missing user"}`);
      }
      otherUserId = other.data.user.id;

      const insert = async (row: Record<string, unknown>) => {
        const { error } = await service.from("work_notifications").insert(row);
        if (error) throw new Error(`seeding work_notifications failed: ${error.message}`);
      };

      // Authored by the service role, exactly as the sweep does.
      await insert({
        id: notificationId,
        workspace_id: workspaceId,
        recipient_user_id: userId,
        kind: "deliverable_due",
        subject_table: "project_deliverables",
        subject_id: randomUUID(),
        project_id: projectId,
        due_on: "2099-12-31",
        title: `Viewer reminder ${suffix}`,
        body: `Viewer reminder body ${suffix}`,
      });

      // A reminder for somebody else in the SAME workspace. The recipient id is
      // a user that is not this viewer; the row is invisible to them and must
      // stay untouchable.
      await insert({
        id: othersNotificationId,
        workspace_id: workspaceId,
        recipient_user_id: otherUserId,
        kind: "deliverable_due",
        subject_table: "project_deliverables",
        subject_id: randomUUID(),
        project_id: projectId,
        due_on: "2099-12-31",
        title: `Someone else reminder ${suffix}`,
        body: "not yours",
      });
    }, 60_000);

    it("can be marked read by the viewer it belongs to", async () => {
      const { data, error } = await viewer
        .from("work_notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .select("id");

      expect(error).toBeNull();
      // A matched row, not a silent zero-row success — that zero was the bug.
      expect(data?.map((row) => row.id)).toEqual([notificationId]);

      const { data: after } = await service
        .from("work_notifications")
        .select("is_read")
        .eq("id", notificationId)
        .single();
      expect(after?.is_read).toBe(true);
    });

    it("does not let the viewer touch somebody else's reminder", async () => {
      const { data } = await viewer
        .from("work_notifications")
        .update({ is_read: true })
        .eq("id", othersNotificationId)
        .select("id");

      expect(data ?? []).toEqual([]);

      const { data: after } = await service
        .from("work_notifications")
        .select("is_read")
        .eq("id", othersNotificationId)
        .single();
      expect(after?.is_read).toBe(false);
    });

    it("does not let the viewer rewrite what the reminder SAYS", async () => {
      /*
        The policy was widened, so the column GRANT is what keeps this a record
        of what a person was told rather than something they can edit. RLS
        cannot express "these columns only" — WITH CHECK cannot see the old row
        — so 20260822000001 revoked table-wide UPDATE and granted only
        (is_read, read_at).
      */
      const { error } = await viewer
        .from("work_notifications")
        .update({ title: `TAMPERED ${suffix}` })
        .eq("id", notificationId)
        .select("id");

      expect(error, "a viewer rewrote their own reminder's title").not.toBeNull();

      const { data: after } = await service
        .from("work_notifications")
        .select("title")
        .eq("id", notificationId)
        .single();
      expect(after?.title).toBe(`Viewer reminder ${suffix}`);
    });

    afterAll(async () => {
      if (!otherUserId) return;

      // The reminders first: they reference this user and the outer teardown
      // (which drops THIS suite's workspace) has not run yet.
      await service.from("work_notifications").delete().in("id", [notificationId, othersNotificationId]);

      // Then the workspace `handle_new_user` created for them. Every new user
      // gets one automatically, and deleting the user while it exists answers
      // 500 — which is why the teardown above this one drops workspaces before
      // users. Verified rather than assumed: `admin.deleteUser` fails for ANY
      // freshly created user until its auto-created workspace is gone.
      const { data: memberships } = await service
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", otherUserId);
      for (const row of (memberships ?? []) as { workspace_id: string }[]) {
        await service.from("workspaces").delete().eq("id", row.workspace_id);
      }

      const removed = await service.auth.admin.deleteUser(otherUserId);
      if (removed.error) {
        throw new Error(
          `Viewer-denial probe left second user ${otherUserId} behind: ` +
            `${removed.error.message || `status ${removed.error.status}`}`
        );
      }
    }, 60_000);

    it("still cannot mint or destroy a reminder", async () => {
      const insert = await viewer.from("work_notifications").insert({
        workspace_id: workspaceId,
        recipient_user_id: userId,
        kind: "deliverable_due",
        subject_table: "project_deliverables",
        subject_id: randomUUID(),
        due_on: "2099-12-31",
        title: "self-authored",
        body: "",
      });
      expect(insert.error, "a viewer minted their own reminder").not.toBeNull();

      const { data: deleted } = await viewer
        .from("work_notifications")
        .delete()
        .eq("id", notificationId)
        .select("id");
      expect(deleted ?? [], "a viewer destroyed the evidence they were told").toEqual([]);
    });
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
