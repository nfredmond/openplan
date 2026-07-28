import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const REPORT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { PATCH as patchDraft } from "@/app/api/reports/[reportId]/narrative-draft/[draftId]/route";

const RAW_DRAFT_MARKDOWN =
  "The project is in design. [fact:fact_1] The committed total is $200,000. [fact:fact_2]";

// An annotated grounding summary whose exportability we control per test.
function groundingJson(options: { fullyGrounded: boolean; faithfulnessChecked?: boolean }) {
  return {
    mode: "annotated",
    facts: [
      { fact_id: "fact_1", claim_text: "The project is in design." },
      { fact_id: "fact_2", claim_text: "Committed award dollars: $200,000." },
    ],
    sentences: [
      {
        text: "The project is in design. [fact:fact_1]",
        cited_fact_ids: ["fact_1"],
        is_grounded: true,
        unknown_fact_ids: [],
        unfaithful_claims: [],
      },
      {
        text: "The committed total is $200,000. [fact:fact_2]",
        cited_fact_ids: ["fact_2"],
        is_grounded: options.fullyGrounded,
        unknown_fact_ids: [],
        unfaithful_claims: options.fullyGrounded ? [] : ["200000"],
      },
    ],
    dropped_sentences: [],
    cited_fact_ids: ["fact_1", "fact_2"],
    unknown_fact_ids: [],
    grounded_sentence_count: options.fullyGrounded ? 2 : 1,
    total_sentence_count: 2,
    is_fully_grounded: options.fullyGrounded,
    faithfulness_checked: options.faithfulnessChecked ?? true,
  };
}

function draftRow(overrides?: Record<string, unknown>) {
  return {
    id: DRAFT_ID,
    workspace_id: WORKSPACE_ID,
    target_kind: "report_section",
    target_id: REPORT_ID,
    section_key: "executive_summary",
    draft_markdown: RAW_DRAFT_MARKDOWN,
    model: "claude-opus-4-8",
    grounding_json: groundingJson({ fullyGrounded: true }),
    grounded_sentence_count: 2,
    total_sentence_count: 2,
    facts_hash: "hash-1",
    status: "draft",
    accepted_markdown: null,
    accepted_by: null,
    accepted_at: null,
    created_by: USER_ID,
    created_at: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

const updateSingleMock = vi.fn();
const updateSelectMock = vi.fn(() => ({ single: updateSingleMock }));
const updateEqMock = vi.fn(() => ({ select: updateSelectMock }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

function chainable(result: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {
    maybeSingle: vi.fn(async () => result),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "eq", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  return chain;
}

function installClient(row: Record<string, unknown> | null, membership: Record<string, unknown> | null = { workspace_id: WORKSPACE_ID, role: "member" }) {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "document_narrative_drafts") {
        const lookup = chainable({ data: row, error: null });
        return { ...lookup, update: updateMock };
      }
      if (table === "workspace_members") return chainable({ data: membership, error: null });
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
}

function patchRequest(payload: unknown) {
  return new NextRequest(`http://localhost/api/reports/${REPORT_ID}/narrative-draft/${DRAFT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function routeContext() {
  return { params: Promise.resolve({ reportId: REPORT_ID, draftId: DRAFT_ID }) };
}

describe("/api/reports/[reportId]/narrative-draft/[draftId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    updateSingleMock.mockImplementation(async () => ({
      data: { id: DRAFT_ID, status: "accepted" },
      error: null,
    }));
  });

  it("accepts AS-IS when the stored grounding is exportable, preserving the raw draft", async () => {
    installClient(draftRow());

    const response = await patchDraft(patchRequest({ action: "accept" }), routeContext());

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        accepted_markdown: RAW_DRAFT_MARKDOWN,
        accepted_by: USER_ID,
      })
    );
  });

  it("treats an untouched token-stripped textarea as an as-is acceptance, not an edit", async () => {
    // Not exportable -> as-is must be blocked even though the submitted text
    // differs from the RAW draft (the tokens were stripped for display).
    installClient(draftRow({ grounding_json: groundingJson({ fullyGrounded: false }) }));

    const strippedUnchanged =
      "The project is in design. The committed total is $200,000.";
    const response = await patchDraft(
      patchRequest({ action: "accept", acceptedMarkdown: strippedUnchanged }),
      routeContext()
    );

    expect(response.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("blocks as-is acceptance when sentences are flagged, naming the count", async () => {
    installClient(draftRow({ grounding_json: groundingJson({ fullyGrounded: false }) }));

    const response = await patchDraft(patchRequest({ action: "accept" }), routeContext());

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("1 sentence");
    expect(payload.error).toContain("cannot be accepted as-is");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("blocks as-is acceptance when the faithfulness belt never ran (legacy citation-only pass)", async () => {
    installClient(
      draftRow({ grounding_json: groundingJson({ fullyGrounded: true, faithfulnessChecked: false }) })
    );

    const response = await patchDraft(patchRequest({ action: "accept" }), routeContext());

    expect(response.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("accepts operator-EDITED text regardless of grounding — it becomes operator-authored", async () => {
    installClient(draftRow({ grounding_json: groundingJson({ fullyGrounded: false }) }));

    const edited = "The project is in design. Funding details are being finalized with the board.";
    const response = await patchDraft(
      patchRequest({ action: "accept", acceptedMarkdown: edited }),
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        accepted_markdown: edited,
        accepted_by: USER_ID,
      })
    );
  });

  it("dismisses a draft without touching the accepted fields", async () => {
    installClient(draftRow());
    updateSingleMock.mockResolvedValue({ data: { id: DRAFT_ID, status: "dismissed" }, error: null });

    const response = await patchDraft(patchRequest({ action: "dismiss" }), routeContext());

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ status: "dismissed" });
  });

  it("answers 409 for a dismissed draft — dismissal is terminal", async () => {
    installClient(draftRow({ status: "dismissed" }));

    const response = await patchDraft(patchRequest({ action: "accept" }), routeContext());

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("terminal");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("answers 409 for an already-accepted draft", async () => {
    installClient(draftRow({ status: "accepted", accepted_markdown: RAW_DRAFT_MARKDOWN }));

    const response = await patchDraft(patchRequest({ action: "dismiss" }), routeContext());

    expect(response.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the draft does not belong to this report", async () => {
    installClient(null);

    const response = await patchDraft(patchRequest({ action: "dismiss" }), routeContext());

    expect(response.status).toBe(404);
  });

  it("returns 403 for a viewer", async () => {
    installClient(draftRow(), { workspace_id: WORKSPACE_ID, role: "viewer" });

    const response = await patchDraft(patchRequest({ action: "accept" }), routeContext());

    expect(response.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    installClient(draftRow());
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await patchDraft(patchRequest({ action: "accept" }), routeContext());

    expect(response.status).toBe(401);
  });
});
