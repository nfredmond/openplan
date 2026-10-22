import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { queryCatalog, resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * THE OVERALL WORK PROGRAM TYPE, PROVED AGAINST POSTGRES.
 *
 * `owp-program-type-migration.test.ts` proves the migration file says the
 * right thing. This proves the database does it: a workspace owner, through
 * PostgREST and the programs insert policy, can save a program typed
 * `owp_upwp`, an original type still saves, an unknown type is still refused
 * by the CHECK, and exactly one CHECK guards the column.
 *
 * Blind categories: the program creation route and its zod enum (covered by
 * the catalog), viewer and outsider roles (covered by rls-isolation), and the
 * hosted database, which this never touches.
 *
 * Run with: npm run test:rls-live
 */

describe("the OWP type's live probe stays in the live run", () => {
  it("is listed in test:rls-live", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:rls-live"]).toContain("src/test/owp-program-type-rls.test.ts");
  });
});

(LIVE_RLS ? describe : describe.skip)("the OWP program type, live", () => {
  let service: SupabaseClient;
  let owner: SupabaseClient;

  const password = "OpenPlanOwp!2026";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const workspaceId = randomUUID();
  let userId = "";

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "openplan-owp-service");
    owner = liveClient(env.API_URL, env.ANON_KEY, "openplan-owp-owner");

    const email = `owp-type-${suffix}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw new Error(`Failed to create probe user: ${created.error?.message ?? "missing user"}`);
    }
    userId = created.data.user.id;

    const workspace = await service.from("workspaces").insert({ id: workspaceId, name: `OWP ${suffix}`, slug: `owp-${suffix}` });
    if (workspace.error) throw new Error(`Failed to seed workspace: ${workspace.error.message}`);
    const member = await service
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });
    if (member.error) throw new Error(`Failed to seed membership: ${member.error.message}`);

    const signIn = await owner.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`Failed to sign in probe owner: ${signIn.error.message}`);
  }, 90_000);

  // Signing up provisions a personal workspace too, so delete by membership.
  afterAll(async () => {
    await owner?.auth.signOut();
    if (!service || !userId) return;

    const { data: memberships } = await service.from("workspace_members").select("workspace_id").eq("user_id", userId);
    for (const row of (memberships ?? []) as { workspace_id: string }[]) {
      await service.from("workspaces").delete().eq("id", row.workspace_id);
    }
    await service.from("workspaces").delete().eq("id", workspaceId);

    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) throw new Error(`OWP probe left user ${userId} behind: ${removed.error.message}`);
  }, 90_000);

  const insertAsOwner = (programType: string) =>
    owner
      .from("programs")
      .insert({
        workspace_id: workspaceId,
        title: `FY 2027-28 ${programType} ${suffix}`,
        program_type: programType,
        cycle_name: "FY 2027-28",
        created_by: userId,
      })
      .select("id, program_type")
      .single();

  it("lets a workspace owner save an Overall Work Program", async () => {
    const { data, error } = await insertAsOwner("owp_upwp");
    expect(error).toBeNull();
    expect(data?.program_type).toBe("owp_upwp");
  });

  it("still accepts an original type", async () => {
    const { data, error } = await insertAsOwner("rtip");
    expect(error).toBeNull();
    expect(data?.program_type).toBe("rtip");
  });

  it("still refuses a type the CHECK does not list", async () => {
    const { data, error } = await insertAsOwner("upwp");
    expect(data).toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("programs_program_type_check");
  });

  it("leaves exactly one CHECK on program_type, and it is validated", () => {
    const rows = queryCatalog(
      resolveLocalDbContainer(),
      "SELECT c.conname || CASE WHEN c.convalidated THEN ' validated' ELSE ' not validated' END FROM pg_constraint c " +
        "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) " +
        "WHERE c.conrelid = 'public.programs'::regclass AND c.contype = 'c' AND a.attname = 'program_type'",
    );
    expect(rows).toEqual(["programs_program_type_check validated"]);
  });
});
