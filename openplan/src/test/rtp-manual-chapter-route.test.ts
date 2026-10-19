import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ client: vi.fn(), membership: vi.fn(), complete: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/workspaces/current", () => ({ loadCurrentWorkspaceMembership: mocks.membership }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/rtp/extraction/acceptance", () => ({ FROM_EXTRACTION_CANDIDATE_FIELD: "fromExtractionCandidateId", completeExtractionAcceptance: mocks.complete }));
import { POST } from "@/app/api/rtp-cycles/[rtpCycleId]/chapters/[chapterId]/transcribed-blocks/route";

const cycle = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const document = "44444444-4444-4444-8444-444444444444";
const extraction = "55555555-5555-4555-8555-555555555555";
const candidateId = "66666666-6666-4666-8666-666666666666";
const chapter = "77777777-7777-4777-8777-777777777777";
const runId = "88888888-8888-4888-8888-888888888888";
const quote = "Improve access.";
let rpc: ReturnType<typeof vi.fn>;
let insert: ReturnType<typeof vi.fn>;
let projections: Record<string, string>;
let filters: Record<string, Array<[string, string]>>;
function post(headers: Record<string, string> = {}) {
  return POST(new NextRequest("http://localhost/", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ fromExtractionCandidateId: candidateId }) }), { params: Promise.resolve({ rtpCycleId: cycle, chapterId: chapter }) });
}
beforeEach(() => {
  vi.clearAllMocks(); projections = {}; filters = {};
  mocks.membership.mockResolvedValue({ membership: { workspace_id: workspace, role: "member" } });
  mocks.complete.mockResolvedValue({});
  rpc = vi.fn().mockResolvedValue({ data: { documentId: document, extractionId: extraction, checksum: "original", contentSha256: "pages", source: "text_layer", page: 112, pageCount: 140, text: quote }, error: null });
  insert = vi.fn();
  const rows: Record<string, unknown> = {
    rtp_cycles: { id: cycle, workspace_id: workspace }, rtp_cycle_chapters: { id: chapter, title: "SYNTHETIC chapter" },
    rtp_extraction_candidates: { id: candidateId, run_id: runId, target_kind: "chapter_block", proposed_json: { text: quote }, source_chunk_id: null, source_page: 112, source_quote: quote, quote_verified: true, status: "pending" },
    rtp_extraction_runs: { id: runId, model: null, kb_document_id: document, source_method: "manual_retained_page", document_extraction_id: extraction, original_checksum: "original", extraction_content_sha256: "pages", kb_documents: { id: document, title: "SYNTHETIC source" } },
    document_narrative_drafts: { id: "retained-draft" },
  };
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: actor } } }) }, rpc,
    from: (table: string) => {
      if (!Object.hasOwn(rows, table)) throw new Error(`Unexpected table ${table}`);
      const query = { select: (columns: string) => { projections[table] = columns; return query; },
        eq: (key: string, value: string) => { (filters[table] ??= []).push([key, value]); return query; },
        insert: (payload: unknown) => { insert(payload); return query; },
        maybeSingle: async () => ({ data: rows[table], error: null }), single: async () => ({ data: rows[table], error: null }) };
      return query;
    },
  });
});
// Actual route and verifier, mocked database transport and downstream acceptance marker.
// Blind: native draft RLS/transaction races, saved editor behavior and real source authority.
describe("manual chapter route (source tests, not executed)", () => {
  it("MANUAL_CHAPTER_ROUTE: rereads selected version, preserves projections, stages a null-model draft", async () => {
    expect((await post()).status).toBe(201);
    expect(projections.rtp_extraction_runs).toBe("id, model, source_method, document_extraction_id, original_checksum, extraction_content_sha256, kb_document_id, kb_documents(id, title)");
    expect(projections.rtp_extraction_candidates).toBe("id, run_id, target_kind, proposed_json, source_chunk_id, source_page, source_quote, quote_verified, status");
    expect(filters.rtp_extraction_runs).toEqual([["id", runId], ["rtp_cycle_id", cycle], ["workspace_id", workspace]]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_rtp_retained_source_page", { p_cycle_id: cycle, p_document_id: document, p_extraction_id: extraction, p_page: 112 });
    expect(insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: null, created_by: actor, status: "draft",
      grounding_json: expect.objectContaining({ source_method: "manual_retained_page", chunk_recheck: "retained_page_matched", retained_source: { extractionId: extraction, checksum: "original", contentSha256: "pages" } }) }));
    expect(projections).not.toHaveProperty("kb_document_chunks");
    expect(mocks.complete).toHaveBeenCalledOnce();
  });
  it.each([
    { data: null, error: null }, { data: null, error: { code: "08006", message: "synthetic read unavailable" } },
    { data: { documentId: document, extractionId: extraction, checksum: "changed", contentSha256: "pages", source: "text_layer", page: 112, pageCount: 140, text: quote }, error: null },
  ])("MANUAL_CHAPTER_ROUTE_MISSING: refuses absent, failed or drifted retained pages", async (result) => {
    rpc.mockResolvedValue(result); expect((await post()).status).toBeGreaterThanOrEqual(400);
    expect(insert).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("MANUAL_CHAPTER_AGENT_REFUSAL: prevents unregistered agent placement", async () => {
    expect((await post({ "x-openplan-assistant-execution-source": "planner_agent_quick_link" })).status).toBe(403);
    expect(insert).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
});
