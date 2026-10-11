// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { managedGtfsRouteSubmission } from "@/lib/gtfs/managed-route";
import { readGtfsSavedSubmission } from "@/lib/gtfs/managed-admission";
import { readGtfsSubmissionStatus } from "@/lib/gtfs/managed-worker-service";
import { readGtfsRequestCancellation } from "@/lib/gtfs/managed-request-cancellation";
vi.mock("@/lib/gtfs/managed-request-cancellation", () => ({ readGtfsRequestCancellation: vi.fn(async () => null) }));
import { runGtfsIngest } from "@/lib/gtfs/ingest";
import { POST as create } from "@/app/api/gtfs/feeds/route";
import { POST as upload } from "@/app/api/gtfs/feeds/upload/route";
import { POST as refresh } from "@/app/api/gtfs/feeds/[feedId]/refresh/route";
import { GET as status, POST as recover } from "@/app/api/gtfs/submissions/[requestId]/route";
const mocks = vi.hoisted(() => ({ user: "e9000000-0000-4000-8000-000000000002" as string | null, role: "member" as string | null, membershipError: null as { message: string } | null, projections: [] as string[], filters: [] as [string, string][], service: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user ? { id: mocks.user } : null } }) }, from: () => {
  const query = { select: (value: string) => { mocks.projections.push(value); return query; }, eq: (field: string, value: string) => { mocks.filters.push([field, value]); return query; }, maybeSingle: async () => ({ data: mocks.role === null ? null : { role: mocks.role }, error: mocks.membershipError }) }; return query;
} }), createServiceRoleClient: () => mocks.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/gtfs/managed-route", async original => ({ ...await original<typeof import("@/lib/gtfs/managed-route")>(), managedGtfsRouteSubmission: vi.fn() }));
vi.mock("@/lib/gtfs/managed-admission", async original => ({ ...await original<typeof import("@/lib/gtfs/managed-admission")>(), readGtfsSavedSubmission: vi.fn() }));
vi.mock("@/lib/gtfs/managed-worker-service", async original => ({ ...await original<typeof import("@/lib/gtfs/managed-worker-service")>(), readGtfsSubmissionStatus: vi.fn() }));
vi.mock("@/lib/gtfs/ingest", async original => ({ ...await original<typeof import("@/lib/gtfs/ingest")>(), runGtfsIngest: vi.fn() }));
const id = (n: number) => `e9000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { params: Promise.resolve({ requestId: id(3) }) }, workspaceId = id(1), userId = id(2), feedId = id(4), target = "http://127.0.0.1:54321";
const submission = vi.mocked(managedGtfsRouteSubmission), saved = vi.mocked(readGtfsSavedSubmission), readStatus = vi.mocked(readGtfsSubmissionStatus);
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://127.0.0.1:3210${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-openplan-gtfs-request-id": id(3), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
 vi.mocked(readGtfsRequestCancellation).mockResolvedValue(null);
 vi.stubEnv("OPENPLAN_GTFS_MANAGED_INGESTION", "1"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", target); vi.stubEnv("OPENPLAN_GTFS_INSTALLATION_ID", id(8)); vi.stubEnv("OPENPLAN_GTFS_PARSER_BUILD", "a".repeat(40)); vi.stubEnv("OPENPLAN_GTFS_WORK_DIR", "/private/synthetic/worker");
 mocks.user = userId; mocks.role = "member"; mocks.membershipError = null; mocks.projections = []; mocks.filters = [];
 submission.mockImplementation(async () => NextResponse.json({ managed: true, requestId: id(3), feedId, versionId: id(5), createdFeed: true, detail: "Synthetic queue handoff", caveats: [],
   status: { schemaVersion: 1 as const, workspaceId, requestId: id(3), feedId, versionId: id(5), state: "queued" as const, stage: "pending" as const, attempts: 0, leaseUntil: null, archiveConfirmed: false, submittedAt: "2026-10-10T12:00:00Z", isCurrent: false, failureCode: null, failureDetail: null, submitterAccessUnavailable: false } }, { status: 202 }));
 saved.mockResolvedValue({ binding: { schemaVersion: 1, installationId: id(8), target, requestId: id(3), workspaceId, actorId: userId, intent: { source: "url", workspaceId, url: "https://example.invalid/original.zip" } }, resolved: null, archive: null, response: null });
 readStatus.mockResolvedValue(null);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
async function invoke(kind: string) {
 if (kind === "url") return create(request("/api/gtfs/feeds", { source: "url", workspaceId, url: "https://example.invalid/original.zip" }));
 if (kind === "catalog") return create(request("/api/gtfs/feeds", { source: "catalog", workspaceId, catalogId: "saved-id" }));
 if (kind === "refresh") return refresh(request(`/api/gtfs/feeds/${feedId}/refresh`, { workspaceId }), { params: Promise.resolve({ feedId }) });
 if (kind === "recover") return recover(request(`/api/gtfs/submissions/${id(3)}`, { workspaceId }), context);
 return upload(new NextRequest(`http://127.0.0.1:3210/api/gtfs/feeds/upload?workspaceId=${workspaceId}&filename=agency.zip`, { method: "POST", headers: { "content-type": "application/zip", "x-openplan-gtfs-request-id": id(3) }, body: new Uint8Array([1, 2, 3]) }));
}
describe("managed transit enrollment routes", () => {
 it.each(["url", "catalog", "upload", "refresh", "recover"])("enrolls %s only after current session membership and writer authorization", async kind => {
  expect((await invoke(kind)).status).toBe(202); expect(submission).toHaveBeenCalledTimes(1); expect(submission.mock.calls[0][1]).toMatchObject({ workspaceId, actorId: userId, service: mocks.service });
  expect(mocks.projections).toEqual(["role"]); expect(mocks.filters).toEqual([["workspace_id", workspaceId], ["user_id", userId]]); expect(runGtfsIngest).not.toHaveBeenCalled(); expect(mocks.service.from).not.toHaveBeenCalled();
  if (kind === "upload") expect(submission.mock.calls[0][1].upload).toEqual(new Uint8Array([1, 2, 3]));
 });
 it.each(["url", "catalog", "upload", "refresh", "recover"])("refuses viewer %s enrollment before retaining input", async kind => { mocks.role = "viewer"; expect((await invoke(kind)).status).toBe(403); expect(submission).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled(); });
 it.each(["url", "upload", "refresh", "recover"])("refuses unauthenticated %s enrollment", async kind => { mocks.user = null; expect((await invoke(kind)).status).toBe(401); expect(submission).not.toHaveBeenCalled(); });
 it.each(["url", "upload", "refresh", "recover"])("refuses missing membership %s enrollment", async kind => { mocks.role = null; expect((await invoke(kind)).status).toBe(404); expect(submission).not.toHaveBeenCalled(); });
 it("refuses unknown refresh adoption before seeing a completed version", async () => {
  expect((await refresh(request(`/api/gtfs/feeds/${feedId}/refresh`, { workspaceId, adoptDespiteCollapse: true }), { params: Promise.resolve({ feedId }) })).status).toBe(409); expect(submission).not.toHaveBeenCalled();
 });
 it("keeps a refused upload MIME type outside retained submission custody", async () => {
  const req = new NextRequest(`http://127.0.0.1:3210/api/gtfs/feeds/upload?workspaceId=${workspaceId}`, { method: "POST", headers: { "content-type": "text/plain" }, body: "wrong type" });
  expect((await upload(req)).status).toBe(415); expect(submission).not.toHaveBeenCalled();
 });
 it("refuses empty uploaded bytes before retaining input", async () => { expect((await upload(new NextRequest(`http://127.0.0.1:3210/api/gtfs/feeds/upload?workspaceId=${workspaceId}&filename=agency.zip`, { method: "POST", headers: { "content-type": "application/zip" }, body: "" }))).status).toBe(400); expect(submission).not.toHaveBeenCalled(); });
 it("refuses recovery whose header identifies another request", async () => { expect((await recover(request(`/api/gtfs/submissions/${id(3)}`, { workspaceId }, { "x-openplan-gtfs-request-id": id(90) }), context)).status).toBe(400); expect(saved).not.toHaveBeenCalled(); expect(submission).not.toHaveBeenCalled(); });
 it.each(["actorId", "workspaceId", "requestId", "installationId", "target"] as const)("refuses retained recovery with changed %s", async field => {
  const normal = await saved("unused"); saved.mockResolvedValue({ ...normal, binding: { ...normal.binding, [field]: field === "target" ? "http://other.invalid" : id(90) } });
  expect((await invoke("recover")).status).toBe(404); expect(submission).not.toHaveBeenCalled();
 });
 it("returns unavailable retained bytes as unconfirmed without private errors", async () => { saved.mockRejectedValue(new Error("Private filesystem detail")); const result = await invoke("recover"); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain("Private filesystem detail"); expect(submission).not.toHaveBeenCalled(); });
 it("refuses disabled managed recovery without reading private records", async () => { vi.stubEnv("OPENPLAN_GTFS_MANAGED_INGESTION", "0"); expect((await invoke("recover")).status).toBe(409); expect(saved).not.toHaveBeenCalled(); });
 it("allows a viewer to read unconfirmed status with the authenticated actor", async () => {
  mocks.role = "viewer"; const req = request(`/api/gtfs/submissions/${id(3)}?workspaceId=${workspaceId}`), result = await status(req, context);
  expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ managed: true, requestId: id(3), status: null });
  expect(readStatus).toHaveBeenCalledWith(mocks.service, { workspaceId, requestId: id(3), actorId: userId }, req.signal);
 });
 it("shows a committed early cancellation separately from missing version status", async () => {
  const cancellation = { command: id(8), requestId: id(3), workspaceId, state: "cancelled" as const, versionId: null, versionCancellation: null, cancelledAt: "2026-10-10T12:00:00Z" };
  vi.mocked(readGtfsRequestCancellation).mockResolvedValue(cancellation);
  const req = request(`/api/gtfs/submissions/${id(3)}?workspaceId=${workspaceId}`), result = await status(req, context), body = await result.json();
  expect(body).toMatchObject({ status: null, cancellation }); expect(body).not.toHaveProperty("detail");
  expect(readGtfsRequestCancellation).toHaveBeenCalledWith(mocks.service, { workspaceId, requestId: id(3), actorId: userId }, req.signal);
 });
 it("does not invent an absent cancellation when its lookup is unavailable", async () => { vi.mocked(readGtfsRequestCancellation).mockRejectedValue(new Error("Private cancellation evidence")); const result = await status(request(`/api/gtfs/submissions/${id(3)}?workspaceId=${workspaceId}`), context); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain("Private cancellation evidence"); expect(readStatus).not.toHaveBeenCalled(); });
 it("does not read status for a nonmember", async () => { mocks.role = null; expect((await status(request(`/api/gtfs/submissions/${id(3)}?workspaceId=${workspaceId}`), context)).status).toBe(404); expect(readStatus).not.toHaveBeenCalled(); });
 it("keeps unavailable status distinct from a missing committed submission", async () => { readStatus.mockRejectedValue(new Error("Private database detail")); const result = await status(request(`/api/gtfs/submissions/${id(3)}?workspaceId=${workspaceId}`), context); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain("Private database detail"); });
});
