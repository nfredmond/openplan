import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), "scripts/ops/check-prod-health.mjs");
const servers: ReturnType<typeof createServer>[] = [];

type HealthServerOptions = {
  status?: number;
  headStatus?: number;
  cacheControl?: string;
  payload?: unknown;
};

const healthyPayload = {
  status: "ok",
  service: "openplan",
  checkedAt: "2026-04-24T12:00:00.000Z",
  checks: {
    app: "ok",
    database: "not_checked",
    billing: "not_checked",
  },
};

function writeJson(response: ServerResponse, status: number, cacheControl: string, payload: unknown) {
  response.writeHead(status, {
    "Cache-Control": cacheControl,
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

async function startHealthServer(options: HealthServerOptions = {}) {
  const {
    status = 200,
    headStatus = status,
    cacheControl = "no-store, max-age=0",
    payload = healthyPayload,
  } = options;
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push(request.method ?? "<unknown>");
    if (request.method === "HEAD") {
      response.writeHead(headStatus, { "Cache-Control": cacheControl });
      response.end();
      return;
    }

    writeJson(response, status, cacheControl, payload);
  });

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return {
    requests,
    url: `http://127.0.0.1:${address.port}/api/health`,
  };
}

async function runHealthCheck(url: string) {
  return execFileAsync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENPLAN_HEALTH_URL: url,
    },
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("production health check script", () => {
  it("passes against the expected public health contract", async () => {
    const server = await startHealthServer();

    const result = await runHealthCheck(server.url);

    expect(result.stdout).toContain("OpenPlan health check passed");
    expect(result.stdout).toContain(server.url);
    expect(result.stderr).toBe("");
    expect(server.requests).toEqual(["GET", "HEAD"]);
  });

  it("fails when the endpoint returns a non-200 response", async () => {
    const server = await startHealthServer({ status: 503 });

    await expect(runHealthCheck(server.url)).rejects.toMatchObject({
      stderr: expect.stringContaining("GET /api/health returned non-200 status"),
    });
  });

  it("fails when required payload fields are missing or invalid", async () => {
    const server = await startHealthServer({
      payload: {
        status: "ok",
        service: "wrong-service",
        checks: { app: "ok", database: "not_checked" },
      },
    });

    await expect(runHealthCheck(server.url)).rejects.toMatchObject({
      stderr: expect.stringContaining("GET /api/health returned an unexpected payload"),
    });
  });

  it("fails if the shallow health endpoint starts claiming dependency readiness", async () => {
    const server = await startHealthServer({
      payload: {
        ...healthyPayload,
        checks: {
          app: "ok",
          database: "ok",
          billing: "not_checked",
        },
      },
    });

    await expect(runHealthCheck(server.url)).rejects.toMatchObject({
      stderr: expect.stringContaining('checks.database must stay "not_checked"'),
    });
  });
});
