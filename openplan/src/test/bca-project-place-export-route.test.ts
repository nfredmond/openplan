import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { exampleBcaDocument, reviewBcaProjectPlace } from "@/lib/bca/workbench/document";
import { bcaActorId, bcaProjectId, bcaProjectPlace, bcaProjectRow } from "./fixtures/bca/project-place";
const mocks = vi.hoisted(() => ({ access: vi.fn(), pdf: vi.fn() }));
vi.mock("@/lib/bca/workbench/access", () => ({ authorizeBcaProject: mocks.access }));
vi.mock("@/lib/runtime/app-version", () => ({ buildIdentity: () => ({ commit: "synthetic-build" }) }));
vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: mocks.pdf }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
import { POST } from "@/app/api/projects/[projectId]/bca-analyses/export/route";
const context = { params: Promise.resolve({ projectId: bcaProjectId }) };
function request(body: unknown) {
  return new NextRequest(`http://localhost/api/projects/${bcaProjectId}/bca-analyses/export`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ project: bcaProjectRow(), user: { id: bcaActorId } });
  mocks.pdf.mockResolvedValue({ bytes: new Uint8Array([1, 2]), engine: "synthetic-renderer" });
});
it("exports server-read place comparison without changing retained inputs or accepting supplied totals", async () => {
  const doc = reviewBcaProjectPlace(exampleBcaDocument(bcaProjectId), bcaProjectPlace());
  mocks.access.mockResolvedValue({ project: { ...bcaProjectRow(), updated_at: "2026-10-19T01:02:03.123457+00:00" } });
  const response = await POST(request(doc), context);
  expect(response.status).toBe(200);
  expect(mocks.access).toHaveBeenCalledWith(bcaProjectId, false);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  expect(JSON.parse(await zip.file("analysis.json")!.async("string"))).toEqual(doc);
  expect(JSON.parse(await zip.file("project-place.json")!.async("string"))).toMatchObject({
    status: "changed-since-review", retained: bcaProjectPlace(), current: { status: "available", snapshot: {
      projectUpdatedAt: "2026-10-19T01:02:03.123457+00:00",
    } },
  });
  expect(mocks.pdf.mock.calls[0][0]).toContain("changed-since-review");
  expect((await POST(request({ ...doc, total: 999 }), context)).status).toBe(400);
});
it("exports a legacy analysis honestly even when current context is unreadable", async () => {
  const legacy = exampleBcaDocument(bcaProjectId);
  mocks.access.mockResolvedValue({ project: { ...bcaProjectRow(), jurisdiction_context: { bad: true } } });
  const response = await POST(request(legacy), context);
  expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  expect(JSON.parse(await zip.file("project-place.json")!.async("string"))).toMatchObject({
    status: "unbound", retained: null, current: { status: "invalid" },
  });
  expect(JSON.parse(await zip.file("analysis.json")!.async("string"))).toEqual(legacy);
});
it("preserves access and exact project checks before rendering", async () => {
  mocks.access.mockResolvedValueOnce({ error: NextResponse.json({ error: "denied" }, { status: 403 }) });
  expect((await POST(request(exampleBcaDocument(bcaProjectId)), context)).status).toBe(403);
  expect((await POST(request(exampleBcaDocument(bcaActorId)), context)).status).toBe(400);
  expect(mocks.pdf).not.toHaveBeenCalled();
});
