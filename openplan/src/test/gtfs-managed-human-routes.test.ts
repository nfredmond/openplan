// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeGtfsHumanCommand, readGtfsAdoptionReview } from "@/lib/gtfs/managed-human-command";
import { cancelGtfsRequest } from "@/lib/gtfs/managed-request-cancellation";
import { managedGtfsHumanDirectory } from "@/lib/gtfs/managed-human-route";
import { POST as cancel } from "@/app/api/gtfs/submissions/[requestId]/cancel/route";
import { GET as review } from "@/app/api/gtfs/versions/[versionId]/review/route";
import { POST as adopt } from "@/app/api/gtfs/versions/[versionId]/adopt/route";
const id = (n: number) => `e5000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mocks = vi.hoisted(() => ({ user: "e5000000-0000-4000-8000-000000000002" as string | null, role: "member" as string | null, membershipError: null as { message: string } | null, projections: [] as string[], filters: [] as [string, string][], service: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user ? { id: mocks.user } : null } }) }, from: () => {
 const query = { select: (value: string) => { mocks.projections.push(value); return query; }, eq: (field: string, value: string) => { mocks.filters.push([field, value]); return query; }, maybeSingle: async () => ({ data: mocks.role === null ? null : { role: mocks.role }, error: mocks.membershipError }) }; return query;
} }), createServiceRoleClient: () => mocks.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/gtfs/managed-human-command", async original => ({ ...await original<typeof import("@/lib/gtfs/managed-human-command")>(), executeGtfsHumanCommand: vi.fn(), readGtfsAdoptionReview: vi.fn() }));
vi.mock("@/lib/gtfs/managed-request-cancellation", () => ({ cancelGtfsRequest: vi.fn() }));
const basis = { feedId: id(6), versionId: id(4), routeCount: 14, stopCount: 287, previousVersionId: null, previousRouteCount: null, previousStopCount: null };
const command = { operation: "adopt" as const, commandId: id(5), basis, acceptMaterialShrinkage: false };
const requestContext = { params: Promise.resolve({ requestId: id(3) }) }, versionContext = { params: Promise.resolve({ versionId: id(4) }) };
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://127.0.0.1:3210${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
function invoke(kind: "cancel" | "review" | "adopt", extra: Record<string, string> = {}) {
 if (kind === "cancel") return cancel(request(`/api/gtfs/submissions/${id(3)}/cancel`, { workspaceId: id(1), commandId: id(5), reason: "Planner cancelled" }, extra), requestContext);
 if (kind === "adopt") return adopt(request(`/api/gtfs/versions/${id(4)}/adopt`, { workspaceId: id(1), command }, extra), versionContext);
 return review(request(`/api/gtfs/versions/${id(4)}/review?workspaceId=${id(1)}`), versionContext);
}
beforeEach(() => {
 mocks.user = id(2); mocks.role = "member"; mocks.membershipError = null; mocks.projections.length = 0; mocks.filters.length = 0;
 vi.stubEnv("OPENPLAN_GTFS_MANAGED_INGESTION", "1"); vi.stubEnv("OPENPLAN_GTFS_INSTALLATION_ID", id(7)); vi.stubEnv("OPENPLAN_GTFS_WORK_DIR", "/private/synthetic/worker"); vi.stubEnv("OPENPLAN_GTFS_PARSER_BUILD", "a".repeat(40)); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
 vi.mocked(cancelGtfsRequest).mockResolvedValue({ command: id(5), requestId: id(3), workspaceId: id(1), state: "cancelled", versionId: null, versionCancellation: null, cancelledAt: "2026-10-10T12:00:00Z" });
 vi.mocked(readGtfsAdoptionReview).mockResolvedValue({ basis, materialShrinkage: false, isCurrent: false });
 vi.mocked(executeGtfsHumanCommand).mockResolvedValue({ command: id(5), version: id(4), adopted: true, alreadyCurrent: false, basis, adoptedAt: "2026-10-10T12:00:00Z", reviewAccepted: true, humanAcceptShrinkage: false });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("manual transit review and command routes", () => {
 it("binds cancellation to session actor, path request and exact human command", async () => { const response = await invoke("cancel"); expect(response.status).toBe(200); expect((await response.json()).cancellation.versionId).toBeNull(); expect(cancelGtfsRequest).toHaveBeenCalledWith(expect.objectContaining({ service: mocks.service, scope: { workspaceId: id(1), requestId: id(3), actorId: id(2) }, command: { commandId: id(5), reason: "Planner cancelled" }, installationId: id(7) })); expect(mocks.projections).toEqual(["role"]); expect(mocks.filters).toEqual([["workspace_id", id(1)], ["user_id", id(2)]]); });
 it("reads parser counts without issuing adoption", async () => { expect((await invoke("review")).status).toBe(200); expect(readGtfsAdoptionReview).toHaveBeenCalledWith(mocks.service, { workspaceId: id(1), versionId: id(4), actorId: id(2) }, expect.any(AbortSignal)); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it("retains exact reviewed adoption under the session actor", async () => { expect((await invoke("adopt")).status).toBe(200); expect(executeGtfsHumanCommand).toHaveBeenCalledWith(expect.objectContaining({ service: mocks.service, scope: { workspaceId: id(1), versionId: id(4), actorId: id(2) }, command, installationId: id(7) })); });
 it.each(["cancel", "review", "adopt"] as const)("refuses unauthenticated %s", async kind => { mocks.user = null; expect((await invoke(kind)).status).toBe(401); expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(readGtfsAdoptionReview).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it.each(["cancel", "review", "adopt"] as const)("refuses outsider %s", async kind => { mocks.role = null; expect((await invoke(kind)).status).toBe(404); expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(readGtfsAdoptionReview).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it.each(["cancel", "review", "adopt"] as const)("keeps unavailable membership outside %s dispatch", async kind => { mocks.membershipError = { message: "Synthetic unavailable query" }; expect((await invoke(kind)).status).toBe(503); expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(readGtfsAdoptionReview).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it.each(["cancel", "adopt"] as const)("refuses viewer %s", async kind => { mocks.role = "viewer"; expect((await invoke(kind)).status).toBe(403); expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it("allows a viewer to read the completed review", async () => { mocks.role = "viewer"; expect((await invoke("review")).status).toBe(200); expect(readGtfsAdoptionReview).toHaveBeenCalledOnce(); });
 it.each(["cancel", "adopt"] as const)("refuses Planner Agent %s before command custody", async kind => { expect((await invoke(kind, { "x-openplan-assistant-execution-source": "planner_agent_quick_link" })).status).toBe(403); expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it.each(["cancel", "review", "adopt"] as const)("refuses %s when this installation has not enabled managed ingestion", async kind => { vi.stubEnv("OPENPLAN_GTFS_MANAGED_INGESTION", "0"); expect((await invoke(kind)).status).toBe(409); expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(readGtfsAdoptionReview).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it.each(["cancel", "adopt"] as const)("keeps missing installation identity outside %s custody", async kind => { vi.stubEnv("OPENPLAN_GTFS_INSTALLATION_ID", "invalid"); expect((await invoke(kind)).status).toBe(503); expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it("refuses caller actor overrides and unknown adoption operations", async () => {
  expect((await cancel(request("/api/cancel", { workspaceId: id(1), commandId: id(5), reason: "Planner cancelled", actorId: id(90) }), requestContext)).status).toBe(400);
  expect((await adopt(request("/api/adopt", { workspaceId: id(1), command: { operation: "cancel", commandId: id(5), reason: "Wrong operation" } }), versionContext)).status).toBe(400);
  expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled();
 });
 it("refuses invalid path and extra review queries", async () => { expect((await review(request(`/api/review?workspaceId=${id(1)}&actorId=${id(90)}`), versionContext)).status).toBe(400); expect((await cancel(request("/api/cancel", { workspaceId: id(1), commandId: id(5), reason: "Planner cancelled" }), { params: Promise.resolve({ requestId: "invalid" }) })).status).toBe(400); expect(readGtfsAdoptionReview).not.toHaveBeenCalled(); expect(cancelGtfsRequest).not.toHaveBeenCalled(); });
 it.each(["cancel", "adopt"] as const)("bounds %s bodies before command dispatch", async kind => { const valid = kind === "cancel" ? { workspaceId: id(1), commandId: id(5), reason: "Planner cancelled" } : { workspaceId: id(1), command }; const req = new NextRequest("http://127.0.0.1:3210/api/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(valid) + " ".repeat(40000) }); const response = kind === "cancel" ? await cancel(req, requestContext) : await adopt(req, versionContext); expect(response.status).toBe(413); expect(cancelGtfsRequest).not.toHaveBeenCalled(); expect(executeGtfsHumanCommand).not.toHaveBeenCalled(); });
 it.each(["cancel", "review", "adopt"] as const)("keeps lost %s replies unconfirmed without leaking private errors", async kind => { const error = new Error("Synthetic private evidence path"); vi.mocked(cancelGtfsRequest).mockRejectedValue(error); vi.mocked(readGtfsAdoptionReview).mockRejectedValue(error); vi.mocked(executeGtfsHumanCommand).mockRejectedValue(error); const response = await invoke(kind); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("Synthetic private evidence"); });
 it("keeps command files beside the worker namespace and validates command UUID", () => { expect(managedGtfsHumanDirectory(id(5)).directory).toMatch(new RegExp(`-human/${id(5)}$`)); expect(() => managedGtfsHumanDirectory("invalid")).toThrow(); });
});
