// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/gtfs/versions/[versionId]/status/route";
import { authorizeGtfsHumanRoute } from "@/lib/gtfs/managed-human-route";
import { readGtfsStatus } from "@/lib/gtfs/managed-worker-service";
import { readGtfsRequestCancellation } from "@/lib/gtfs/managed-request-cancellation";
vi.mock("@/lib/gtfs/managed-human-route", () => ({ authorizeGtfsHumanRoute: vi.fn() }));
vi.mock("@/lib/gtfs/managed-worker-service", () => ({ readGtfsStatus: vi.fn() }));
vi.mock("@/lib/gtfs/managed-request-cancellation", () => ({ readGtfsRequestCancellation: vi.fn() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ error: vi.fn() }) }));
const id = (n: number) => `e7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const service = {} as Extract<Awaited<ReturnType<typeof authorizeGtfsHumanRoute>>, { service: unknown }>["service"];
const status = { schemaVersion: 1 as const, workspaceId: id(1), versionId: id(2), requestId: id(4), feedId: id(5), state: "queued" as const, stage: "pending" as const, attempts: 0, leaseUntil: null, archiveConfirmed: true, submittedAt: "2026-10-10T12:00:00Z", isCurrent: false, failureCode: null, failureDetail: null, submitterAccessUnavailable: false };
const run = (query = `workspaceId=${id(1)}`, versionId = id(2)) => GET(new NextRequest(`http://127.0.0.1:3210/api/gtfs/versions/${versionId}/status?${query}`), { params: Promise.resolve({ versionId }) });
beforeEach(() => { vi.mocked(authorizeGtfsHumanRoute).mockResolvedValue({ actorId: id(3), service }); vi.mocked(readGtfsStatus).mockResolvedValue(status); vi.mocked(readGtfsRequestCancellation).mockResolvedValue(null); });
describe("managed version status route", () => {
 it("reads with the current member without original-actor impersonation or writes", async () => { const response = await run(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ managed: true, requestId: id(4), status, cancellation: null }); expect(authorizeGtfsHumanRoute).toHaveBeenCalledWith(expect.any(NextRequest), id(1), false); expect(readGtfsStatus).toHaveBeenCalledWith(service, { workspaceId: id(1), versionId: id(2), actorId: id(3) }, expect.any(AbortSignal)); expect(readGtfsRequestCancellation).toHaveBeenCalledWith(service, { workspaceId: id(1), requestId: id(4), actorId: id(3) }, expect.any(AbortSignal)); });
 it.each([401, 404, 503, 409])("returns authorization refusal %s before dispatch", async code => { vi.mocked(authorizeGtfsHumanRoute).mockResolvedValue({ response: NextResponse.json({ error: "Refused" }, { status: code }) }); expect((await run()).status).toBe(code); expect(readGtfsStatus).not.toHaveBeenCalled(); expect(readGtfsRequestCancellation).not.toHaveBeenCalled(); });
 it("refuses invalid paths and actor overrides before authority", async () => { expect((await run(`workspaceId=${id(1)}&actorId=${id(99)}`)).status).toBe(400); expect((await run(`workspaceId=${id(1)}`, "invalid")).status).toBe(400); expect(authorizeGtfsHumanRoute).not.toHaveBeenCalled(); });
 it("keeps legacy or unavailable progress distinct from empty service", async () => { vi.mocked(readGtfsStatus).mockRejectedValue(new Error("Synthetic private configuration")); const response = await run(); expect(response.status).toBe(503); const body = await response.json(); expect(body.status).toBeUndefined(); expect(JSON.stringify(body)).not.toContain("Synthetic private"); expect(readGtfsRequestCancellation).not.toHaveBeenCalled(); });
 it("does not fabricate cancellation when its lookup is unavailable", async () => { vi.mocked(readGtfsRequestCancellation).mockRejectedValue(new Error("Storage unavailable")); expect((await run()).status).toBe(503); });
});
