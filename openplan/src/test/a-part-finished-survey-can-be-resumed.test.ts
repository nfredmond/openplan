import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SURVEY_DRAFT_RETENTION_DAYS } from "@/lib/engagement/survey";
import { EN_PORTAL_MESSAGES } from "@/lib/engagement/portal-i18n/messages";

/**
 * SOMEBODY ANSWERING A SURVEY ON A PHONE, ON A BUS, CAN LEAVE AND COME BACK.
 *
 * What this file holds the product to, in order of how much damage getting it
 * wrong would do:
 *
 *  1. A DRAFT IS NEVER A RESPONSE. Nothing the save path writes is reachable by
 *     anything that counts responses. A survey reporting 40 responses when 12
 *     are abandoned drafts is a false claim about turnout, published by an
 *     agency to a public body.
 *  2. THE RESUME CREDENTIAL IS NOT GUESSABLE AND IS NOT STORED. These drafts
 *     hold demographics. A predictable handle would be a way to read a
 *     stranger's answers.
 *  3. A FAILED LOOKUP IS NOT AN ABSENT DRAFT. Telling a resident their saved
 *     answers are gone because a query errored is a false statement about their
 *     own work.
 *  4. WHAT THE PARTICIPANT IS TOLD IS TRUE OF THE ROW. The retention promise in
 *     the catalog and the expiry written to the database are the same number.
 */

const createServiceRoleClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

const { POST: saveDraft, DELETE: discardDraft } = await import(
  "@/app/api/engage/[shareToken]/survey/draft/route"
);
const { POST: resumeDraft } = await import("@/app/api/engage/[shareToken]/survey/draft/resume/route");

// ── A recording Supabase stand-in ────────────────────────────────────────────
// Records the table, operation, projection and filters of every query, so a test
// can assert not only what came back but WHAT WAS ASKED — including the table
// that must never be touched at all.

type RecordedOp = {
  table: string;
  kind: "select" | "insert" | "update" | "delete";
  columns?: string;
  filters: [string, unknown][];
  payload?: unknown;
};

type Answer = { data: unknown; error: { message: string } | null };

function makeClient(respond: (op: RecordedOp) => Answer) {
  const ops: RecordedOp[] = [];

  function builder(op: RecordedOp) {
    const answer = () => respond(op);
    const chain: Record<string, unknown> = {
      select: (columns?: string) => {
        op.columns = columns;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return chain;
      },
      gt: (column: string, value: unknown) => {
        op.filters.push([`gt:${column}`, value]);
        return chain;
      },
      lt: (column: string, value: unknown) => {
        op.filters.push([`lt:${column}`, value]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => answer(),
      single: async () => answer(),
      then: (resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(answer()).then(resolve, reject),
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
    update: (payload: unknown) => {
      const op: RecordedOp = { table, kind: "update", payload, filters: [] };
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

const CAMPAIGN = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  allow_public_submissions: true,
  submissions_closed_at: null,
};

const Q_MODE = "33333333-3333-4333-8333-333333333333";
const Q_WHY = "44444444-4444-4444-8444-444444444444";
const Q_PHOTO = "55555555-5555-4555-8555-555555555555";

const QUESTIONS = [
  { id: Q_MODE, question_type: "single_choice", prompt: "How do you travel?", help_text: null, required: false, sort_order: 0, config_json: {}, category_id: null },
  { id: Q_WHY, question_type: "free_text", prompt: "Why?", help_text: null, required: false, sort_order: 1, config_json: {}, category_id: null },
  { id: Q_PHOTO, question_type: "file_upload", prompt: "A photo?", help_text: null, required: false, sort_order: 2, config_json: {}, category_id: null },
];

const OPTIONS = [
  { id: "66666666-6666-4666-8666-666666666666", question_id: Q_MODE, label: "Bus", value: null, sort_order: 0, metadata_json: {} },
];

type DraftFixture = {
  answers_json?: unknown;
  answered_count?: number;
  expires_at?: string;
  updated_at?: string;
} | null;

function standardClient(options: { draft?: DraftFixture; draftReadError?: string; liveDrafts?: number } = {}) {
  const draftRow =
    options.draft === undefined
      ? null
      : options.draft === null
        ? null
        : {
            id: "draft-1",
            answers_json: options.draft.answers_json ?? { version: 1, answers: [] },
            answered_count: options.draft.answered_count ?? 0,
            expires_at: options.draft.expires_at ?? "2026-08-29T00:00:00.000Z",
            created_at: "2026-07-30T00:00:00.000Z",
            updated_at: options.draft.updated_at ?? "2026-07-30T12:00:00.000Z",
          };

  return makeClient((op) => {
    if (op.table === "engagement_campaigns") return { data: CAMPAIGN, error: null };
    if (op.table === "engagement_survey_questions") return { data: QUESTIONS, error: null };
    if (op.table === "engagement_survey_question_options") return { data: OPTIONS, error: null };
    if (op.table === "engagement_survey_response_drafts") {
      if (options.draftReadError && op.kind === "select") {
        return { data: null, error: { message: options.draftReadError } };
      }
      if (op.kind === "select") {
        // The live-draft cap query projects only "id"; the resume query projects
        // the row. Told apart by the projection, as the route writes them.
        if (op.columns === "id") {
          return { data: Array.from({ length: options.liveDrafts ?? 0 }, (_, i) => ({ id: `d${i}` })), error: null };
        }
        return { data: draftRow, error: null };
      }
      if (op.kind === "insert") {
        const payload = op.payload as Record<string, unknown>;
        return {
          data: {
            id: "draft-new",
            answers_json: payload.answers_json,
            answered_count: payload.answered_count,
            expires_at: payload.expires_at,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          error: null,
        };
      }
      if (op.kind === "update") return { data: draftRow, error: null };
      return { data: null, error: null };
    }
    throw new Error(`Unexpected table: ${op.table}`);
  });
}

function draftRequest(method: "POST" | "DELETE", payload: unknown, url = "draft") {
  return new NextRequest(`http://localhost/api/engage/share-token-123/survey/${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(payload),
  });
}

const CONTEXT = { params: Promise.resolve({ shareToken: "share-token-123" }) };

beforeEach(() => {
  createServiceRoleClientMock.mockReset();
});

describe("saving a part-finished survey", () => {
  it("hands the browser a resume credential and stores only its digest", async () => {
    const { supabase, ops } = standardClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await saveDraft(
      draftRequest("POST", { answers: [{ questionId: Q_WHY, answer: { text: "The bus is late" } }] }),
      CONTEXT
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { resumeToken: string; expiresAt: string };

    // 32 random bytes, base64url. Not an id, not a counter, not a fingerprint.
    expect(body.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const insert = ops.find((op) => op.table === "engagement_survey_response_drafts" && op.kind === "insert");
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload.resume_token_hash).toBe(createHash("sha256").update(body.resumeToken).digest("hex"));
    // THE TOKEN ITSELF IS NOWHERE IN THE ROW. A database backup must not be a
    // working key to every part-finished response in it.
    expect(JSON.stringify(payload)).not.toContain(body.resumeToken);
  });

  it("keeps the retention it promises the participant", async () => {
    const { supabase, ops } = standardClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    const before = Date.now();
    const response = await saveDraft(draftRequest("POST", { answers: [] }), CONTEXT);
    const body = (await response.json()) as { expiresAt: string; retentionDays: number };

    const days = (Date.parse(body.expiresAt) - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(SURVEY_DRAFT_RETENTION_DAYS - 0.01);
    expect(days).toBeLessThan(SURVEY_DRAFT_RETENTION_DAYS + 0.01);
    expect(body.retentionDays).toBe(SURVEY_DRAFT_RETENTION_DAYS);

    // The row the database gets carries the same instant the participant is told.
    const insert = ops.find((op) => op.table === "engagement_survey_response_drafts" && op.kind === "insert");
    expect((insert?.payload as Record<string, unknown>).expires_at).toBe(body.expiresAt);

    // And the sentence that states it interpolates the same constant rather
    // than naming a number of its own.
    expect(EN_PORTAL_MESSAGES["survey.draftDeviceOnly"]).toContain("{days}");
  });

  it("sweeps this campaign's expired drafts whenever one is saved", async () => {
    const { supabase, ops } = standardClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    await saveDraft(draftRequest("POST", { answers: [] }), CONTEXT);

    const sweep = ops.find((op) => op.table === "engagement_survey_response_drafts" && op.kind === "delete");
    expect(sweep, "an expiry sweep must run on the campaign being touched").toBeDefined();
    expect(sweep?.filters).toContainEqual(["campaign_id", CAMPAIGN.id]);
    expect(sweep?.filters.some(([column]) => column === "lt:expires_at")).toBe(true);
  });

  it("does not save an attachment it could not honour later, and says so", async () => {
    // A stored file path outlives the two-hour upload window the submit route
    // enforces, so a resumed draft would look complete and then be refused.
    const { supabase, ops } = standardClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await saveDraft(
      draftRequest("POST", {
        answers: [
          { questionId: Q_WHY, answer: { text: "hi" } },
          { questionId: Q_PHOTO, answer: { files: [{ path: "camp/x.jpg", mime: "image/jpeg", size: 10 }] } },
        ],
      }),
      CONTEXT
    );
    const body = (await response.json()) as { filesNotSaved: boolean };
    expect(body.filesNotSaved).toBe(true);

    const insert = ops.find((op) => op.table === "engagement_survey_response_drafts" && op.kind === "insert");
    const stored = JSON.stringify((insert?.payload as Record<string, unknown>).answers_json);
    expect(stored).not.toContain(Q_PHOTO);
    expect(stored).toContain(Q_WHY);
  });

  it("refuses an answer to a question that is not in this campaign's survey", async () => {
    const { supabase } = standardClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await saveDraft(
      draftRequest("POST", { answers: [{ questionId: "77777777-7777-4777-8777-777777777777", answer: { text: "x" } }] }),
      CONTEXT
    );
    expect(response.status).toBe(409);
  });

  it("bounds how many part-finished responses one connection can leave behind", async () => {
    const { supabase } = standardClient({ liveDrafts: 5 });
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await saveDraft(draftRequest("POST", { answers: [] }), CONTEXT);
    expect(response.status).toBe(429);
  });
});

describe("coming back to a part-finished survey", () => {
  it("returns the saved answers to the browser holding the token, and looks them up BY THE DIGEST", async () => {
    const { supabase, ops } = standardClient({
      draft: { answers_json: { version: 1, answers: [{ questionId: Q_WHY, answer: { text: "The bus is late" } }] } },
    });
    createServiceRoleClientMock.mockReturnValue(supabase);

    const token = "a".repeat(43);
    const response = await resumeDraft(draftRequest("POST", { resumeToken: token }, "draft/resume"), CONTEXT);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { answers: { questionId: string; answer: unknown }[] };
    expect(body.answers).toEqual([{ questionId: Q_WHY, answer: { text: "The bus is late" } }]);

    const read = ops.find((op) => op.table === "engagement_survey_response_drafts" && op.kind === "select");
    // Scoped by campaign AND addressed by the digest of the token — never by a
    // row id, a fingerprint, or anything else a stranger could hold.
    expect(read?.filters).toContainEqual(["campaign_id", CAMPAIGN.id]);
    expect(read?.filters).toContainEqual([
      "resume_token_hash",
      createHash("sha256").update(token).digest("hex"),
    ]);
    // And never returns one that has expired.
    expect(read?.filters.some(([column]) => column === "gt:expires_at")).toBe(true);
  });

  it("asks the database for the columns it hands back to the participant", async () => {
    /**
     * THE ONE ASSERTION EVERY OTHER TEST IN THIS FILE CANNOT MAKE.
     *
     * The stand-in returns its fixture whatever was projected, so a column
     * dropped from the `.select()` string leaves every other expectation here
     * green while the value silently becomes `undefined` at runtime — the
     * defect this repo has shipped repeatedly, and the reason Supabase clients
     * being untyped means tsc says nothing about it either.
     *
     * Each column below is a SENTENCE A RESIDENT READS. `updated_at` is the
     * date in "We brought back the answers you saved on {date}"; `expires_at`
     * is the date in "You can come back to this page until {date}" — the
     * retention promise itself. Lose either and the form quietly falls back to
     * a vaguer sentence with nobody the wiser.
     */
    const { supabase, ops } = standardClient({ draft: { answers_json: { version: 1, answers: [] } } });
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await resumeDraft(
      draftRequest("POST", { resumeToken: "f".repeat(43) }, "draft/resume"),
      CONTEXT
    );
    const body = (await response.json()) as { savedAt?: string; expiresAt?: string };
    expect(body.savedAt).toBeTruthy();
    expect(body.expiresAt).toBeTruthy();

    const read = ops.find((op) => op.table === "engagement_survey_response_drafts" && op.kind === "select");
    const projected = (read?.columns ?? "").split(",").map((column) => column.trim());
    for (const column of ["answers_json", "expires_at", "updated_at"]) {
      expect(projected, `the resume read must project ${column}`).toContain(column);
    }
  });

  it("says the answers are gone only when the database says there are none", async () => {
    const { supabase } = standardClient({ draft: null });
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await resumeDraft(
      draftRequest("POST", { resumeToken: "b".repeat(43) }, "draft/resume"),
      CONTEXT
    );
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("DRAFT_NOT_FOUND");
  });

  it("REFUSES to report a failed lookup as a lost draft", async () => {
    // The difference matters to a person: "we could not check" leaves their
    // answers where they are, "they are gone" tells them to start over.
    const { supabase } = standardClient({ draftReadError: "connection reset" });
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await resumeDraft(
      draftRequest("POST", { resumeToken: "c".repeat(43) }, "draft/resume"),
      CONTEXT
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; code?: string };
    expect(body.code).toBeUndefined();
    expect(body.error).not.toMatch(/no longer available/i);
  });

  it("refuses a resume credential that is not the shape the server ever issued", async () => {
    const { supabase } = standardClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    for (const token of ["short", "../../etc/passwd", "a".repeat(43) + "'"]) {
      const response = await resumeDraft(draftRequest("POST", { resumeToken: token }, "draft/resume"), CONTEXT);
      expect(response.status, token).toBe(400);
    }
  });

  it("lets a participant discard their own saved answers", async () => {
    const { supabase, ops } = standardClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    const token = "d".repeat(43);
    const response = await discardDraft(draftRequest("DELETE", { resumeToken: token }), CONTEXT);
    expect(response.status).toBe(200);

    const del = ops.find(
      (op) =>
        op.table === "engagement_survey_response_drafts" &&
        op.kind === "delete" &&
        op.filters.some(([column]) => column === "resume_token_hash")
    );
    expect(del?.filters).toContainEqual(["campaign_id", CAMPAIGN.id]);
    expect(del?.filters).toContainEqual(["resume_token_hash", createHash("sha256").update(token).digest("hex")]);
  });
});

describe("a draft is not a response", () => {
  it("writes nothing to the tables every response count reads", async () => {
    // THE DEFECT THIS FORBIDS: a survey reporting 40 responses when 12 of them
    // are drafts nobody finished. `aggregateCampaignSurvey`, the moderation
    // queue and the representativeness reading all read the two tables named
    // here; the save path must not be able to put a row in either.
    const { supabase, ops } = standardClient();
    createServiceRoleClientMock.mockReturnValue(supabase);

    await saveDraft(draftRequest("POST", { answers: [{ questionId: Q_WHY, answer: { text: "hi" } }] }), CONTEXT);
    await resumeDraft(draftRequest("POST", { resumeToken: "e".repeat(43) }, "draft/resume"), CONTEXT);

    const touched = new Set(ops.map((op) => op.table));
    expect(touched.has("engagement_survey_response_sessions")).toBe(false);
    expect(touched.has("engagement_survey_answers")).toBe(false);
  });

  it("keeps the drafts table confined to the one reader module", async () => {
    // Same rule the response tables live under, for the same reason: these rows
    // hold a resident's part-finished demographic answers, and an ad-hoc reader
    // somewhere else is how one ends up on a page it was never meant to reach.
    const sourceRoot = path.resolve(process.cwd(), "src");
    const allowed = path.join("lib", "engagement", "survey-responses.ts");

    function walk(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "test" ? [] : walk(full);
        return [".ts", ".tsx"].includes(path.extname(entry.name)) ? [full] : [];
      });
    }

    const offenders = walk(sourceRoot).filter((file) => {
      if (file.endsWith(allowed)) return false;
      return /\.from\(["']engagement_survey_response_drafts["']\)/.test(fs.readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});
