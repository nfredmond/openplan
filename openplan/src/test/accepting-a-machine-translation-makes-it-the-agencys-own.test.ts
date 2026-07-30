import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE WRITE SIDE OF PORTAL TRANSLATION, and the promise each verb makes.
 *
 * `engagement_content_translations` stores `source` as `'operator'` or
 * `'machine'` because they are different promises to a member of the public: one
 * is the agency's own statement, the other is model output the portal labels
 * every time it renders it. This route is where a row acquires that provenance,
 * so these assertions are mostly about provenance being impossible to fake:
 *
 *   - operator text is written as operator text and carries no model;
 *   - machine text is written from the MODEL'S OWN OUTPUT inside the request, so
 *     a client cannot post hand-typed words as a machine translation;
 *   - ACCEPTING promotes machine → operator, which removes the caveat a resident
 *     was reading, so it is filtered to machine rows and audited as a promotion;
 *   - the ADDRESS of a translation never comes from the body — the polymorphic
 *     (entity_type, entity_id) pair is resolved through this campaign's own
 *     inventory, or the write is refused;
 *   - a write that matched no rows is a 404, not a 200 over nothing and not a
 *     500 about the server;
 *   - with no Anthropic key the surface degrades to hand authoring and says why.
 */

const loadCampaignAccess = vi.fn();
const getUser = vi.fn();
const translateEngagementText = vi.fn();
const hasAnthropicAccess = vi.fn();
const checkAiUsageRateLimit = vi.fn();
const recordAiUsageEvent = vi.fn();

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

/** What this campaign shows a participant, as the inventory reads will answer. */
let categoryRows: Array<Record<string, unknown>> = [];
let questionRows: Array<Record<string, unknown>> = [];
let optionRows: Array<Record<string, unknown>> = [];
let closeLoopRows: Array<Record<string, unknown>> = [];
let inventoryError: Record<string, { message: string }> = {};

const upserts: Array<{ rows: Array<Record<string, unknown>>; options: Record<string, unknown> }> = [];
const updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
const deletes: Array<Array<[string, unknown]>> = [];

let upsertError: { message: string; code?: string } | null = null;
/** Rows the promotion UPDATE reports back. Empty models "nothing to accept". */
let updateReturns: Array<Record<string, unknown>> = [];
let deleteReturns: Record<string, unknown> | null = null;

function readChain(rows: () => Array<Record<string, unknown>>, table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "in"]) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: inventoryError[table] ?? null });
  chain.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: inventoryError[table] ? [] : rows(), error: inventoryError[table] ?? null });
  return chain;
}

const fakeSupabase = {
  auth: { getUser },
  from: vi.fn((table: string) => {
    if (table === "engagement_categories") return readChain(() => categoryRows, table);
    if (table === "engagement_survey_questions") return readChain(() => questionRows, table);
    if (table === "engagement_survey_question_options") return readChain(() => optionRows, table);
    if (table === "engagement_closeloop_entries") return readChain(() => closeLoopRows, table);
    if (table === "engagement_campaigns") return readChain(() => [], table);

    if (table !== "engagement_content_translations") throw new Error(`Unexpected table: ${table}`);

    return {
      upsert: (rows: Array<Record<string, unknown>>, options: Record<string, unknown>) => {
        upserts.push({ rows, options });
        const chain: Record<string, unknown> = {
          select: () => chain,
          then: (resolve: (value: unknown) => unknown) =>
            resolve({ data: upsertError ? null : rows, error: upsertError }),
        };
        return chain;
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        updates.push({ patch, filters });
        const chain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          in: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          select: () => chain,
          then: (resolve: (value: unknown) => unknown) => resolve({ data: updateReturns, error: null }),
        };
        return chain;
      },
      delete: () => {
        const filters: Array<[string, unknown]> = [];
        deletes.push(filters);
        const chain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          select: () => chain,
          maybeSingle: async () => ({ data: deleteReturns, error: null }),
        };
        return chain;
      },
    };
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeSupabase),
  createServiceRoleClient: vi.fn(() => fakeSupabase),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => auditLogger,
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccess(...args),
}));
vi.mock("@/lib/engagement/translation", () => ({
  translateEngagementText: (...args: unknown[]) => translateEngagementText(...args),
}));
vi.mock("@/lib/integrations/anthropic-access", () => ({
  hasAnthropicAccess: () => hasAnthropicAccess(),
}));
vi.mock("@/lib/integrations/workspace-keys", () => ({
  // Pass-through: the real one binds the workspace's own key for the duration of
  // the callback, which is why the key check happens inside it.
  withWorkspaceIntegrationContext: async (_workspaceId: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("@/lib/runtime/ai-rate-limit", () => ({
  AI_RATE_LIMIT_BUCKET_KEYS: ["assistant_chat"],
  checkAiUsageRateLimit: (...args: unknown[]) => checkAiUsageRateLimit(...args),
  recordAiUsageEvent: (...args: unknown[]) => recordAiUsageEvent(...args),
}));

const auditLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

import { DELETE, POST } from "@/app/api/engagement/campaigns/[campaignId]/translations/route";
import {
  MACHINE_TRANSLATION_BATCH_MAX,
  campaignTranslationFieldKey,
  hashTranslationSource,
} from "@/lib/engagement/campaign-translations";

const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

const CAMPAIGN_TITLE = "Downtown safety listening campaign";
const CATEGORY_LABEL = "Crossings";

const TITLE_KEY = campaignTranslationFieldKey("campaign", CAMPAIGN_ID, "title");
const CATEGORY_LABEL_KEY = campaignTranslationFieldKey("category", "cat-1", "label");
const CATEGORY_DESCRIPTION_KEY = campaignTranslationFieldKey("category", "cat-1", "description");
const OTHER_CAMPAIGN_CATEGORY_KEY = campaignTranslationFieldKey("category", "cat-elsewhere", "label");

function postRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/translations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(query: Record<string, string>) {
  const search = new URLSearchParams(query).toString();
  return new NextRequest(
    `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/translations?${search}`,
    { method: "DELETE" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  upserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  upsertError = null;
  updateReturns = [];
  deleteReturns = null;
  inventoryError = {};

  categoryRows = [{ id: "cat-1", label: CATEGORY_LABEL, description: "Anything about crossing the street" }];
  questionRows = [];
  optionRows = [];
  closeLoopRows = [];

  getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  loadCampaignAccess.mockResolvedValue({
    campaign: {
      id: CAMPAIGN_ID,
      workspace_id: WORKSPACE_ID,
      title: CAMPAIGN_TITLE,
      summary: null,
      public_description: null,
    },
    membership: { workspace_id: WORKSPACE_ID, role: "admin" },
    error: null,
    allowed: true,
  });
  hasAnthropicAccess.mockReturnValue(true);
  checkAiUsageRateLimit.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
  translateEngagementText.mockImplementation(async ({ text }: { text: string }) => ({
    source: "ai",
    target_language: "es",
    translated: `es: ${text}`,
    model: "claude-haiku-4-5-20251001",
    caveat: "machine",
  }));
});

// ── Who may write at all ─────────────────────────────────────────────────────

describe("who may publish an agency's words in another language", () => {
  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(postRequest({ action: "accept", locale: "es", fieldKeys: [TITLE_KEY] }), ctx);

    expect(response.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("refuses a viewer, through the same gate the console asks", async () => {
    loadCampaignAccess.mockResolvedValue({
      campaign: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID, title: CAMPAIGN_TITLE },
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: false,
    });

    const response = await POST(
      postRequest({ action: "save", locale: "es", entries: [{ fieldKey: TITLE_KEY, text: "Campaña" }] }),
      ctx
    );

    expect(response.status).toBe(403);
    expect(upserts).toHaveLength(0);
    // The role question asked is the WRITE one — "read everything, change
    // nothing" is the viewer tier's whole contract.
    expect(loadCampaignAccess).toHaveBeenCalledWith(
      expect.anything(),
      CAMPAIGN_ID,
      USER_ID,
      "engagement.write"
    );
  });

  it("refuses an unsupported language rather than storing an inert row", async () => {
    const response = await POST(
      postRequest({ action: "save", locale: "klingon", entries: [{ fieldKey: TITLE_KEY, text: "x" }] }),
      ctx
    );

    expect(response.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("refuses a machine batch larger than the cap, naming the cap", async () => {
    const response = await POST(
      postRequest({
        action: "publish_machine",
        locale: "es",
        fieldKeys: Array.from({ length: MACHINE_TRANSLATION_BATCH_MAX + 1 }, (_, index) => `campaign:${index}:title`),
      }),
      ctx
    );

    expect(response.status).toBe(400);
    expect((await response.json()).details).toContain(String(MACHINE_TRANSLATION_BATCH_MAX));
    expect(translateEngagementText).not.toHaveBeenCalled();
  });
});

// ── The address never comes from the request ──────────────────────────────────

describe("a translation cannot be attached to something outside this campaign", () => {
  it("refuses a field this campaign does not show a participant", async () => {
    const response = await POST(
      postRequest({
        action: "save",
        locale: "es",
        entries: [{ fieldKey: OTHER_CAMPAIGN_CATEGORY_KEY, text: "Cruces" }],
      }),
      ctx
    );

    // 409, and nothing partial: the polymorphic address means a client free to
    // choose its own could otherwise write onto another campaign's category.
    expect(response.status).toBe(409);
    expect(upserts).toHaveLength(0);
    const body = await response.json();
    expect(body.error).toContain("no longer part of what participants read");
    expect(body.details).toContain("nothing was saved");
  });

  it("refuses an archived question's prompt, because a participant does not read it", async () => {
    // The inventory reads active questions only, so an archived one is simply
    // absent from it — which is what makes "complete" reachable at all.
    questionRows = [];

    const response = await POST(
      postRequest({
        action: "save",
        locale: "es",
        entries: [{ fieldKey: campaignTranslationFieldKey("survey_question", "q-archived", "prompt"), text: "x" }],
      }),
      ctx
    );

    expect(response.status).toBe(409);
    expect(upserts).toHaveLength(0);
  });

  it("refuses everything when the inventory itself could not be read", async () => {
    inventoryError = { engagement_categories: { message: "connection reset" } };

    const response = await POST(
      postRequest({ action: "save", locale: "es", entries: [{ fieldKey: TITLE_KEY, text: "Campaña" }] }),
      ctx
    );

    // Writing against an inventory this request could not verify would let a row
    // land on an address nobody checked.
    expect(response.status).toBe(500);
    expect(upserts).toHaveLength(0);
    expect((await response.json()).details).toContain("connection reset");
  });
});

// ── Operator wording ─────────────────────────────────────────────────────────

describe("the operator's own wording", () => {
  it("stores it as the agency's statement, with no model and with what it translated", async () => {
    const response = await POST(
      postRequest({
        action: "save",
        locale: "es",
        entries: [{ fieldKey: TITLE_KEY, text: "  Campaña de escucha sobre seguridad  " }],
      }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].options).toEqual({ onConflict: "entity_type,entity_id,field,locale" });
    expect(upserts[0].rows).toHaveLength(1);
    expect(upserts[0].rows[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      campaign_id: CAMPAIGN_ID,
      entity_type: "campaign",
      entity_id: CAMPAIGN_ID,
      field: "title",
      locale: "es",
      translated_text: "Campaña de escucha sobre seguridad",
      source: "operator",
      // Meaningless for operator text, and the table's own CHECK agrees.
      machine_model: null,
      created_by: USER_ID,
    });
    // What this was a translation OF, so a later edit of the English can be
    // reported as such instead of leaving a translation of a vanished sentence.
    expect(upserts[0].rows[0].source_text_hash).toBe(hashTranslationSource(CAMPAIGN_TITLE));

    // Said back from where the write happened, not remembered in the UI.
    expect((await response.json()).published).toContain("no machine-translation caveat");
  });

  it("refuses a blank translation rather than replacing readable text with nothing", async () => {
    const response = await POST(
      postRequest({ action: "save", locale: "es", entries: [{ fieldKey: TITLE_KEY, text: "   " }] }),
      ctx
    );

    expect(response.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("reports a failed save as a failure, naming the database's own message", async () => {
    upsertError = { message: 'relation "engagement_content_translations" does not exist' };

    const response = await POST(
      postRequest({ action: "save", locale: "es", entries: [{ fieldKey: TITLE_KEY, text: "Campaña" }] }),
      ctx
    );

    expect(response.status).toBe(500);
    expect((await response.json()).details).toContain("does not exist");
  });
});

// ── Machine wording ──────────────────────────────────────────────────────────

describe("machine translation", () => {
  it("drafts without saving anything, so a suggestion is not a publication", async () => {
    const response = await POST(
      postRequest({ action: "suggest", locale: "es", fieldKeys: [TITLE_KEY, CATEGORY_LABEL_KEY] }),
      ctx
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.suggestions).toEqual([
      { fieldKey: TITLE_KEY, text: `es: ${CAMPAIGN_TITLE}` },
      { fieldKey: CATEGORY_LABEL_KEY, text: `es: ${CATEGORY_LABEL}` },
    ]);
    // NOTHING published. The operator edits and saves, or publishes it labelled.
    expect(upserts).toHaveLength(0);
  });

  it("publishes model output as machine, with the model recorded", async () => {
    const response = await POST(
      postRequest({ action: "publish_machine", locale: "es", fieldKeys: [TITLE_KEY] }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(upserts[0].rows[0]).toMatchObject({
      source: "machine",
      machine_model: "claude-haiku-4-5-20251001",
      // The text came from the model inside this request — the body never
      // carried it, so a machine row provably came from a machine.
      translated_text: `es: ${CAMPAIGN_TITLE}`,
    });
    expect((await response.json()).publishedNotice).toContain("machine-translation caveat");
  });

  it("meters the spend it caused, in its own bucket", async () => {
    await POST(postRequest({ action: "publish_machine", locale: "es", fieldKeys: [TITLE_KEY] }), ctx);

    expect(recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, bucketKey: "engagement_content_translation" })
    );
    // Counted against everything else too, so eleven languages in a loop is
    // bounded by the same window the rest of the staff AI is.
    expect(checkAiUsageRateLimit).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ bucketKeys: expect.arrayContaining(["engagement_content_translation"]) })
    );
  });

  it("stops at the rate limit instead of spending", async () => {
    checkAiUsageRateLimit.mockResolvedValue({ allowed: false, count: 99, retryAfterSeconds: 300 });

    const response = await POST(
      postRequest({ action: "publish_machine", locale: "es", fieldKeys: [TITLE_KEY] }),
      ctx
    );

    expect(response.status).toBe(429);
    expect(translateEngagementText).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("says why the model is unavailable instead of showing an empty box", async () => {
    hasAnthropicAccess.mockReturnValue(false);

    const response = await POST(postRequest({ action: "suggest", locale: "es", fieldKeys: [TITLE_KEY] }), ctx);

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reason).toContain("no Anthropic API key");
    // Hand authoring is the capability; the model is only an accelerator, and
    // there is nothing to buy — OpenPlan is free.
    expect(body.reason).toContain("write every translation yourself");
    expect(body.reason).not.toMatch(/upgrade|subscription|plan/i);
    expect(translateEngagementText).not.toHaveBeenCalled();
  });

  it("reports a translation that failed as failed, not as one that came back empty", async () => {
    translateEngagementText.mockResolvedValue({
      source: "unavailable",
      target_language: "es",
      translated: null,
      model: null,
      caveat: "machine",
    });

    const response = await POST(
      postRequest({ action: "publish_machine", locale: "es", fieldKeys: [TITLE_KEY] }),
      ctx
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.published).toBe(0);
    expect(body.partial).toMatch(/nothing was published|could not be machine translated/i);
    // A blank "translation" would be worse than the source text it replaced.
    expect(upserts).toHaveLength(0);
  });
});

// ── Promotion: the whole point ────────────────────────────────────────────────

describe("accepting a machine translation", () => {
  it("promotes it to the agency's own wording and drops the model", async () => {
    updateReturns = [{ entity_type: "campaign", entity_id: CAMPAIGN_ID, field: "title" }];

    const response = await POST(postRequest({ action: "accept", locale: "es", fieldKeys: [TITLE_KEY] }), ctx);

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({ source: "operator", machine_model: null });
    // The TEXT is untouched, and so is the hash — what this was translated from
    // did not change. Only who is answerable for it did.
    expect(updates[0].patch).not.toHaveProperty("translated_text");
    expect(updates[0].patch).not.toHaveProperty("source_text_hash");
    // …and WHO is answerable moves to the person who accepted. `created_by` is
    // defined by the save path as the author of the wording currently published,
    // and accepting is exactly when that changes hands: the row stops being a
    // machine's output somebody generated and becomes the agency's own sentence
    // that THIS person put their name to. Leaving it on whoever ran the machine
    // translation would answer "who wrote this Spanish?" with the one person who
    // deliberately did not.
    expect(updates[0].patch).toMatchObject({ created_by: USER_ID });

    // Filtered to machine rows, so an operator's own wording cannot be
    // "accepted" into a no-op that reports success.
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([
        ["campaign_id", CAMPAIGN_ID],
        ["locale", "es"],
        ["source", "machine"],
        ["entity_type", "campaign"],
        ["field", "title"],
        ["entity_id", [CAMPAIGN_ID]],
      ])
    );

    const body = await response.json();
    expect(body.accepted).toBe(1);
    // The consequence, restated by the place the write happened.
    expect(body.published).toContain("caveat participants were reading is gone");
  });

  it("audits the promotion as a promotion, because who wrote a public sentence has legal weight", async () => {
    updateReturns = [{ entity_type: "campaign", entity_id: CAMPAIGN_ID, field: "title" }];

    await POST(postRequest({ action: "accept", locale: "es", fieldKeys: [TITLE_KEY] }), ctx);

    expect(auditLogger.info).toHaveBeenCalledWith(
      "machine_translations_accepted",
      expect.objectContaining({ userId: USER_ID, campaignId: CAMPAIGN_ID, locale: "es", promotedToOperator: 1 })
    );
  });

  it("promotes only the fields asked for, never a cross product of them", async () => {
    // THE BUG THIS PINS. Two `.in()` filters on entity_id and field would match
    // every combination: accepting one topic's NAME and another topic's
    // DESCRIPTION would have promoted all four, including two nobody looked at.
    // Grouping by (entity_type, field) keeps each statement exact.
    categoryRows = [
      { id: "cat-1", label: CATEGORY_LABEL, description: "Anything about crossing the street" },
      { id: "cat-2", label: "Lighting", description: "Street lighting" },
    ];
    updateReturns = [{ entity_type: "category", entity_id: "cat-1", field: "label" }];

    await POST(
      postRequest({
        action: "accept",
        locale: "es",
        fieldKeys: [CATEGORY_LABEL_KEY, campaignTranslationFieldKey("category", "cat-2", "description")],
      }),
      ctx
    );

    expect(updates).toHaveLength(2);
    const labelUpdate = updates.find((update) => update.filters.some(([, value]) => value === "label"))!;
    const descriptionUpdate = updates.find((update) => update.filters.some(([, value]) => value === "description"))!;
    // cat-1's label and cat-2's description — and neither statement can reach
    // the other's row.
    expect(labelUpdate.filters).toEqual(expect.arrayContaining([["entity_id", ["cat-1"]]]));
    expect(descriptionUpdate.filters).toEqual(expect.arrayContaining([["entity_id", ["cat-2"]]]));
  });

  it("answers a promotion that matched nothing as no such translation, not as success", async () => {
    updateReturns = [];

    const response = await POST(postRequest({ action: "accept", locale: "es", fieldKeys: [TITLE_KEY] }), ctx);

    // 404 rather than 200-over-nothing, and rather than a 500 blaming the
    // server: this route never read the row, so zero matched is the ordinary
    // answer to "is there a machine translation here".
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("No such machine translation");
  });
});

// ── Withdrawal ───────────────────────────────────────────────────────────────

describe("withdrawing a translation", () => {
  it("removes exactly one field's translation in one language", async () => {
    deleteReturns = { entity_type: "category", entity_id: "cat-1", field: "label", locale: "es" };

    const response = await DELETE(deleteRequest({ locale: "es", fieldKey: CATEGORY_LABEL_KEY }), ctx);

    expect(response.status).toBe(200);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["locale", "es"],
      ["entity_type", "category"],
      ["entity_id", "cat-1"],
      ["field", "label"],
    ]);
    // What a resident will see instead, said plainly.
    expect((await response.json()).published).toContain("not translated");
  });

  it("answers a withdrawal that matched nothing as no such translation", async () => {
    deleteReturns = null;

    const response = await DELETE(deleteRequest({ locale: "es", fieldKey: CATEGORY_DESCRIPTION_KEY }), ctx);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("No such translation");
  });

  it("refuses a withdrawal aimed outside this campaign", async () => {
    const response = await DELETE(
      deleteRequest({ locale: "es", fieldKey: OTHER_CAMPAIGN_CATEGORY_KEY }),
      ctx
    );

    expect(response.status).toBe(409);
    expect(deletes).toHaveLength(0);
  });
});
