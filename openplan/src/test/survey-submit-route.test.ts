import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();
const loadSurveyDefinitionMock = vi.fn();
const loadRecentFingerprintSessionsMock = vi.fn();
const insertSurveyResponseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/engagement/survey-responses", () => ({
  loadSurveyDefinition: (...args: unknown[]) => loadSurveyDefinitionMock(...args),
  loadRecentFingerprintSessions: (...args: unknown[]) => loadRecentFingerprintSessionsMock(...args),
  insertSurveyResponse: (...args: unknown[]) => insertSurveyResponseMock(...args),
}));

import { POST } from "@/app/api/engage/[shareToken]/survey/submit/route";

const Q_ID = "11111111-1111-4111-8111-111111111111";
const OPT_ID = "22222222-2222-4222-8222-222222222222";
const SHARE_TOKEN = "tok123456";

function question(overrides: Record<string, unknown> = {}) {
  return { id: Q_ID, question_type: "single_choice", prompt: "Pick one", help_text: null, required: true, sort_order: 0, config_json: {}, category_id: null, ...overrides };
}
function stubCampaign(campaign: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table === "engagement_campaigns") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: campaign, error: null }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}
function req(body: unknown) {
  return new NextRequest(`http://localhost/api/engage/${SHARE_TOKEN}/survey/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ shareToken: SHARE_TOKEN }) };
const OK_CAMPAIGN = { id: "camp-1", status: "active", allow_public_submissions: true, submissions_closed_at: null, survey_one_response_per_fingerprint: false };

describe("POST /api/engage/[shareToken]/survey/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServiceRoleClientMock.mockReturnValue(stubCampaign(OK_CAMPAIGN));
    loadSurveyDefinitionMock.mockResolvedValue({ questions: [question()], optionsByQuestion: new Map([[Q_ID, [{ id: OPT_ID, question_id: Q_ID, label: "A", value: null, sort_order: 0, metadata_json: {} }]]]) });
    loadRecentFingerprintSessionsMock.mockResolvedValue([]);
    insertSurveyResponseMock.mockResolvedValue({ ok: true, sessionId: "sess-1" });
  });

  it("honeypot → 201 without inserting", async () => {
    const res = await POST(req({ answers: [], website: "spam" }), params);
    expect(res.status).toBe(201);
    expect(insertSurveyResponseMock).not.toHaveBeenCalled();
  });

  it("404 when campaign not found", async () => {
    createServiceRoleClientMock.mockReturnValue(stubCampaign(null));
    const res = await POST(req({ answers: [{ questionId: Q_ID, answer: { option_id: OPT_ID } }] }), params);
    expect(res.status).toBe(404);
  });

  it("403 when not accepting submissions", async () => {
    createServiceRoleClientMock.mockReturnValue(stubCampaign({ ...OK_CAMPAIGN, allow_public_submissions: false }));
    const res = await POST(req({ answers: [{ questionId: Q_ID, answer: { option_id: OPT_ID } }] }), params);
    expect(res.status).toBe(403);
  });

  it("429 when the fingerprint is rate-limited", async () => {
    const now = new Date().toISOString();
    loadRecentFingerprintSessionsMock.mockResolvedValue([{ id: "a", created_at: now }, { id: "b", created_at: now }, { id: "c", created_at: now }]);
    const res = await POST(req({ answers: [{ questionId: Q_ID, answer: { option_id: OPT_ID } }] }), params);
    expect(res.status).toBe(429);
  });

  it("409 when answering an unknown/stale question", async () => {
    const res = await POST(req({ answers: [{ questionId: "33333333-3333-4333-8333-333333333333", answer: { option_id: OPT_ID } }] }), params);
    expect(res.status).toBe(409);
  });

  it("400 with the validation code for an invalid answer", async () => {
    const res = await POST(req({ answers: [{ questionId: Q_ID, answer: { option_id: "99999999-9999-4999-8999-999999999999" } }] }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("UNKNOWN_OPTION");
  });

  it("400 when a required question is unanswered", async () => {
    const res = await POST(req({ answers: [] }), params);
    expect(res.status).toBe(400);
  });

  it("201 pending on a valid submission; inserts the validated answer", async () => {
    const res = await POST(req({ answers: [{ questionId: Q_ID, answer: { option_id: OPT_ID } }], submittedBy: "Jo" }), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true, reviewStatus: "pending", sessionId: "sess-1" });
    const call = insertSurveyResponseMock.mock.calls[0][1];
    expect(call.status).toBe("pending");
    expect(call.respondentFingerprint).toEqual(expect.any(String));
    expect(call.answers).toHaveLength(1);
    expect(call.answers[0]).toMatchObject({ questionId: Q_ID, questionType: "single_choice", answerText: "A" });
  });

  it("flags (not rejects) a repeat fingerprint when one-response-per-fingerprint is on", async () => {
    createServiceRoleClientMock.mockReturnValue(stubCampaign({ ...OK_CAMPAIGN, survey_one_response_per_fingerprint: true }));
    loadRecentFingerprintSessionsMock.mockResolvedValue([{ id: "old", created_at: "2026-01-01T00:00:00.000Z" }]);
    const res = await POST(req({ answers: [{ questionId: Q_ID, answer: { option_id: OPT_ID } }] }), params);
    expect(res.status).toBe(201);
    expect(insertSurveyResponseMock.mock.calls[0][1].status).toBe("flagged");
  });

  it("skips optional-empty answers (writes no row) while inserting answered ones", async () => {
    const Q2 = "44444444-4444-4444-8444-444444444444";
    loadSurveyDefinitionMock.mockResolvedValue({
      questions: [question(), question({ id: Q2, required: false, question_type: "free_text" })],
      optionsByQuestion: new Map([[Q_ID, [{ id: OPT_ID, question_id: Q_ID, label: "A", value: null, sort_order: 0, metadata_json: {} }]]]),
    });
    const res = await POST(req({ answers: [{ questionId: Q_ID, answer: { option_id: OPT_ID } }, { questionId: Q2, answer: null }] }), params);
    expect(res.status).toBe(201);
    // the empty optional free-text answer is skipped; only the answered question is stored.
    expect(insertSurveyResponseMock.mock.calls[0][1].answers).toHaveLength(1);
  });

  it("rejects a duplicate answer for the same question", async () => {
    const res = await POST(req({ answers: [{ questionId: Q_ID, answer: { option_id: OPT_ID } }, { questionId: Q_ID, answer: { option_id: OPT_ID } }] }), params);
    expect(res.status).toBe(400);
  });
});
