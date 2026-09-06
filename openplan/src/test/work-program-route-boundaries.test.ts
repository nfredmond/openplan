import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), load: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/programs/work-program/server", () => ({ authorizeWorkProgram: mocks.authorize, loadWorkProgramPreparation: mocks.load }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { GET as read, POST as save } from "@/app/api/programs/[programId]/work-program/route";
import { POST as attach } from "@/app/api/programs/[programId]/work-program/sources/route";
import { GET as exportRevision } from "@/app/api/programs/[programId]/work-program/export/route";
const programId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ programId }) };

describe("work-program HTTP authorization handoff", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([
    ["read", read, false], ["save", save, true], ["attach", attach, true], ["export", exportRevision, false],
  ] as const)("%s returns the actual authorization refusal before reading or writing program content", async (_name, handler, write) => {
    for (const status of [401, 403, 404, 503]) {
      const refusal = NextResponse.json({ error: `Exercise refusal ${status}` }, { status });
      mocks.authorize.mockResolvedValueOnce({ response: refusal });
      const request = new NextRequest("http://localhost/api/example", { method: write ? "POST" : "GET", ...(write ? { body: "{}" } : {}) });
      expect(await handler(request, context)).toBe(refusal);
      expect(mocks.authorize).toHaveBeenLastCalledWith(request, programId, write);
    }
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
});

const proposal = {
  schemaVersion: 1, documentKind: "owp", agency: "Synthetic agency", responsibleAuthority: "Exercise only",
  authorityBasis: "", periodStart: "2026-07-01", periodEnd: "2027-06-30", introduction: "", staffing: "", financialNotes: "",
  currency: "USD", priorBalance: null, priorBalanceBasis: "", elements: [],
};
const source = (id: string, title: string) => ({ id, title, document_id: id, document_checksum: "a".repeat(64), page_count: 1, source_role: "predecessor", source_url: null, extraction_json: { parser: "manual-page-review", elements: [], warnings: [] } });

describe("saved work-program HTTP behavior", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("returns application conflicts promptly and passes the authenticated actor with the exact proposal", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "PT409" }, data: null });
    mocks.service.mockReturnValue({ rpc });
    mocks.authorize.mockResolvedValue({ supabase: {}, user: { id: "actor" } });
    mocks.load.mockResolvedValue({ sources: [] });
    const requestId = "00000000-0000-4000-8000-000000000002";
    const response = await save(new NextRequest("http://localhost/api/example", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 4, requestId, draft: proposal }) }), context);
    expect(response.status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("save_program_work_program_revision", { p_program_id: programId, p_actor_id: "actor", p_expected_revision: 4, p_request_id: requestId, p_content: proposal });
  });
  it("exports only the revision's frozen sources and refuses an unavailable inventory", async () => {
    const revision = { id: "revision", revision: 1, source_ids: ["source-one"] as string[] | null, content_json: proposal, content_sha256: "b".repeat(64), created_at: "2026-09-06T10:00:00Z" };
    const projection = vi.fn(); const filters = vi.fn();
    const query = { select: (value: string) => { projection(value); return query; }, eq: (key: string, value: unknown) => { filters(key, value); return query; }, maybeSingle: async () => ({ data: revision, error: null }) };
    mocks.authorize.mockResolvedValue({ supabase: { from: () => query }, user: { id: "actor" } });
    mocks.load.mockResolvedValue({ sources: [source("source-one", "Original predecessor"), source("source-two", "Later attachment")] });
    const request = (format: string) => new NextRequest(`http://localhost/api/example?revision=1&format=${format}`);
    const html = await exportRevision(request("html"), context);
    expect(html.status).toBe(200); const text = await html.text();
    expect(text).toContain("Original predecessor"); expect(text).not.toContain("Later attachment");
    expect(projection).toHaveBeenCalledWith("id, revision, previous_revision_id, request_id, content_json, content_sha256, source_ids, created_by, created_at");
    expect(filters).toHaveBeenCalledWith("program_id", programId); expect(filters).toHaveBeenCalledWith("revision", 1);
    revision.source_ids = ["missing-source"];
    expect((await exportRevision(request("html"), context)).status).toBe(409);
    revision.source_ids = null;
    expect((await exportRevision(request("xlsx"), context)).status).toBe(409);
    expect(await (await exportRevision(request("html"), context)).text()).toContain("Early development revision: the complete source register was not captured.");
  });
});
