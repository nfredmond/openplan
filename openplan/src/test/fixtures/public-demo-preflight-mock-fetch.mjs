import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_HEALTH_CACHE_CONTROL = "no-store, max-age=0";
const DEFAULT_HEALTH_PAYLOAD = {
  status: "ok",
  service: "openplan",
  checkedAt: "2026-04-27T12:00:00.000Z",
  checks: {
    app: "ok",
    database: "not_checked",
  },
};
const DEFAULT_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://*.mapbox.com https://*.tiles.mapbox.com https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com",
  "worker-src 'self' blob:",
].join("; ");

const EXAMPLES_PAGE_FILE = path.join(process.cwd(), "src", "app", "(public)", "examples", "page.tsx");
const EXAMPLES_DATA_DIR = path.join(process.cwd(), "src", "lib", "examples");

/**
 * The text a deployed /examples page could actually contain, read from the page
 * itself.
 *
 * WHY THIS IS NOT A HAND-WRITTEN STRING. It used to be, and that was the bug:
 * this fixture spelled out, by hand, exactly the markers
 * `check-public-demo-preflight.mjs` asserts — including four that had not
 * existed in the product for months. The check therefore passed forever in CI
 * while being guaranteed to FAIL against any real deployment, because the only
 * page it had ever been run against was this file. A mock that manufactures the
 * assertion's own expected output does not test the assertion; it tests itself.
 *
 * So the fixture now serves the page's own source, plus the example data
 * modules the page imports (found by following its imports rather than naming
 * them, so a new or renamed example needs no edit here). Whitespace is collapsed
 * because JSX collapses it too — source text wrapped across lines renders as one
 * line, and the markers are written the way the page reads, not the way it is
 * indented.
 *
 * This is deliberately an APPROXIMATION of the rendered page: it proves the
 * strings the check demands are really in the product, which is the drift the
 * check could not see before. It does not prove the deployment serves them —
 * only running the preflight against a real origin does that.
 */
export function renderedExamplesPageApproximation() {
  const page = readFileSync(EXAMPLES_PAGE_FILE, "utf8");
  const importedExamples = [...page.matchAll(/from\s+"@\/lib\/examples\/([^"]+)"/g)]
    .map((match) => path.join(EXAMPLES_DATA_DIR, `${match[1]}.ts`))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, "utf8"));

  return [page, ...importedExamples].join("\n").replace(/\s+/g, " ");
}

function defaultExamplesHtml() {
  return `<!doctype html><html><body><main>${renderedExamplesPageApproximation()}</main></body></html>`;
}

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

function responseForExamples() {
  const status = readNumberEnv("OPENPLAN_PUBLIC_DEMO_MOCK_EXAMPLES_STATUS", 200);
  return new Response(process.env.OPENPLAN_PUBLIC_DEMO_MOCK_EXAMPLES_HTML ?? defaultExamplesHtml(), {
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    headers: {
      "Content-Type": process.env.OPENPLAN_PUBLIC_DEMO_MOCK_EXAMPLES_CONTENT_TYPE ?? "text/html; charset=utf-8",
    },
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
  if (parsed.pathname === "/examples") return responseForExamples();
  if (parsed.pathname === "/") return responseForRoot(method);

  return new Response("not found", { status: 404, statusText: "Not Found" });
};
