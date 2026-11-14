/**
 * The four state injury-crash layers persist through the real database.
 *
 * Each adapter maps its own recorded layer responses (the fixtures its unit test
 * uses, captured from the live services on 2026-11-01), then the real ingest
 * stores the mapped crashes in a migrated local stack. This checks what the
 * database admits and what an acquisition records: the source id, the coverage
 * state, the severity completeness, each crash's severity, and Ohio's missing
 * casualty counts kept as null. A bogus source id and a bogus coverage state are
 * still refused, and the person table still admits only CCRS.
 *
 * Blind category: the live layers themselves (the network is replaced before
 * the ingest runs), and hosted Supabase, which this does not touch.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import { odotOrAdapter } from "@/lib/safety/sources/odot-or";
import { iowaDotIaAdapter } from "@/lib/safety/sources/iowadot-ia";
import { odotOhAdapter } from "@/lib/safety/sources/odot-oh";
import { ddotDcAdapter } from "@/lib/safety/sources/ddot-dc";
import type { CrashSourceAdapter, CrashFetchResult } from "@/lib/safety/sources/types";
import oregonLayer from "./fixtures/odot-or-crash-layer-2026-11-01.json";
import iowaLayer from "./fixtures/iowadot-ia-crash-layer-2026-11-01.json";
import ohioLayer from "./fixtures/odot-oh-crash-layer-2026-11-01.json";
import dcLayer from "./fixtures/ddot-dc-crash-layer-2026-11-01.json";

type RecordedLayer = {
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  year: number;
  responses: Record<string, unknown>;
};

const CASES: Array<{ adapter: CrashSourceAdapter; stateFips: string; layer: RecordedLayer; nullCasualties: boolean }> = [
  { adapter: odotOrAdapter, stateFips: "41", layer: oregonLayer as RecordedLayer, nullCasualties: false },
  { adapter: iowaDotIaAdapter, stateFips: "19", layer: iowaLayer as RecordedLayer, nullCasualties: false },
  // Ohio's layer has no casualty counts. A stored zero would read as "nobody hurt".
  { adapter: odotOhAdapter, stateFips: "39", layer: ohioLayer as RecordedLayer, nullCasualties: true },
  { adapter: ddotDcAdapter, stateFips: "11", layer: dcLayer as RecordedLayer, nullCasualties: false },
];

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Answer each ArcGIS request by its shape, from the layer's recorded responses. */
async function mapRecordedLayer(adapter: CrashSourceAdapter, layer: RecordedLayer): Promise<CrashFetchResult> {
  const answer = (key: string) => {
    const body = layer.responses[key];
    if (body === undefined) throw new Error(`${adapter.id} fixture has no ${key} response`);
    return jsonResponse(body);
  };
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    if (url.pathname.includes("Crash_Person_Data")) return answer("persons");
    if (!url.pathname.endsWith("/query")) return answer("catalog");
    if (params.get("outStatistics") || params.get("groupByFieldsForStatistics")) return answer("years");
    if (params.get("returnCountOnly") === "true") return answer("count");
    return answer("features");
  }) as unknown as typeof fetch);
  try {
    return await adapter.fetch({ bbox: layer.bbox, years: [layer.year] });
  } finally {
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  }
}

(LIVE_RLS ? describe : describe.skip)("state injury-crash layers persist with their own severity", () => {
  let service: SupabaseClient;
  let owner: SupabaseClient;
  let stranger: SupabaseClient;
  const users: string[] = [];
  const workspaceId = randomUUID();
  let created = false;

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "state-crash-service");
    owner = liveClient(env.API_URL, env.ANON_KEY, "state-crash-member");
    stranger = liveClient(env.API_URL, env.ANON_KEY, "state-crash-outsider");
    const result = await service.from("workspaces").insert({ id: workspaceId,
      name: "Synthetic state crash persistence", slug: `state-crash-${workspaceId}` });
    expect(result.error).toBeNull();
    created = true;
    for (const [index, client] of [owner, stranger].entries()) {
      const email = `state-crash-${index}-${workspaceId}@example.test`;
      const password = `StateCrash!${randomUUID()}`;
      const user = await service.auth.admin.createUser({ email, password, email_confirm: true });
      expect(user.error).toBeNull();
      users.push(user.data.user!.id);
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    }
    expect((await service.from("workspace_members").insert({ workspace_id: workspaceId,
      user_id: users[0], role: "owner" })).error).toBeNull();
  }, 60_000);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
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

  it.each(CASES)("stores $adapter.id crashes as $adapter.id with KABCO completeness", async ({ adapter, stateFips, layer, nullCasualties }) => {
    expect(adapter.persistable).toBe(true);
    const mapped = await mapRecordedLayer(adapter, layer);
    expect(mapped.records.length, `${adapter.id} fixture maps no crashes`).toBeGreaterThan(0);
    vi.spyOn(adapter, "fetch").mockResolvedValue(mapped);

    const result = await ingestCrashesForStudyArea({ service, workspaceId, bbox: layer.bbox,
      stateFips: [stateFips], years: [layer.year], enrichSeriousInjury: false, includeParties: false });
    expect(result.status, result.error ?? adapter.id).toBe("ready");
    expect(result.sourceId).toBe(adapter.id);
    expect(result.stored).toBe(true);

    const ingest = await owner.from("safety_crash_ingests")
      .select("id,source_id,coverage_state,severity_completeness,status,stored_count,party_completeness")
      .eq("workspace_id", workspaceId).eq("id", result.ingestId).single();
    expect(ingest.error).toBeNull();
    expect(ingest.data).toEqual({ id: result.ingestId, source_id: adapter.id, coverage_state: "state_injury_file",
      severity_completeness: "kabco_full", status: "ready", stored_count: mapped.records.length,
      party_completeness: "not_supported" });

    const crashes = await owner.from("safety_crashes")
      .select("external_id,source_id,severity,killed_count,injured_count")
      .eq("workspace_id", workspaceId).eq("ingest_id", result.ingestId);
    expect(crashes.error).toBeNull();
    expect(crashes.data).toHaveLength(mapped.records.length);
    const bySource = new Map(mapped.records.map((record) => [record.externalId, record]));
    for (const row of crashes.data ?? []) {
      const record = bySource.get(row.external_id);
      expect(record, `${adapter.id} stored a crash it did not map`).toBeDefined();
      expect(row.source_id).toBe(adapter.id);
      expect(row.severity).toBe(record!.severity);
      if (nullCasualties) {
        expect(row.killed_count).toBeNull();
        expect(row.injured_count).toBeNull();
      } else {
        expect(row.killed_count).toBe(record!.killedCount);
        expect(row.injured_count).toBe(record!.injuredCount);
      }
    }

    const hidden = await stranger.from("safety_crashes").select("id").eq("workspace_id", workspaceId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  }, 60_000);

  it("keeps an Oregon serious-injury crash apart from other injuries", async () => {
    // KABCO A is what a killed-and-serious-injury count needs; the CCRS crash
    // table alone cannot supply it.
    const oregon = await owner.from("safety_crashes").select("severity")
      .eq("workspace_id", workspaceId).eq("source_id", odotOrAdapter.id);
    expect(oregon.error).toBeNull();
    const severities = new Set((oregon.data ?? []).map((row) => row.severity));
    expect(severities.has("severe_injury")).toBe(true);
    expect(severities.has("injury")).toBe(true);
  });

  it("still refuses a source id, coverage state or person row the domains do not admit", async () => {
    const ingest = await service.from("safety_crash_ingests").select("id")
      .eq("workspace_id", workspaceId).eq("source_id", odotOrAdapter.id).limit(1).single();
    expect(ingest.error).toBeNull();
    const ingestId = ingest.data!.id as string;

    // The crash's parent must carry the same source id, or the custody trigger
    // refuses it first. The ingest table's own source_id is unconstrained, so a
    // bogus parent isolates the crash CHECK as the refusal under test.
    const bogusParent = await service.from("safety_crash_ingests").insert({ workspace_id: workspaceId,
      min_lon: -121.15, min_lat: 44.61, max_lon: -121.13, max_lat: 44.625, source_id: "bogus-state",
      source_label: "Synthetic bogus source", attribution: "Synthetic", coverage_state: "state_injury_file",
      severity_completeness: "kabco_full" }).select("id").single();
    expect(bogusParent.error).toBeNull();
    const bogusCrash = await service.from("safety_crashes").insert({ workspace_id: workspaceId,
      ingest_id: bogusParent.data!.id, source_id: "bogus-state", external_id: `bogus-${randomUUID()}`,
      severity: "injury", latitude: 44.6, longitude: -121.1 });
    expect(bogusCrash.error?.code).toBe("23514");
    expect(bogusCrash.error?.message).toContain("safety_crashes_source_id_check");

    const bogusCoverage = await service.from("safety_crash_ingests")
      .update({ coverage_state: "bogus_state_file" }).eq("id", ingestId);
    expect(bogusCoverage.error?.code).toBe("23514");
    expect(bogusCoverage.error?.message).toContain("safety_crash_ingests_coverage_state_check");

    const crash = await service.from("safety_crashes").select("id").eq("ingest_id", ingestId).limit(1).single();
    expect(crash.error).toBeNull();
    const person = await service.from("safety_crash_parties").insert({ workspace_id: workspaceId,
      crash_id: crash.data!.id, ingest_id: ingestId, source_id: odotOrAdapter.id,
      external_party_id: `person-${randomUUID()}`, party_role: "driver", age_band: "unknown" });
    expect(person.error?.code).toBe("23514");
    expect(person.error?.message).toContain("safety_crash_parties_source_id_check");
  });
});
