import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Survey responses were collected and could not leave the product. This proves
 * the door out exists, that a planner can find it, and that it does not carry
 * more of a resident than the operator can already see.
 *
 * NOTHING IN THE READ PATH IS DOUBLED. `loadCampaignAccess` and
 * `loadSurveyResponseSessions` are the REAL functions here — only the Supabase
 * factories are replaced, with a fake client that records every `.select()`
 * projection it is handed. Stubbing either loader would have tested the
 * renderer and proved nothing about the permission gate or the columns.
 */

const authGetUser = vi.fn();
const serviceRoleClient = vi.fn();
const auditError = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: authGetUser }, ...sessionClient() }),
  createServiceRoleClient: () => serviceRoleClient(),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: auditError }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { GET } from "@/app/api/engagement/campaigns/[campaignId]/survey/export/route";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";

const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

/** Every projection string the route's reads asked the database for. */
let projections: string[] = [];
/** Every `.eq()` filter applied to the sensitive response-session read. */
let sessionFilters: [string, unknown][] = [];

let campaignRow: Record<string, unknown> | null = null;
let campaignError: { message: string } | null = null;
let membershipRow: Record<string, unknown> | null = null;
let sessionRows: Record<string, unknown>[] = [];
/** The one lever that makes the failure path reachable — see `responseClient`. */
let sessionError: { message: string } | null = null;
let answerRows: Record<string, unknown>[] = [];
let answerError: { message: string } | null = null;
let optionRows: Record<string, unknown>[] = [];
let optionError: { message: string } | null = null;
/** Every `.eq()` filter applied to the sensitive answers read. */
let answerFilters: [string, unknown][] = [];

/** The auth-side client: campaign lookup + workspace membership. */
function sessionClient() {
  return {
    from(table: string) {
      const builder = {
        select(columns: string) {
          projections.push(`${table}:${columns}`);
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          if (table === "engagement_campaigns") return { data: campaignRow, error: campaignError };
          if (table === "workspace_members") return { data: membershipRow, error: null };
          throw new Error(`unexpected table ${table}`);
        },
      };
      return builder;
    },
  };
}

/**
 * The service-role client: the sensitive response-session read only.
 *
 * `sessionError` is what makes this harness able to prove anything about a
 * failed read. A fake client hands back its fixture whatever was asked for, so
 * without a way to FAIL a named read the whole failure path is unreachable and
 * every assertion below would pass over code that never runs — which is exactly
 * how this defect class shipped in the first place.
 */
function responseClient() {
  return {
    from(table: string) {
      if (table === "engagement_survey_response_sessions") {
        const builder = {
          select(columns: string) {
            projections.push(`${table}:${columns}`);
            return builder;
          },
          eq(column: string, value: unknown) {
            sessionFilters.push([column, value]);
            return builder;
          },
          async order() {
            return { data: sessionError ? null : sessionRows, error: sessionError };
          },
        };
        return builder;
      }
      if (table === "engagement_survey_answers") {
        const builder = {
          select(columns: string) {
            projections.push(`${table}:${columns}`);
            return builder;
          },
          eq(column: string, value: unknown) {
            answerFilters.push([column, value]);
            return builder;
          },
          async order() {
            return { data: answerError ? null : answerRows, error: answerError };
          },
        };
        return builder;
      }
      if (table === "engagement_survey_question_options") {
        const builder = {
          select(columns: string) {
            projections.push(`${table}:${columns}`);
            return builder;
          },
          eq() {
            return builder;
          },
          // The options read awaits the chain directly (no `.order()`).
          then(
            onFulfilled: (r: { data: unknown; error: unknown }) => unknown,
            onRejected?: (e: unknown) => unknown
          ) {
            return Promise.resolve({
              data: optionError ? null : optionRows,
              error: optionError,
            }).then(onFulfilled, onRejected);
          },
        };
        return builder;
      }
      // The live question text is NOT readable here on purpose: an export that
      // reached for `engagement_survey_questions` instead of the per-answer
      // prompt snapshot dies on this line.
      throw new Error(`unexpected sensitive table ${table}`);
    },
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp-1",
    status: "pending",
    // The loader selects these; the export must not emit them.
    submitted_by: "Ada Lovelace <ada@example.org>",
    source_type: "public",
    moderation_notes: "staff: check duplicate",
    created_at: "2026-03-04T10:00:00.000Z",
    updated_at: "2026-03-04T10:05:00.000Z",
    ...overrides,
  };
}

function request(query = "") {
  return new NextRequest(
    `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/survey/export${query}`
  );
}
const context = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

function answer(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "resp-1",
    question_id: "q-1",
    question_type: "free_text",
    question_prompt_snapshot: "What should downtown improve first?",
    answer_json: { text: "More shade trees" },
    answer_text: "More shade trees",
    created_at: "2026-03-04T10:00:01.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  projections = [];
  sessionFilters = [];
  answerFilters = [];
  campaignError = null;
  campaignRow = { id: CAMPAIGN_ID, workspace_id: "ws-1", title: "Downtown listening" };
  membershipRow = { workspace_id: "ws-1", role: "member" };
  sessionRows = [session()];
  sessionError = null;
  answerRows = [answer()];
  answerError = null;
  optionRows = [
    { id: "opt-a", label: "Bike lanes" },
    { id: "opt-b", label: "Benches" },
  ];
  optionError = null;
  authGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  serviceRoleClient.mockImplementation(() => responseClient());
});

describe("a planner can export a campaign's survey responses", () => {
  it("answers a CSV of the response register, campaign-scoped", async () => {
    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain(
      `survey-responses-${CAMPAIGN_ID}.csv`
    );

    const body = await response.text();
    const lines = body.split("\n");
    const header = lines.find((line) => line.startsWith("response_id"));
    expect(header).toBe("response_id,status,source_type,received_at,updated_at");
    expect(body).toContain("resp-1,pending,public,2026-03-04T10:00:00.000Z");

    // The sensitive read is scoped to this campaign and nothing else.
    expect(sessionFilters).toEqual([["campaign_id", CAMPAIGN_ID]]);
  });

  it("asks the database for the columns the file renders", () => {
    // A mocked client hands back the fixture whatever was requested, so the
    // projection string is the only place a dropped column can be caught.
    return GET(request(), context).then(() => {
      const projection = projections.find((p) =>
        p.startsWith("engagement_survey_response_sessions:")
      );
      expect(projection).toBeTruthy();
      for (const column of ["id", "status", "source_type", "created_at", "updated_at"]) {
        expect(projection).toContain(column);
      }
    });
  });

  it("carries no respondent name, contact detail, fingerprint or internal note", async () => {
    const body = await (await GET(request(), context)).text();

    expect(body).not.toContain("ada@example.org");
    expect(body).not.toContain("Ada Lovelace");
    expect(body).not.toContain("staff: check duplicate");
    expect(body.toLowerCase()).not.toContain("fingerprint,");
    expect(body).not.toMatch(/^submitted_by/m);
  });

  it("states what the file contains, in the file", async () => {
    const body = await (await GET(request(), context)).text();

    expect(body.startsWith("# OpenPlan survey response register")).toBe(true);
    expect(body).toContain("Downtown listening");
    expect(body).toContain("1 survey response recorded");
    expect(body).toContain("Contains: one row per survey response received");
    expect(body).toContain("Excludes:");
  });

  it("states a plain zero when the read succeeded and found nothing", async () => {
    sessionRows = [];
    const body = await (await GET(request(), context)).text();

    expect(body).toContain("# 0 survey responses recorded.");
    // The old hedge was there because the loader could not report its own
    // failure. It can now, so the file no longer refuses to say what it knows.
    expect(body).not.toContain("cannot yet tell those two apart");
  });

  it("keeps a filtered empty result from denying the whole campaign", async () => {
    // A planner who filtered to `flagged` and read "0 survey responses
    // recorded" would take it as a fact about a campaign that may have
    // hundreds. The absence stated must be the one that was actually queried.
    sessionRows = [];
    const body = await (await GET(request("?status=flagged"), context)).text();

    expect(body).toContain('no survey response has status "flagged"');
    expect(body).not.toContain("# 0 survey responses recorded.");
  });

  it("passes a status filter through to the query", async () => {
    await GET(request("?status=flagged"), context);
    expect(sessionFilters).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["status", "flagged"],
    ]);
  });

  it("refuses an unknown status instead of silently exporting everything", async () => {
    const response = await GET(request("?status=deleted"), context);
    expect(response.status).toBe(400);
    expect(sessionFilters).toEqual([]);
  });
});

describe("the export is gated exactly as the rest of the response surface is", () => {
  it("401s an unauthenticated request without touching the response tables", async () => {
    authGetUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("403s a member of another workspace", async () => {
    membershipRow = null;
    const response = await GET(request(), context);
    expect(response.status).toBe(403);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("404s a campaign that does not exist", async () => {
    campaignRow = null;
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("500s — never 200 with an empty file — when the access read itself fails", async () => {
    campaignError = { message: "connection reset" };
    const response = await GET(request(), context);
    expect(response.status).toBe(500);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("grants a viewer, because engagement.read is the surface's own gate", async () => {
    membershipRow = { workspace_id: "ws-1", role: "viewer" };
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
  });
});

describe("a failed response read leaves as a status, never as a file", () => {
  /**
   * The defect this closes. `loadSurveyResponseSessions` returned
   * `result.data ?? []`, so a dropped connection produced a 200, a valid CSV,
   * and a header line — a document an agency attaches to a Title VI or grant
   * deliverable, stating a participation record nobody read.
   */
  it("500s instead of writing a file that claims zero responses", async () => {
    sessionError = { message: "connection reset by peer" };
    const response = await GET(request(), context);

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).not.toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toBeNull();

    const body = await response.json();
    expect(body.error).toBe("Failed to load survey responses");
    expect(body.hint).toBe("This is a read failure, not an empty result.");

    // The false claim is gone, not merely accompanied by an error.
    const text = JSON.stringify(body);
    expect(text).not.toContain("0 survey responses recorded");
    expect(text).not.toContain("response_id,status");
  });

  it("names the failure in the audit line, with the database's own words", async () => {
    sessionError = { message: "connection reset by peer" };
    await GET(request("?status=flagged"), context);

    expect(auditError).toHaveBeenCalledWith(
      "survey_export_read_failed",
      expect.objectContaining({
        campaignId: CAMPAIGN_ID,
        statusFilter: "flagged",
        message: "connection reset by peer",
      })
    );
  });

  it("503s an unapplied migration, because that one is worth retrying", async () => {
    sessionError = { message: 'relation "public.engagement_survey_response_sessions" does not exist' };
    const response = await GET(request(), context);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain("schema is not available yet");
  });
});

describe("a planner can REACH the export", () => {
  // The real component, not a described fixture: this renders the same share
  // controls the campaign page mounts unconditionally in Operator Actions.
  const campaign = {
    id: CAMPAIGN_ID,
    title: "Downtown listening",
    status: "active",
    share_token: "abcdef0123456789abcdef01",
    public_description: "Tell us about downtown.",
    public_slug: null,
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: false,
  };

  it("offers a link that hits the survey export route", () => {
    render(<EngagementShareControls campaign={campaign} />);

    const link = screen.getByText(/Export survey response register/i).closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe(
      `/api/engagement/campaigns/${CAMPAIGN_ID}/survey/export?format=csv`
    );
    expect(link?.hasAttribute("download")).toBe(true);
  });

  it("tells the planner what the file holds before they download it", () => {
    render(<EngagementShareControls campaign={campaign} />);

    expect(screen.getByText(/One row per survey response received/i)).toBeTruthy();
    expect(screen.getByText(/leaves out respondent names and contact details/i)).toBeTruthy();
  });

  it("offers it even before the portal is publicly reachable (responses may predate a token)", () => {
    render(<EngagementShareControls campaign={{ ...campaign, share_token: null }} />);
    expect(screen.getByText(/Export survey response register/i)).toBeTruthy();
  });

  it("offers the answer export too — before this link, content=answers was reachable only by hand-editing the URL", () => {
    render(<EngagementShareControls campaign={campaign} />);

    const link = screen.getByText(/Export survey answers/i).closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe(
      `/api/engagement/campaigns/${CAMPAIGN_ID}/survey/export?content=answers&format=csv`
    );
    expect(link?.hasAttribute("download")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// content=answers — the full answer export
// ─────────────────────────────────────────────────────────────────────────────

function answersRequest(extra = "") {
  return request(`?content=answers${extra}`);
}

describe("the answer export carries what the community actually said", () => {
  it("exports one CSV row per answer, attributed to its response", async () => {
    const response = await GET(answersRequest(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain(
      `survey-answers-${CAMPAIGN_ID}.csv`
    );

    const body = await response.text();
    const header = body.split("\n").find((line) => line.startsWith("response_id"));
    expect(header).toBe(
      "response_id,response_status,source_type,received_at,question_id,question_type,question_prompt,answer"
    );
    expect(body).toContain(
      "resp-1,pending,public,2026-03-04T10:00:00.000Z,q-1,free_text,What should downtown improve first?,More shade trees"
    );
    // Both sensitive reads are scoped to this campaign and nothing else.
    expect(sessionFilters).toEqual([["campaign_id", CAMPAIGN_ID]]);
    expect(answerFilters).toEqual([["campaign_id", CAMPAIGN_ID]]);
  });

  it("renders the prompt SNAPSHOT each response saw — an edited question keeps old responses' old prompt", async () => {
    // Two responses to the SAME question, submitted either side of a prompt
    // edit. The live question row is not even readable by the fake client (it
    // throws on `engagement_survey_questions`), so the only way this passes is
    // by rendering each answer's own snapshot.
    sessionRows = [
      session({ id: "resp-2", created_at: "2026-03-05T10:00:00.000Z" }),
      session(),
    ];
    answerRows = [
      answer({ question_prompt_snapshot: "How safe does Main Street feel?" }),
      answer({
        session_id: "resp-2",
        question_prompt_snapshot: "How safe does the downtown core feel after dark?",
        answer_json: { text: "Poorly lit" },
        answer_text: "Poorly lit",
      }),
    ];

    const body = await (await GET(answersRequest(), context)).text();
    expect(body).toContain("resp-1,pending,public,2026-03-04T10:00:00.000Z,q-1,free_text,How safe does Main Street feel?,More shade trees");
    expect(body).toContain("resp-2,pending,public,2026-03-05T10:00:00.000Z,q-1,free_text,How safe does the downtown core feel after dark?,Poorly lit");
    expect(projections.some((p) => p.startsWith("engagement_survey_questions:"))).toBe(false);
  });

  it("asks the database for the snapshot columns it renders", async () => {
    await GET(answersRequest(), context);
    const projection = projections.find((p) => p.startsWith("engagement_survey_answers:"));
    expect(projection).toBeTruthy();
    for (const column of [
      "session_id",
      "question_id",
      "question_type",
      "question_prompt_snapshot",
      "answer_json",
      "answer_text",
    ]) {
      expect(projection).toContain(column);
    }
  });

  it("flattens every question type sensibly", async () => {
    answerRows = [
      answer({ question_id: "q-sc", question_type: "single_choice", answer_json: { option_id: "opt-a" }, answer_text: "Bike lanes" }),
      answer({ question_id: "q-mc", question_type: "multiple_choice", answer_json: { option_ids: ["opt-a", "opt-b"], other_text: "Wider sidewalks" }, answer_text: "Bike lanes; Benches; Wider sidewalks" }),
      answer({ question_id: "q-lk", question_type: "likert", answer_json: { value: 4 }, answer_text: "Agree" }),
      answer({ question_id: "q-rt", question_type: "rating", answer_json: { value: 3.5 }, answer_text: "3.5" }),
      answer({ question_id: "q-rk", question_type: "ranking", answer_json: { ranking: ["opt-b", "opt-a"] }, answer_text: "Benches > Bike lanes" }),
      // answer_text deliberately null: the amount-per-option projection must be
      // DERIVED from answer_json + option labels, not passed through.
      answer({ question_id: "q-ba", question_type: "budget_allocation", answer_json: { allocations: [{ option_id: "opt-a", amount: 60 }, { option_id: "opt-b", amount: 40 }] }, answer_text: null }),
      answer({ question_id: "q-mp", question_type: "map_point", answer_json: { geometry: { type: "Point", coordinates: [-100.51234, 40.25987] }, note: "Crosswalk needed here" }, answer_text: "Crosswalk needed here" }),
      answer({ question_id: "q-fu", question_type: "file_upload", answer_json: { files: [{ path: "uploads/x/photo.jpg", mime: "image/jpeg", size: 123456, original_name: "photo.jpg" }, { path: "uploads/x/sketch.pdf", mime: "application/pdf", size: 98765 }] }, answer_text: "photo.jpg; sketch.pdf" }),
      answer(), // free_text
    ];

    const body = await (await GET(answersRequest(), context)).text();

    expect(body).toContain("q-sc,single_choice,What should downtown improve first?,Bike lanes");
    expect(body).toContain("q-mc,multiple_choice,What should downtown improve first?,Bike lanes; Benches; Wider sidewalks");
    expect(body).toContain("q-lk,likert,What should downtown improve first?,Agree");
    expect(body).toContain("q-rt,rating,What should downtown improve first?,3.5");
    expect(body).toContain("q-rk,ranking,What should downtown improve first?,Benches > Bike lanes");
    expect(body).toContain("q-ba,budget_allocation,What should downtown improve first?,Bike lanes: 60; Benches: 40");
    // map_point leaves as lon/lat — never only the note. The leading quote is
    // the shared CSV layer's formula neutralization: the cell OPENS with a
    // machine-built "-" but ENDS in resident free text, and it is a display
    // string (never a computable numeric column), so it takes the same
    // defusing as every other text cell. Spreadsheets hide the prefix.
    expect(body).toContain("q-mp,map_point,What should downtown improve first?,\"'-100.51234,40.25987 — Crosswalk needed here\"");
    // file_upload leaves as a count + names — never bytes or storage internals.
    expect(body).toContain("q-fu,file_upload,What should downtown improve first?,2 files: photo.jpg; sketch.pdf");
    expect(body).not.toContain("123456");
    expect(body).not.toContain("uploads/x");
    // Raw option ids never leak where labels exist.
    expect(body).not.toContain("opt-a");
  });

  it("exports the same rows as JSON, grouped under their responses", async () => {
    answerRows = [
      answer({ question_id: "q-ba", question_type: "budget_allocation", answer_json: { allocations: [{ option_id: "opt-a", amount: 60 }] }, answer_text: null }),
    ];
    const response = await GET(answersRequest("&format=json"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      `survey-answers-${CAMPAIGN_ID}.json`
    );

    const body = await response.json();
    expect(body.export).toBe("survey_answers");
    expect(body.campaign).toEqual({ id: CAMPAIGN_ID, title: "Downtown listening" });
    expect(body.response_count).toBe(1);
    expect(body.answer_count).toBe(1);
    expect(body.responses).toHaveLength(1);
    const [resp] = body.responses;
    expect(resp.response_id).toBe("resp-1");
    expect(resp.answers).toEqual([
      {
        question_id: "q-ba",
        question_type: "budget_allocation",
        question_prompt: "What should downtown improve first?",
        answer: { allocations: [{ option_label: "Bike lanes", amount: 60 }] },
        answer_text: "Bike lanes: 60",
      },
    ]);
    // The JSON file carries the same custody statements as the CSV preamble.
    expect(JSON.stringify(body)).not.toContain("ada@example.org");
    expect(resp.submitted_by).toBeUndefined();
    expect(resp.moderation_notes).toBeUndefined();
  });

  it("excludes self-reported demographics from row-level export, and says so in the file", async () => {
    const body = await (await GET(answersRequest(), context)).text();

    // The rule, stated where the file's reader can see it: row-level rows are
    // k-anonymity cells of one, so the block is excluded, not thinned.
    expect(body).toContain("Self-reported demographics are not included");
    expect(body).toContain("k-anonymized aggregates");

    // And structurally absent: no demographic column leaves in the header.
    const header = body.split("\n").find((line) => line.startsWith("response_id"));
    for (const column of ["age", "zip", "language", "tenure", "race"]) {
      expect(header).not.toContain(column);
    }
  });

  it("states the demographics exclusion in the JSON export too", async () => {
    const body = await (await GET(answersRequest("&format=json"), context)).json();
    expect(body.demographics).toContain("not included");
    expect(body.demographics).toContain("k-anonymized");
  });

  it("keeps a status filter's scope: answers of filtered-out responses do not leak", async () => {
    sessionRows = [session({ id: "resp-2", status: "flagged" })];
    answerRows = [
      answer(), // resp-1 is NOT in the filtered session list
      answer({ session_id: "resp-2", answer_json: { text: "Flagged words" }, answer_text: "Flagged words" }),
    ];
    const body = await (await GET(answersRequest("&status=flagged"), context)).text();
    expect(body).toContain("Flagged words");
    expect(body).not.toContain("More shade trees");
    expect(body).toContain("1 answer across 1 survey response");
  });

  it("carries no respondent name, contact detail, fingerprint or internal note", async () => {
    const body = await (await GET(answersRequest(), context)).text();
    expect(body).not.toContain("ada@example.org");
    expect(body).not.toContain("Ada Lovelace");
    expect(body).not.toContain("staff: check duplicate");
  });

  /**
   * CSV formula injection: answers are resident-authored free text, and a cell
   * opening with `=` `+` `-` `@` runs as a formula on the planner's machine
   * when they open their own export. The shared escaping layer defuses it with
   * a leading quote. A resident-TYPED "-5" gets the same prefix deliberately:
   * it is untrusted text in a text column, and "'-5" shown as text is the safe
   * rendering (real machine numbers never pass through this column).
   */
  it("neutralizes an answer a spreadsheet would execute", async () => {
    answerRows = [
      answer({
        answer_json: { text: '=HYPERLINK("http://evil.example","click me")' },
        answer_text: '=HYPERLINK("http://evil.example","click me")',
      }),
      answer({
        question_id: "q-2",
        answer_json: { text: "@SUM(1)" },
        answer_text: "@SUM(1)",
      }),
      answer({
        question_id: "q-3",
        answer_json: { text: "-5" },
        answer_text: "-5",
      }),
    ];

    const body = await (await GET(answersRequest(), context)).text();

    expect(body).toContain("\"'=HYPERLINK");
    expect(body).toContain(",'@SUM(1)");
    expect(body).toContain(",'-5");
    // No cell anywhere opens with a live formula character.
    expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(body).not.toMatch(/(^|,)@SUM/m);
  });
});

describe("the answer export is gated and fails closed like the register", () => {
  it("403s a member of another workspace without touching the response tables", async () => {
    membershipRow = null;
    const response = await GET(answersRequest(), context);
    expect(response.status).toBe(403);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("500s — never a file — when the answers read fails", async () => {
    answerError = { message: "connection reset by peer" };
    const response = await GET(answersRequest(), context);
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).not.toContain("text/csv");
    expect(auditError).toHaveBeenCalledWith(
      "survey_export_read_failed",
      expect.objectContaining({ content: "answers", message: "connection reset by peer" })
    );
  });

  it("500s when the option-label read fails, instead of exporting every choice as '(removed option)'", async () => {
    optionError = { message: "permission denied" };
    const response = await GET(answersRequest(), context);
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).not.toContain("text/csv");
  });

  it("refuses an unknown content value", async () => {
    const response = await GET(request("?content=everything"), context);
    expect(response.status).toBe(400);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("keeps the register CSV-only while answers speak json", async () => {
    const registerJson = await GET(request("?format=json"), context);
    expect(registerJson.status).toBe(400);
    const answersJson = await GET(answersRequest("&format=json"), context);
    expect(answersJson.status).toBe(200);
  });
});
