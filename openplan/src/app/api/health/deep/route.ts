import { NextRequest, NextResponse } from "next/server";
import { timingSafeSecretEquals } from "@/lib/http/secret-compare";
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from "@/lib/models/worker-health";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { parseNodeQueueObservation } from "@/lib/ops/node-queue-observation-reader";
import { expectedMigrations } from "@/lib/ops/migration-manifest";
import { APP_VERSION, appCommitSha } from "@/lib/runtime/app-version";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const CHECK_TIMEOUT_MS = 8_000;

type CheckResult = { state: "ok" | "failed"; ms: number };

function safeCommitSha(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !/^[a-f0-9]{7,40}$/i.test(trimmed)) return "unknown";
  return trimmed.slice(0, 12).toLowerCase();
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function probeClient(signal: AbortSignal) {
  return createServiceRoleClient({ fetchImpl: async (input, init) => {
    signal.throwIfAborted();
    const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const active = inherited ? AbortSignal.any([signal, inherited]) : signal;
    active.throwIfAborted();
    return fetch(input, { ...init, signal: active });
  } });
}

async function timed<T>(work: (signal: AbortSignal) => PromiseLike<T>, caller: AbortSignal): Promise<{ value: T | null; ms: number; timedOut: boolean }> {
  const started = Date.now();
  const ending = new AbortController();
  const signal = AbortSignal.any([ending.signal, caller]);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve("timeout");
    }, CHECK_TIMEOUT_MS);
  });
  try {
    signal.throwIfAborted();
    const outcome = await Promise.race([Promise.resolve(work(signal)), timeout]);
    if (outcome === "timeout") return { value: null, ms: Date.now() - started, timedOut: true };
    return { value: outcome as T, ms: Date.now() - started, timedOut };
  } catch {
    return { value: null, ms: Date.now() - started, timedOut };
  } finally {
    clearTimeout(timer);
    ending.abort();
  }
}

/**
 * The operator's health check: one database read, one Storage read, the age of
 * each modeling worker's heartbeat, separate Node process observations, and every migration this build expects.
 *
 * It is off unless OPENPLAN_HEALTH_TOKEN is set, and then answers only a
 * matching bearer token, because it touches the database on every call and
 * names the deployment's workers. The public /api/health stays cheap.
 *
 * It cannot report which migrations the database has applied: that history is
 * not exposed through the Data API, and reading it would need a new database
 * function. The scheduled Production Health workflow reads it through the
 * Supabase Management API and compares the two sets. Raw provider errors are
 * not echoed; a failed check says only that it failed.
 */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("health.deep", request);
  const expectedToken = process.env.OPENPLAN_HEALTH_TOKEN?.trim();
  if (!expectedToken) {
    return NextResponse.json(
      { error: "Deep health is off on this deployment. Set OPENPLAN_HEALTH_TOKEN to turn it on." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  if (!timingSafeSecretEquals(bearerToken(request), expectedToken)) {
    audit.warn("deep_health_unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const now = Date.now();
  const heartbeats = await timed((signal) => probeClient(signal)
    .from("modeling_worker_heartbeats")
    .select("worker_kind,last_successful_heartbeat_at")
    .then(({ data, error }) => (error ? null : (data ?? []))), request.signal);
  const buckets = await timed((signal) => probeClient(signal).storage.listBuckets()
    .then(({ data, error }) => (error ? null : (data ?? []))), request.signal);

  const processes = await timed((signal) => probeClient(signal).rpc("read_node_queue_process_observations")
    .then(({ data, error }) => error ? null : parseNodeQueueObservation(data)), request.signal);

  const database: CheckResult = { state: heartbeats.value ? "ok" : "failed", ms: heartbeats.ms };
  const storage: CheckResult & { buckets?: number } = buckets.value
    ? { state: "ok", ms: buckets.ms, buckets: buckets.value.length }
    : { state: "failed", ms: buckets.ms };

  const workers = (heartbeats.value ?? []).map((row) => {
    const at = row.last_successful_heartbeat_at ? Date.parse(row.last_successful_heartbeat_at) : NaN;
    const ageSeconds = Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 1000)) : null;
    return {
      kind: String(row.worker_kind),
      ageSeconds,
      fresh: ageSeconds !== null && ageSeconds * 1000 <= WORKER_HEARTBEAT_STALE_AFTER_MS,
    };
  });

  const migrations = expectedMigrations();
  const ok = database.state === "ok" && storage.state === "ok" && processes.value !== null;
  if (!ok) audit.warn("deep_health_failed", { database: database.state, storage: storage.state, nodeProcesses: processes.value ? "ok" : "failed" });

  return NextResponse.json(
    {
      status: ok ? "ok" : "failed",
      service: "openplan",
      checkedAt: new Date(now).toISOString(),
      deployment: { commit: safeCommitSha(appCommitSha()), version: APP_VERSION },
      checks: {
        database,
        storage,
        nodeQueueProcesses: processes.value
          ? { state: "ok", ms: processes.ms, ...processes.value }
          : { state: "failed", ms: processes.ms, scope: "process_only", jobCompletion: "unassessed" },
        // Process observations and model capabilities remain separate from job completion.
        modelingWorkers: workers,
      },
      migrations: {
        expected: migrations,
        applied: "not_checked",
      },
    },
    { status: ok ? 200 : 503, headers: NO_STORE_HEADERS },
  );
}
