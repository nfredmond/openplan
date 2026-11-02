import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import {
  AI_RATE_LIMIT_MAX_PER_WINDOW,
  AI_RATE_LIMIT_WINDOW_SECONDS,
  AiUsageMeterUnavailableError,
  reserveAiUsage,
} from "@/lib/runtime/ai-rate-limit";

/**
 * Migration 20261102110000: `reserve_ai_usage` counts and records under the
 * workspace dispatch lock, so parallel reservations admit exactly the window's
 * limit. Real PostgREST requests through the service-role client the app uses,
 * fired at once. The shared deployment key is stubbed as the payer, so any
 * failure of the function throws instead of falling back to the unlocked path.
 * This does not run a route or a provider call.
 */
(LIVE_RLS ? describe : describe.skip)("atomic AI usage reservation", () => {
  let container: string;
  let service: SupabaseClient;
  let anon: SupabaseClient;
  const workspaces: string[] = [];

  function psql(statement: string): string {
    return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000,
    }).trim();
  }

  /** A committed synthetic workspace in the disposable stack, removed in afterAll. */
  function workspace(): string {
    const id = randomUUID();
    psql(`INSERT INTO public.workspaces(id,name,slug) VALUES('${id}','Synthetic AI meter','${id}')`);
    workspaces.push(id);
    return id;
  }

  const recorded = (id: string) => Number(psql(`SELECT count(*) FROM public.usage_events WHERE workspace_id='${id}'`));

  function reserve(workspaceId: string, index: number, bucketKey = "grant_narrative_draft") {
    return reserveAiUsage({
      workspaceId,
      bucketKey,
      eventKey: `live-reservation-${index}`,
      sourceRoute: "/live-test/reserve",
      metadataJson: { index },
      serviceSupabase: service as never,
    });
  }

  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Select an explicit isolated Supabase workdir for AI meter fixtures.");
    }
    container = resolveLocalDbContainer();
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "ai-meter-service");
    anon = liveClient(env.API_URL, env.ANON_KEY, "ai-meter-anon");
  });

  // The config unstubs env before every test, so the payer is set per test.
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-live-test-shared-key-placeholder");
  });

  afterAll(() => {
    if (workspaces.length > 0) psql(`DELETE FROM public.workspaces WHERE id IN (${workspaces.map((id) => `'${id}'`).join(",")})`);
  });

  it("admits exactly the limit from twice as many parallel reservations", async () => {
    const id = workspace();
    const attempts = AI_RATE_LIMIT_MAX_PER_WINDOW * 2;
    const results = await Promise.all(Array.from({ length: attempts }, (_, index) => reserve(id, index)));

    const admitted = results.filter((result) => result.allowed);
    const refused = results.filter((result) => !result.allowed);
    expect(admitted).toHaveLength(AI_RATE_LIMIT_MAX_PER_WINDOW);
    expect(refused).toHaveLength(attempts - AI_RATE_LIMIT_MAX_PER_WINDOW);
    // Serialized: each admitted reservation saw a different prior count.
    expect(admitted.map((result) => result.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: AI_RATE_LIMIT_MAX_PER_WINDOW }, (_, index) => index),
    );
    // The refusal shape the routes turn into a 429 with retry-after.
    for (const result of refused) {
      expect(result).toEqual({ allowed: false, count: AI_RATE_LIMIT_MAX_PER_WINDOW, retryAfterSeconds: AI_RATE_LIMIT_WINDOW_SECONDS });
    }
    expect(recorded(id)).toBe(AI_RATE_LIMIT_MAX_PER_WINDOW);
    expect(psql(`SELECT count(DISTINCT event_key)||'|'||bool_and(bucket_key='grant_narrative_draft' AND weight=1 AND source_route='/live-test/reserve'
      AND metadata_json ? 'index' AND idempotency_key IS NULL) FROM public.usage_events WHERE workspace_id='${id}'`)).toBe(`${AI_RATE_LIMIT_MAX_PER_WINDOW}|true`);
  }, 60_000);

  it("waits on the same workspace lock the SQL dispatchers hold, then admits only the room left", async () => {
    const id = workspace();
    const preexisting = AI_RATE_LIMIT_MAX_PER_WINDOW - 3;
    psql(`INSERT INTO public.usage_events(workspace_id,event_key,bucket_key,weight) SELECT '${id}','seed-'||g,'assistant_chat',1 FROM generate_series(1,${preexisting}) g`);

    // A dispatcher-shaped holder of 'assistant_api_dispatch:' || workspace_id.
    const holder = spawn("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { stdio: ["pipe", "pipe", "pipe"] });
    let held = "";
    const locked = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Lock holder never reported: ${held}`)), 10_000);
      holder.stdout.on("data", (chunk) => { held += chunk.toString(); if (held.includes("HOLDING")) { clearTimeout(timer); resolve(); } });
      holder.stderr.on("data", (chunk) => { held += chunk.toString(); });
    });
    const closed = new Promise<void>((resolve) => holder.on("close", () => resolve()));
    holder.stdin.write(`SELECT pg_advisory_lock(hashtextextended('assistant_api_dispatch:${id}',0)); SELECT 'HOLDING';\n`);
    await locked;

    const attempts = 8;
    const pending = Promise.all(Array.from({ length: attempts }, (_, index) => reserve(id, index, "document_narrative_draft")));
    let waiting = 0;
    for (let poll = 0; poll < 40 && waiting < 2; poll++) {
      waiting = Number(psql(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%reserve_ai_usage%'`));
      if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Nothing is admitted while another holder has the workspace lock.
    const whileHeld = recorded(id);
    holder.stdin.end(`SELECT pg_advisory_unlock(hashtextextended('assistant_api_dispatch:${id}',0));\n`);
    await closed;
    const results = await pending;

    expect(waiting).toBeGreaterThanOrEqual(2);
    expect(whileHeld).toBe(preexisting);
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(recorded(id)).toBe(AI_RATE_LIMIT_MAX_PER_WINDOW);
  }, 60_000);

  it("refuses a bucket outside the counted set instead of recording uncounted spend", async () => {
    const id = workspace();
    await expect(reserve(id, 0, "engagement_public_translation")).rejects.toBeInstanceOf(AiUsageMeterUnavailableError);
    expect(recorded(id)).toBe(0);
  });

  it("is callable by the service role only", async () => {
    const id = workspace();
    const { data, error } = await anon.rpc("reserve_ai_usage", {
      p_workspace_id: id, p_bucket_keys: ["assistant_chat"], p_max_per_window: 20, p_window_seconds: 300,
      p_bucket_key: "assistant_chat", p_event_key: "anon-probe", p_source_route: null, p_metadata: {},
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(recorded(id)).toBe(0);
    expect(psql(`SELECT string_agg(r||'='||has_function_privilege(r,'public.reserve_ai_usage(uuid,text[],integer,integer,text,text,text,jsonb)','EXECUTE')::text,',' ORDER BY r)
      FROM unnest(ARRAY['anon','authenticated','service_role']) r`)).toBe("anon=false,authenticated=false,service_role=true");
    expect(psql(`SELECT prosecdef::text||'|'||array_to_string(proconfig,';') FROM pg_proc WHERE oid='public.reserve_ai_usage(uuid,text[],integer,integer,text,text,text,jsonb)'::regprocedure`))
      .toBe('false|search_path="";lock_timeout=5s');
  });
});
