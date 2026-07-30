import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE SERVER DECIDES WHICH QUESTIONS APPLIED, NOT THE BROWSER.
 *
 * Two failures this closes, both of which are ordinary rather than exotic:
 *
 *  • A REQUIRED QUESTION THE RESPONDENT WAS NEVER SHOWN. If the submit route
 *    enforced `required` over every question rather than over the ones that
 *    applied, a conditional survey would be unsubmittable for exactly the people
 *    the condition was written to spare — and the error would name a question
 *    they cannot see.
 *  • AN ANSWER TO A QUESTION THAT DID NOT APPLY. A stale tab, an earlier answer
 *    changed after a later one, or a crafted request all produce this. Stored,
 *    it is tallied like any other answer, and the aggregate reports a view held
 *    by people who were never asked.
 */

const createServiceRoleClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

const { POST: submitSurvey } = await import("@/app/api/engage/[shareToken]/survey/submit/route");

const CAMPAIGN = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  title: "Corridor study",
  status: "active",
  allow_public_submissions: true,
  submissions_closed_at: null,
  survey_one_response_per_fingerprint: false,
};

const Q_MODE = "33333333-3333-4333-8333-333333333333";
const Q_BUS_WHY = "44444444-4444-4444-8444-444444444444";
const OPT_BUS = "55555555-5555-4555-8555-555555555555";
const OPT_CAR = "66666666-6666-4666-8666-666666666666";

/** A follow-up that applies ONLY to people who chose the bus — and is required. */
const QUESTIONS = [
  {
    id: Q_MODE,
    question_type: "single_choice",
    prompt: "How do you usually travel here?",
    help_text: null,
    required: true,
    sort_order: 0,
    config_json: {},
    category_id: null,
  },
  {
    id: Q_BUS_WHY,
    question_type: "free_text",
    prompt: "What would make the bus work better for you?",
    help_text: null,
    required: true,
    sort_order: 1,
    config_json: { visible_when: { question_id: Q_MODE, operator: "equals", value: OPT_BUS } },
    category_id: null,
  },
];

const OPTIONS = [
  { id: OPT_BUS, question_id: Q_MODE, label: "Bus", value: null, sort_order: 0, metadata_json: {} },
  { id: OPT_CAR, question_id: Q_MODE, label: "Car", value: null, sort_order: 1, metadata_json: {} },
];

type RecordedOp = { table: string; kind: string; columns?: string; filters: [string, unknown][]; payload?: unknown };

function submitClient() {
  const ops: RecordedOp[] = [];

  function answerFor(op: RecordedOp): { data: unknown; error: null } {
    if (op.table === "engagement_campaigns") return { data: CAMPAIGN, error: null };
    if (op.table === "engagement_survey_questions") return { data: QUESTIONS, error: null };
    if (op.table === "engagement_survey_question_options") return { data: OPTIONS, error: null };
    if (op.table === "engagement_survey_response_sessions") {
      return { data: op.kind === "insert" ? { id: "session-1" } : [], error: null };
    }
    if (op.table === "engagement_survey_answers") return { data: null, error: null };
    if (op.table === "engagement_survey_response_drafts") return { data: null, error: null };
    // The operator notification is best-effort and its failure is swallowed by
    // the route on purpose — the response is already saved by then.
    throw new Error(`Unexpected table: ${op.table}`);
  }

  function builder(op: RecordedOp) {
    const chain: Record<string, unknown> = {
      select: (columns?: string) => {
        op.columns = columns;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return chain;
      },
      gt: () => chain,
      lt: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => answerFor(op),
      single: async () => answerFor(op),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(answerFor(op)).then(resolve, reject),
    };
    return chain;
  }

  const from = (table: string) => ({
    select: (columns?: string) => {
      const op: RecordedOp = { table, kind: "select", columns, filters: [] };
      ops.push(op);
      return builder(op);
    },
    insert: (payload: unknown) => {
      const op: RecordedOp = { table, kind: "insert", payload, filters: [] };
      ops.push(op);
      return builder(op);
    },
    delete: () => {
      const op: RecordedOp = { table, kind: "delete", filters: [] };
      ops.push(op);
      return builder(op);
    },
  });

  return { supabase: { from } as unknown as SupabaseClient, ops };
}

function submitRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/engage/share-token-123/survey/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(payload),
  });
}

const CONTEXT = { params: Promise.resolve({ shareToken: "share-token-123" }) };

beforeEach(() => createServiceRoleClientMock.mockReset());

describe("a question that did not apply", () => {
  it("is not required of a respondent who was never shown it", async () => {
    const { supabase } = submitClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    // They drive. The bus follow-up is required, and does not apply to them.
    const response = await submitSurvey(
      submitRequest({ answers: [{ questionId: Q_MODE, answer: { option_id: OPT_CAR } }] }),
      CONTEXT
    );

    expect(response.status, await response.text().catch(() => "")).toBe(201);
  });

  it("is still required of a respondent it DOES apply to", async () => {
    const { supabase } = submitClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await submitSurvey(
      submitRequest({ answers: [{ questionId: Q_MODE, answer: { option_id: OPT_BUS } }] }),
      CONTEXT
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { questionId: string };
    expect(body.questionId).toBe(Q_BUS_WHY);
  });

  it("does not store an answer that arrives for it anyway, and records that it was dropped", async () => {
    const { supabase, ops } = submitClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await submitSurvey(
      submitRequest({
        answers: [
          { questionId: Q_MODE, answer: { option_id: OPT_CAR } },
          // A stale tab: they had chosen the bus, answered this, then changed
          // their mind. The browser drops it; the server must not rely on that.
          { questionId: Q_BUS_WHY, answer: { text: "more evening buses" } },
        ],
      }),
      CONTEXT
    );
    expect(response.status).toBe(201);

    const answerInsert = ops.find((op) => op.table === "engagement_survey_answers" && op.kind === "insert");
    const rows = answerInsert?.payload as { question_id: string }[];
    expect(rows.map((row) => row.question_id)).toEqual([Q_MODE]);

    // And the reviewer can tell the gap was the survey's own logic.
    const sessionInsert = ops.find(
      (op) => op.table === "engagement_survey_response_sessions" && op.kind === "insert"
    );
    const metadata = (sessionInsert?.payload as { metadata_json: Record<string, unknown> }).metadata_json;
    expect(metadata.inapplicable_answers_discarded).toBe(1);
  });

  it("discards the part-finished copy of a response once the response itself is in", async () => {
    const { supabase, ops } = submitClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    const resumeToken = "f".repeat(43);
    const response = await submitSurvey(
      submitRequest({
        answers: [{ questionId: Q_MODE, answer: { option_id: OPT_CAR } }],
        resumeToken,
      }),
      CONTEXT
    );
    expect(response.status).toBe(201);

    const draftDelete = ops.find((op) => op.table === "engagement_survey_response_drafts" && op.kind === "delete");
    expect(draftDelete?.filters).toContainEqual(["campaign_id", CAMPAIGN.id]);
    expect(draftDelete?.filters).toContainEqual([
      "resume_token_hash",
      createHash("sha256").update(resumeToken).digest("hex"),
    ]);
  });
});
