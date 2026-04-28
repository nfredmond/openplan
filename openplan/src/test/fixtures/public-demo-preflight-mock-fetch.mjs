import { appendFileSync } from "node:fs";

const DEFAULT_HEALTH_CACHE_CONTROL = "no-store, max-age=0";
const DEFAULT_HEALTH_PAYLOAD = {
  status: "ok",
  service: "openplan",
  checkedAt: "2026-04-27T12:00:00.000Z",
  checks: {
    app: "ok",
    database: "not_checked",
    billing: "not_checked",
  },
};
const DEFAULT_REQUEST_ACCESS_HTML = [
  "<!doctype html>",
  "<html>",
  "<body>",
  "<main>",
  "<h1>Start a supervised OpenPlan workspace review.</h1>",
  '<section id="request-access-form">Request access form</section>',
  "<p>No auto-send</p>",
  "</main>",
  "</body>",
  "</html>",
].join("");
const DEFAULT_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://*.mapbox.com https://*.tiles.mapbox.com https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com",
  "worker-src 'self' blob:",
].join("; ");

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

function responseForHealth(method) {
  const getStatus = readNumberEnv("OPENPLAN_PUBLIC_DEMO_MOCK_HEALTH_STATUS", 200);
  const status =
    method === "HEAD"
      ? readNumberEnv("OPENPLAN_PUBLIC_DEMO_MOCK_HEALTH_HEAD_STATUS", getStatus)
      : getStatus;
  const payload = readJsonEnv("OPENPLAN_PUBLIC_DEMO_MOCK_HEALTH_PAYLOAD", DEFAULT_HEALTH_PAYLOAD);

  return new Response(method === "HEAD" ? null : JSON.stringify(payload), {
    status,
    statusText: status === 200 ? "OK" : "Service Unavailable",
    headers: {
      "Cache-Control": process.env.OPENPLAN_PUBLIC_DEMO_MOCK_HEALTH_CACHE_CONTROL ?? DEFAULT_HEALTH_CACHE_CONTROL,
      "Content-Type": "application/json",
    },
  });
}

function responseForRequestAccess() {
  const status = readNumberEnv("OPENPLAN_PUBLIC_DEMO_MOCK_REQUEST_ACCESS_STATUS", 200);
  return new Response(process.env.OPENPLAN_PUBLIC_DEMO_MOCK_REQUEST_ACCESS_HTML ?? DEFAULT_REQUEST_ACCESS_HTML, {
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    headers: {
      "Content-Type": process.env.OPENPLAN_PUBLIC_DEMO_MOCK_REQUEST_ACCESS_CONTENT_TYPE ?? "text/html; charset=utf-8",
    },
  });
}

function responseForBillingReadiness() {
  const status = readNumberEnv("OPENPLAN_PUBLIC_DEMO_MOCK_BILLING_READINESS_STATUS", 405);
  const headers = {
    "Content-Type": "application/json",
  };
  const allow = process.env.OPENPLAN_PUBLIC_DEMO_MOCK_BILLING_READINESS_ALLOW ?? "POST";
  if (allow) headers.Allow = allow;

  return new Response(JSON.stringify({ error: status === 200 ? "public" : "Method Not Allowed" }), {
    status,
    statusText: status === 405 ? "Method Not Allowed" : status === 200 ? "OK" : "Unauthorized",
    headers,
  });
}

function responseForRoot(method) {
  const headStatus = readNumberEnv("OPENPLAN_PUBLIC_DEMO_MOCK_ROOT_HEAD_STATUS", 200);
  const status = method === "HEAD" ? headStatus : readNumberEnv("OPENPLAN_PUBLIC_DEMO_MOCK_ROOT_STATUS", 200);
  const csp = process.env.OPENPLAN_PUBLIC_DEMO_MOCK_CSP ?? DEFAULT_CSP;
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
  };
  if (csp) headers["Content-Security-Policy"] = csp;

  return new Response(method === "HEAD" ? null : "<!doctype html><html><body>OpenPlan</body></html>", {
    status,
    statusText: status === 200 ? "OK" : "Method Not Allowed",
    headers,
  });
}

globalThis.fetch = async function mockPublicDemoPreflightFetch(url, init = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  const parsed = new URL(String(url));
  const callsPath = process.env.OPENPLAN_PUBLIC_DEMO_MOCK_CALLS_PATH;
  if (callsPath) {
    appendFileSync(callsPath, `${method} ${parsed.pathname}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  if (parsed.pathname === "/api/health") return responseForHealth(method);
  if (parsed.pathname === "/request-access") return responseForRequestAccess();
  if (parsed.pathname === "/api/billing/readiness") return responseForBillingReadiness();
  if (parsed.pathname === "/") return responseForRoot(method);

  return new Response("not found", { status: 404, statusText: "Not Found" });
};
