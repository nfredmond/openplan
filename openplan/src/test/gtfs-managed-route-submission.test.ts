// @vitest-environment node
import { createHash } from "node:crypto";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { managedGtfsEnabled, managedGtfsRequestDirectory, managedGtfsRouteSubmission, GtfsSourceResolutionError } from "@/lib/gtfs/managed-route";
import { admitGtfsSubmission } from "@/lib/gtfs/managed-admission";
vi.mock("@/lib/gtfs/managed-admission", () => ({ admitGtfsSubmission: vi.fn() }));
const admit = vi.mocked(admitGtfsSubmission), id = (n: number) => `ed000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = { OPENPLAN_GTFS_MANAGED_INGESTION: "1", OPENPLAN_GTFS_INSTALLATION_ID: id(8), OPENPLAN_GTFS_WORK_DIR: "/private/synthetic/worker",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "synthetic-key", OPENPLAN_GTFS_PARSER_BUILD: "a".repeat(40) };
const status = { schemaVersion: 1 as const, workspaceId: id(2), requestId: id(1), feedId: id(3), versionId: id(4), state: "queued" as const, stage: "pending" as const,
  attempts: 0, leaseUntil: null, archiveConfirmed: false, submittedAt: "2026-10-10T12:00:00Z", isCurrent: false, failureCode: null, failureDetail: null, submitterAccessUnavailable: false };
const options = { workspaceId: id(2), actorId: id(5), intent: { source: "url", url: "https://example.invalid/feed.zip" },
  resolve: vi.fn(async () => ({ feedId: null, source: { kind: "url" as const, provisionalName: "URL feed", sourceUrl: "https://example.invalid/feed.zip", normalizedSourceUrl: "https://example.invalid/feed.zip" } })), service: { rpc: vi.fn(), storage: {} } as unknown as Parameters<typeof admitGtfsSubmission>[0]["service"] };
const request = (identity: string | null = id(1)) => new NextRequest("http://127.0.0.1:3210/api/gtfs/feeds", { method: "POST", ...(identity ? { headers: { "x-openplan-gtfs-request-id": identity } } : {}) });
afterEach(() => vi.clearAllMocks());
describe("managed GTFS route submission", () => {
  it("refuses agent submissions before admission when async action custody is unavailable", async () => {
    const req = request(); req.headers.set("x-openplan-assistant-execution-source", "planner_agent_quick_link");
    const result = await managedGtfsRouteSubmission(req, options, env); expect(result.status).toBe(403); expect(admit).not.toHaveBeenCalled();
  });
  it("uses an explicit operational switch and refuses unknown configuration", () => {
    expect(managedGtfsEnabled({})).toBe(false); expect(managedGtfsEnabled({ OPENPLAN_GTFS_MANAGED_INGESTION: "0" })).toBe(false); expect(managedGtfsEnabled(env)).toBe(true);
    expect(() => managedGtfsEnabled({ OPENPLAN_GTFS_MANAGED_INGESTION: "true" })).toThrow("configuration is invalid");
  });
  it("places request files beside the target-bound version queue", () => {
    const digest = createHash("sha256").update(env.NEXT_PUBLIC_SUPABASE_URL).digest("hex");
    expect(managedGtfsRequestDirectory(id(1).toUpperCase(), env)).toMatchObject({ installationId: id(8), target: env.NEXT_PUBLIC_SUPABASE_URL,
      directory: join(env.OPENPLAN_GTFS_WORK_DIR, `${digest}-submissions`, id(1)) });
    expect(() => managedGtfsRequestDirectory("invalid", env)).toThrow();
  });
  it("reports queued processing separately from completion and adoption", async () => {
    admit.mockResolvedValue({ registration: { requestId: id(1), feedId: id(3), versionId: id(4), createdFeed: true }, status });
    const req = request(), result = await managedGtfsRouteSubmission(req, options, env); expect(result.status).toBe(202);
    const body = await result.json(); expect(body.managed).toBe(true); expect(body.status).toEqual(status); expect(body).not.toHaveProperty("adoption"); expect(body.caveats).toHaveLength(4);
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ ...options, requestId: id(1), signal: req.signal, installationId: id(8), serviceKey: "synthetic-key", env }));
  });
  it("reports ready as a reviewable version without claiming adoption", async () => {
    admit.mockResolvedValue({ registration: { requestId: id(1), feedId: id(3), versionId: id(4), createdFeed: true }, status: { ...status, state: "ready", stage: "ready", archiveConfirmed: true } });
    const result = await managedGtfsRouteSubmission(request(), options, env); expect(result.status).toBe(200); expect((await result.json()).detail).toContain("before adopting");
  });
  it.each([null, "invalid", `${id(1)},${id(2)}`])("requires a retained valid request UUID %s before admission", async value => {
    const result = await managedGtfsRouteSubmission(request(value), options, env); expect(result.status).toBe(400); expect(admit).not.toHaveBeenCalled();
  });
  it("retains request identity when admission outcome is unavailable", async () => {
    admit.mockRejectedValue(new Error("Synthetic private source must not leak"));
    const result = await managedGtfsRouteSubmission(request(), options, env); expect(result.status).toBe(503); const body = await result.json();
    expect(body).toMatchObject({ error: "Import submission is unconfirmed", requestId: id(1) }); expect(JSON.stringify(body)).not.toContain("Synthetic private source"); expect(body).not.toHaveProperty("versionId");
  });
  it("preserves an identified source refusal instead of inventing an admitted version", async () => {
    admit.mockRejectedValue(new GtfsSourceResolutionError(422, { error: "No public download", reason: "requires_api_key" }));
    const result = await managedGtfsRouteSubmission(request(), options, env); expect(result.status).toBe(422); expect(await result.json()).toEqual({ error: "No public download", reason: "requires_api_key", requestId: id(1) });
  });
  it("refuses missing installation configuration before admission", async () => {
    const result = await managedGtfsRouteSubmission(request(), options, { ...env, OPENPLAN_GTFS_INSTALLATION_ID: undefined }); expect(result.status).toBe(503); expect(admit).not.toHaveBeenCalled();
  });
});
