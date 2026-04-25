import { appendFileSync } from "node:fs";

const DEFAULT_CACHE_CONTROL = "no-store, max-age=0";
const DEFAULT_PAYLOAD = {
  status: "ok",
  service: "openplan",
  checkedAt: "2026-04-24T12:00:00.000Z",
  checks: {
    app: "ok",
    database: "not_checked",
    billing: "not_checked",
  },
};

function readJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  return JSON.parse(value);
}

function readNumberEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

globalThis.fetch = async function mockHealthFetch(url, init = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  const callsPath = process.env.OPENPLAN_HEALTH_MOCK_CALLS_PATH;
  if (callsPath) {
    appendFileSync(callsPath, `${method} ${String(url)}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  const getStatus = readNumberEnv("OPENPLAN_HEALTH_MOCK_STATUS", 200);
  const status = method === "HEAD" ? readNumberEnv("OPENPLAN_HEALTH_MOCK_HEAD_STATUS", getStatus) : getStatus;
  const cacheControl = process.env.OPENPLAN_HEALTH_MOCK_CACHE_CONTROL ?? DEFAULT_CACHE_CONTROL;
  const payload = readJsonEnv("OPENPLAN_HEALTH_MOCK_PAYLOAD", DEFAULT_PAYLOAD);

  return new Response(method === "HEAD" ? null : JSON.stringify(payload), {
    status,
    statusText: status === 200 ? "OK" : "Service Unavailable",
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": "application/json",
    },
  });
};
