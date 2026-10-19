import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), membership: vi.fn(), provider: vi.fn(), usage: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/workspaces/current", () => ({ loadCurrentWorkspaceMembership: mocks.membership }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("ai", () => ({ generateText: mocks.provider }));
vi.mock("@/lib/runtime/ai-rate-limit", () => ({ recordAiUsageEvent: mocks.usage }));
import { POST } from "@/app/api/rtp-cycles/[rtpCycleId]/extraction-candidates/route";
import { GET } from "@/app/api/rtp-cycles/[rtpCycleId]/extraction-source-pages/route";

// Real routes, authorization gate, page helper and verifier. RPC results are mocked.
// Blind: SQL permissions/locking, OCR/source authority, column attribution and browser behavior.
const cycle = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const document = "44444444-4444-4444-8444-444444444444";
const extraction = "55555555-5555-4555-8555-555555555555";
const requestId = "66666666-6666-4666-8666-666666666666";
const quote = "Source A $99,999,999,999,999 in 2024. Period A 2024 2035. Measure A 8 percent. Project A. Improve access.";
const page = { documentId: document, extractionId: extraction, checksum: "original-v1", contentSha256: "pages-v1", source: "text_layer", page: 112, pageCount: 140, text: `${"Complete page text. ".repeat(50)}${quote}` };
let rpc: ReturnType<typeof vi.fn>;
let write: ReturnType<typeof vi.fn>;
let select: ReturnType<typeof vi.fn>;
let eq: ReturnType<typeof vi.fn>;

function input(targetKind = "financial_line", fields: Record<string, unknown> = { sourceName: "Source A", entryKind: "revenue", amount: "99999999999999" }) {
  return { requestId, kbDocumentId: document, documentExtractionId: extraction, sourcePage: 112,
    documentChecksum: page.checksum, contentSha256: page.contentSha256, targetKind, quote, fields };
}
const context = { params: Promise.resolve({ rtpCycleId: cycle }) };
function post(body: unknown = input(), headers: Record<string, string> = {}) {
  return POST(new NextRequest(`http://localhost/api/rtp-cycles/${cycle}/extraction-candidates`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), context);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.membership.mockResolvedValue({ membership: { workspace_id: workspace, role: "member" } });
  rpc = vi.fn().mockResolvedValue({ data: page, error: null });
  write = vi.fn().mockResolvedValue({ data: { runId: "retained-run", candidateId: "retained-candidate", deduped: false }, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: cycle, workspace_id: workspace }, error: null }) };
  select = query.select.mockReturnValue(query); eq = query.eq.mockReturnValue(query);
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: actor } } }) }, from: vi.fn((table) => { expect(table).toBe("rtp_cycles"); return query; }), rpc });
  mocks.service.mockReturnValue({ rpc: write });
});

describe("manual retained-page routes (source tests, not executed in this lane)", () => {
  it.each([
    ["financial_line", { sourceName: "Source A", entryKind: "revenue", amount: "99999999999999" }],
    ["performance_measure", { label: "Measure A", baselineValue: "8", unit: "percent" }],
    ["horizon_band", { label: "Period A", startYear: "2024", endYear: "2035" }],
    ["programmed_project", { projectName: "Project A", estimatedCost: "" }],
    ["cycle_financial_basis", { financialBasisYear: "2024" }],
    ["chapter_block", { text: quote }],
  ])("MANUAL_ALL_SIX: stages %s from the actual late page without a provider", async (kind, fields) => {
    const response = await post(input(kind as string, fields as Record<string, unknown>));
    expect(response.status).toBe(201);
    expect(select).toHaveBeenCalledWith("id, workspace_id");
    expect(eq.mock.calls).toEqual([["id", cycle], ["workspace_id", workspace]]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_rtp_retained_source_page", { p_cycle_id: cycle, p_document_id: document, p_extraction_id: extraction, p_page: 112 });
    const [name, payload] = write.mock.calls[0];
    expect(name).toBe("stage_rtp_manual_source_proposal");
    expect(payload).toMatchObject({ p_actor_id: actor, p_workspace_id: workspace, p_cycle_id: cycle, p_request: input(kind as string, fields as Record<string, unknown>), p_page_text: page.text, p_source: "text_layer" });
    if (kind === "programmed_project") expect(payload.p_proposed).not.toHaveProperty("estimatedCost");
    if (kind === "financial_line") expect(payload.p_proposed.amount).toBe(99999999999999);
    expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled();
  });
  it.each([
    ["invented figure", input("financial_line", { sourceName: "Source A", entryKind: "revenue", amount: "17" }), 422],
    ["missing amount", input("financial_line", { sourceName: "Source A", entryKind: "revenue", amount: "" }), 422],
    ["unknown identifier", input("programmed_project", { projectName: "Project A", projectId: actor }), 400],
    ["client verified flag", { ...input(), quote_verified: true }, 400],
    ["paraphrased chapter", input("chapter_block", { text: "Better access." }), 422],
    ["blank unknown identifier", input("programmed_project", { projectName: "Project A", projectId: null }), 400],
  ])("MANUAL_VERIFIER_REFUSAL: refuses %s before writes", async (_label, body, status) => {
    const response = await post(body); expect(response.status).toBe(status); expect(write).not.toHaveBeenCalled();
  });
  it.each([
    ["MANUAL_TOTAL_REFUSAL", "Total revenue $8.", { sourceName: "Total revenue", entryKind: "revenue", amount: "8" }],
    ["MANUAL_EXACT_DOLLARS", "Source A $8.01.", { sourceName: "Source A", entryKind: "revenue", amount: "8.01" }],
  ])("%s: refuses otherwise source-matching totals or fractional dollars", async (_label, text, fields) => {
    rpc.mockResolvedValue({ data: { ...page, text }, error: null });
    expect((await post({ ...input("financial_line", fields as Record<string, unknown>), quote: text })).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
  it.each([
    { ...page, documentId: actor }, { ...page, extractionId: actor }, { ...page, page: 111 },
    { ...page, checksum: "changed" }, { ...page, contentSha256: "changed" }, null,
  ])("MANUAL_SOURCE_BINDING: refuses missing or mismatched source identity", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect((await post()).status).toBeGreaterThanOrEqual(400); expect(write).not.toHaveBeenCalled();
  });
  it("MANUAL_READ_FAILURE: refuses a failed read without treating it as an empty page", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "synthetic unavailable" } });
    expect((await post()).status).toBe(503); expect(write).not.toHaveBeenCalled();
  });
  it.each(["", " \n\t", "x".repeat(200001)])("MANUAL_PAGE_BOUND: refuses empty or oversized page text without truncating", async (text) => {
    rpc.mockResolvedValue({ data: { ...page, text }, error: null });
    expect((await post()).status).toBe(409); expect(write).not.toHaveBeenCalled();
  });
  it("MANUAL_ACCESS_RACE: reports transaction-time access revocation", async () => {
    write.mockResolvedValue({ data: null, error: { code: "42501" } }); expect((await post()).status).toBe(403);
  });
  it("MANUAL_REPLAY_REFUSAL: reports changed-payload refusal from the transaction", async () => {
    write.mockResolvedValue({ data: null, error: { code: "PT409" } }); expect((await post()).status).toBe(409);
  });
  it("MANUAL_IDENTICAL_REPLAY: returns retained IDs from the transaction", async () => {
    write.mockResolvedValue({ data: { runId: "same", candidateId: "same-candidate", deduped: true }, error: null });
    expect(await (await post()).json()).toEqual({ runId: "same", candidateId: "same-candidate", deduped: true });
  });
  it("MANUAL_AGENT_REFUSAL: refuses agent execution before source or write access", async () => {
    expect((await post(input(), { "x-openplan-assistant-execution-source": "planner_agent_quick_link" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it("MANUAL_VIEWER_REFUSAL: keeps normal authenticated role authorization", async () => {
    mocks.membership.mockResolvedValue({ membership: { workspace_id: workspace, role: "viewer" } });
    expect((await post()).status).toBe(403); expect(write).not.toHaveBeenCalled();
  });
  it("MANUAL_FULL_PAGE: returns late-page text beyond the preview cap with no-store", async () => {
    const response = await GET(new NextRequest(`http://localhost/?kbDocumentId=${document}&documentExtractionId=${extraction}&page=112`), context);
    expect(response.status).toBe(200); expect((await response.json()).text).toBe(page.text);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(write).not.toHaveBeenCalled();
  });
});
