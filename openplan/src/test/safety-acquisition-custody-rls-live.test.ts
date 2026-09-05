import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { ccrsAdapter } from "@/lib/safety/sources/ccrs";
import { globalProbeGrid } from "./helpers/crash-coverage-probe";

// Explicit synthetic source fixture. The actual producer and database are real.
(LIVE_RLS ? describe : describe.skip)("repeat acquisitions preserve crash and party custody", () => {
  let service: SupabaseClient;
  let stranger: SupabaseClient;
  let owner: SupabaseClient;
  const users: string[] = [];
  const workspaceId = randomUUID();
  let created = false;
  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "custody-service");
    stranger = liveClient(env.API_URL, env.ANON_KEY, "custody-anonymous");
    owner = liveClient(env.API_URL, env.ANON_KEY, "custody-member");
    const result = await service.from("workspaces").insert({ id: workspaceId,
      name: "Synthetic custody regression", slug: `custody-${workspaceId}` });
    expect(result.error).toBeNull();
    created = true;
    for (const [index, client] of [owner, stranger].entries()) {
      const email = `custody-${index}-${workspaceId}@example.test`;
      const password = `Custody!${randomUUID()}`;
      const user = await service.auth.admin.createUser({ email, password, email_confirm: true });
      expect(user.error).toBeNull();
      users.push(user.data.user!.id);
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    }
    expect((await service.from("workspace_members").insert({ workspace_id: workspaceId,
      user_id: users[0], role: "owner" })).error).toBeNull();
  }, 60_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    if (created) expect((await service.from("workspaces").delete().eq("id", workspaceId)).error).toBeNull();
    for (const id of users) {
      const memberships = await service.from("workspace_members").select("workspace_id").eq("user_id", id);
      expect(memberships.error).toBeNull();
      for (const row of memberships.data ?? []) {
        expect((await service.from("workspaces").delete().eq("id", row.workspace_id)).error).toBeNull();
      }
      expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
    }
  });
  it("retains each source version and the person's original crash link", async () => {
    const bbox = globalProbeGrid().find((area) => ccrsAdapter.covers(area));
    expect(bbox).toBeDefined();
    vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue({
      records: [{ externalId: "synthetic-repeat", collisionDate: "2024-01-01", collisionYear: 2024,
        severity: "fatal", killedCount: 1, injuredCount: 0, pedestrianInvolved: false,
        bicyclistInvolved: false, motorcyclistInvolved: false, collisionType: null,
        lighting: null, weather: null, sourceAttributes: {},
        latitude: bbox!.minLat, longitude: bbox!.minLon }],
      matchedTotal: 1, geocodedTotal: 1, yearsCovered: [2024], truncated: false,
    });
    vi.spyOn(ccrsAdapter, "fetchParties").mockResolvedValue([{ crashExternalId: "synthetic-repeat",
      externalPartyId: "synthetic-person", role: "driver", ageBand: "unknown",
      injury: "fatal", sourceAttributes: {} }]);
    const run = () => ingestCrashesForStudyArea({ service, workspaceId, bbox: bbox!,
      years: [2024], enrichSeriousInjury: false, includeParties: true });
    const first = await run();
    expect(first.status, first.error ?? "first acquisition").toBe("ready");
    const before = await service.from("safety_crashes").select("id,ingest_id,external_id")
      .eq("workspace_id", workspaceId).eq("ingest_id", first.ingestId);
    expect(before.error).toBeNull();
    expect(before.data).toHaveLength(1);
    const second = await run();
    expect(second.status, second.error ?? "second acquisition").toBe("ready");
    expect(second.ingestId).not.toBe(first.ingestId);
    const after = await service.from("safety_crashes").select("id,ingest_id,external_id")
      .eq("workspace_id", workspaceId).eq("ingest_id", first.ingestId);
    expect(after.error).toBeNull();
    expect(after.data, "later retrieval must not steal the earlier acquisition's crash").toEqual(before.data);
    const parties = await service.from("safety_crash_parties").select("crash_id,ingest_id")
      .eq("workspace_id", workspaceId);
    expect(parties.error).toBeNull();
    expect(parties.data).toHaveLength(2);
    expect(parties.data).toContainEqual({ crash_id: before.data![0].id, ingest_id: first.ingestId });
    const latest = await owner.from("safety_crashes_latest").select("id").eq("workspace_id", workspaceId);
    expect(latest.error).toBeNull();
    expect(latest.data, "workspace maps must not double-count source cases").toHaveLength(1);
    const denied = await stranger.from("safety_crashes_latest").select("id").eq("workspace_id", workspaceId);
    expect(denied.error).toBeNull();
    expect(denied.data ?? []).toEqual([]);
  }, 60_000);
});
