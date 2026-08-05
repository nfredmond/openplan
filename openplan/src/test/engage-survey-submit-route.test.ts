import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A RESIDENT MAY NOT BE TOLD THE AGENCY IS ASKING NOTHING BECAUSE A READ FAILED.
 *
 * `POST /api/engage/[shareToken]/survey/submit` loads the campaign's active
 * survey definition and, finding no questions, answered 400 "This campaign has
 * no active survey questions." Both reads behind that were discarded, so a
 * permission failure, a dropped connection, or an unapplied migration produced
 * the identical zero — and the sentence went to a member of the public who had
 * just filled the whole survey in. It is the same defect class that reached
 * residents twice before, in the surface with the least recourse: they cannot
 * check it, and they have no reason to come back.
 *
 * `loadSurveyDefinition` now returns its error, so this route can tell the two
 * apart. The tests below are only meaningful because the loader is MOCKED at the
 * seam and made to fail by name — a fake Supabase client hands back its fixture
 * whatever the code asks for, which is exactly why this path shipped untested.
 *
 * (`survey-submit-route.test.ts` covers this route's happy path, validation and
 * rate limiting. This file is only the failed-read boundary.)
 */

const createServiceRoleClientMock = vi.fn();
const loadSurveyDefinitionMock = vi.fn();
const loadRecentFingerprintSessionsMock = vi.fn();
const insertSurveyResponseMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));
vi.mock("@/lib/engagement/survey-responses", () => ({
  loadSurveyDefinition: (...args: unknown[]) => loadSurveyDefinitionMock(...args),
  loadRecentFingerprintSessions: (...args: unknown[]) => loadRecentFingerprintSessionsMock(...args),
  insertSurveyResponse: (...args: unknown[]) => insertSurveyResponseMock(...args),
  deleteSurveyDraftByTokenHash: vi.fn(async () => ({ ok: true, removed: false })),
}));

import { POST } from "@/app/api/engage/[shareToken]/survey/submit/route";

const SHARE_TOKEN = "tok123456";
const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const OPTION_ID = "22222222-2222-4222-8222-222222222222";

const CAMPAIGN = {
  id: "camp-1",
  workspace_id: "ws-1",
  title: "Downtown listening",
  status: "active",
  allow_public_submissions: true,
  submissions_closed_at: null,
  survey_one_response_per_fingerprint: false,
};

const QUESTION = {
  id: QUESTION_ID,
  question_type: "single_choice",
  prompt: "How do you usually travel downtown?",
  help_text: null,
  required: true,
  sort_order: 0,
  config_json: {},
  category_id: null,
};

const OPTIONS_BY_QUESTION = new Map([
  [QUESTION_ID, [{ id: OPTION_ID, question_id: QUESTION_ID, label: "Bus", value: null, sort_order: 0, metadata_json: {} }]],
]);

/** Only the campaign lookup runs against the client; the definition read is mocked above. */
function campaignClient() {
  return {
    from: (table: string) => {
      if (table === "engagement_campaigns") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: CAMPAIGN, error: null }) }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function submitRequest() {
  return new NextRequest(`http://localhost/api/engage/${SHARE_TOKEN}/survey/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ answers: [{ questionId: QUESTION_ID, answer: { option_id: OPTION_ID } }] }),
  });
}

const ctx = { params: Promise.resolve({ shareToken: SHARE_TOKEN }) };

beforeEach(() => {
  vi.clearAllMocks();
  createServiceRoleClientMock.mockReturnValue(campaignClient());
  loadSurveyDefinitionMock.mockResolvedValue({
    questions: [QUESTION],
    optionsByQuestion: OPTIONS_BY_QUESTION,
    error: null,
  });
  loadRecentFingerprintSessionsMock.mockResolvedValue([]);
  insertSurveyResponseMock.mockResolvedValue({ ok: true, sessionId: "sess-1" });
});

describe("POST /api/engage/[shareToken]/survey/submit — an unreadable survey is not an empty one", () => {
  it("records the response when the definition read answered", async () => {
    const response = await POST(submitRequest(), ctx);

    expect(response.status).toBe(201);
    expect(insertSurveyResponseMock).toHaveBeenCalledTimes(1);
  });

  /**
   * THE CONTROL THAT KEEPS THE FIX HONEST. A campaign whose survey really is
   * empty must still be told so — the fix is a SPLIT, not the removal of a
   * sentence, and a version that answered 500 for both would be just as wrong in
   * the other direction.
   */
  it("still says the campaign has no active survey questions when the read found none", async () => {
    loadSurveyDefinitionMock.mockResolvedValue({ questions: [], optionsByQuestion: new Map(), error: null });

    const response = await POST(submitRequest(), ctx);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("This campaign has no active survey questions.");
    expect(insertSurveyResponseMock).not.toHaveBeenCalled();
  });

  it("tells the resident their answers were not recorded, instead of that nothing is being asked", async () => {
    loadSurveyDefinitionMock.mockResolvedValue({
      questions: [],
      optionsByQuestion: new Map(),
      error: { message: "permission denied for table engagement_survey_questions" },
    });

    const response = await POST(submitRequest(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    // The false claim is GONE, not merely accompanied by a truer one.
    expect(JSON.stringify(body)).not.toContain("no active survey questions");
    expect(body.error).toContain("not recorded");
    // Nothing is written on the strength of a definition nobody could read.
    expect(insertSurveyResponseMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "survey_definition_read_failed",
      expect.objectContaining({ campaignId: CAMPAIGN.id, pendingSchema: false })
    );
  });

  /**
   * The OPTION read failing is the subtler half and matters just as much: the
   * questions arrive, so the survey looks readable, but every question's option
   * list is empty — and a `single_choice` answer would then be validated against
   * no valid options and refused as the resident's mistake.
   */
  it("refuses on a failed OPTION read too, rather than validating against options it never read", async () => {
    loadSurveyDefinitionMock.mockResolvedValue({
      questions: [QUESTION],
      optionsByQuestion: new Map(),
      error: { message: "statement timeout" },
    });

    const response = await POST(submitRequest(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("not recorded");
    expect(insertSurveyResponseMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the survey tables are not migrated on this deployment", async () => {
    loadSurveyDefinitionMock.mockResolvedValue({
      questions: [],
      optionsByQuestion: new Map(),
      error: { message: 'relation "engagement_survey_questions" does not exist' },
    });

    const response = await POST(submitRequest(), ctx);

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("no active survey questions");
    expect(insertSurveyResponseMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "survey_definition_read_failed",
      expect.objectContaining({ pendingSchema: true })
    );
  });
});
