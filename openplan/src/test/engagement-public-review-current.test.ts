import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicReviewStillCurrent } from "@/lib/engagement/survey-responses";
import type { EngagementReviewSnapshot } from "@/lib/engagement/review-export";

const response = { id: "response", campaign_id: "campaign", status: "published", category_id: null,
  theme_title: "Theme", you_said: "Reviewed reply", we_did: "Reviewed response", source_item_ids: ["reply"],
  ai_assisted: false, sort_order: 0, published_at: "2026-09-06", created_at: "2026-09-06", updated_at: "2026-09-06" };
const source: EngagementReviewSnapshot = { schema: 1, capturedAt: "2026-09-06", scope: "public", filters: {},
  campaign: { id: "campaign", title: "Demonstration", summary: null, configurationVersionId: null },
  items: [{ id: "reply", parent_item_id: "parent", title: null, body: "Reviewed reply", status: "approved", submitted_by: null,
    photo_path: null, geometry: null, latitude: null, longitude: null, category_id: null }],
  sessions: [{ id: "session", status: "approved" }],
  answers: [{ id: "answer", session_id: "session", question_id: "q", question_prompt_snapshot: "Question then", question_type: "free_text",
    answer_text: "Reviewed answer", answer_json: { text: "Reviewed answer" } }], responses: [response], definitions: [] };
type Change = { table: string; id: string; values: Record<string, unknown> };
type SnapshotOptions = { data?: unknown; error?: boolean };
const complete = (entries: Record<string, unknown>[] = [response]) => ({ campaignId: "campaign", publishedOnly: true, count: entries.length, entries });

function client(change?: Change, fail?: string, snapshot?: SnapshotOptions) {
  const rows: Record<string, Record<string, unknown>[]> = {
    engagement_public_items: [...source.items, { id: "parent", parent_item_id: null, status: "approved" }],
    engagement_survey_response_sessions: source.sessions.map(row => ({ ...row, metadata_json: {} })), engagement_survey_answers: source.answers, engagement_closeloop_entries: source.responses,
  };
  const reads: Array<{ table: string; projection: string; campaign: string; ids: string[] }> = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const alter = (table: string, row: Record<string, unknown>) => change?.table === table && change.id === row.id ? { ...row, ...change.values } : row;
  const service = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      expect(name).toBe("read_engagement_response_snapshot");
      expect(args).toEqual({ p_campaign: "campaign", p_published_only: true });
      return { data: snapshot && "data" in snapshot ? snapshot.data : complete(source.responses.map(row => alter("engagement_closeloop_entries", row))),
        error: snapshot?.error ? { message: "SYNTHETIC read refused" } : null };
    },
    from(table: string) {
      return { select(projection: string) { return { eq(column: string, campaign: string) {
        expect(column).toBe("campaign_id");
        return { async in(idColumn: string, ids: string[]) {
          expect(idColumn).toBe("id"); reads.push({ table, projection, campaign, ids });
          return { error: table === fail ? { message: "read refused" } : null,
            data: rows[table].filter(row => ids.includes(String(row.id))).map(row => alter(table, row)) };
        } };
      } }; } };
    },
  } as unknown as SupabaseClient;
  return { service, reads, calls };
}

describe("public report withdrawal", () => {
  it("permits unchanged copies with exact projections, campaign scope and public response RPC", async () => {
    const { service, reads, calls } = client();
    expect(await publicReviewStillCurrent(service, source)).toBe(true);
    expect(reads).toHaveLength(4); expect(reads.every(row => row.campaign === "campaign")).toBe(true);
    expect(reads.map(row => [row.table, row.projection])).toEqual([
      ["engagement_public_items", "id,title,body,submitted_by,photo_path,parent_item_id,geometry,latitude,longitude,category_id,status"],
      ["engagement_public_items", "id,parent_item_id,status"], ["engagement_survey_response_sessions", "id,status,metadata_json"],
      ["engagement_survey_answers", "id,session_id,question_id,question_prompt_snapshot,question_type,answer_text,answer_json"],
    ]);
    expect(calls).toEqual([{ name: "read_engagement_response_snapshot", args: { p_campaign: "campaign", p_published_only: true } }]);
  });
  for (const change of [
    { table: "engagement_public_items", id: "reply", values: { body: "Redacted" } },
    { table: "engagement_public_items", id: "parent", values: { status: "rejected" } },
    { table: "engagement_survey_response_sessions", id: "session", values: { status: "rejected" } },
    { table: "engagement_survey_answers", id: "answer", values: { answer_json: { reviewed_redaction: "Removed" } } },
    ...["theme_title", "you_said", "we_did", "source_item_ids"].map(field => ({ table: "engagement_closeloop_entries", id: "response", values: { [field]: field === "source_item_ids" ? [] : "Changed response" } })),
  ]) it(`withdraws after ${change.table} ${Object.keys(change.values)[0]} changes`, async () => {
    expect(await publicReviewStillCurrent(client(change).service, source)).toBe(false);
  });
  it("refuses a failed current-copy read", async () => {
    expect(await publicReviewStillCurrent(client(undefined, "engagement_survey_answers").service, source)).toBe(false);
  });
  it("refuses a response omitted from public eligibility even if its raw row remains published", async () => {
    expect(await publicReviewStillCurrent(client(undefined, undefined, { data: complete([]) }).service, source)).toBe(false);
  });
  it("does not substitute another eligible response with the same wording", async () => {
    expect(await publicReviewStillCurrent(client(undefined, undefined, { data: complete([{ ...response, id: "other" }]) }).service, source)).toBe(false);
  });
  it.each([
    ["error with stale valid data", { data: complete(), error: true }],
    ["absent snapshot", { data: null }],
    ["incomplete snapshot", { data: { ...complete(), count: 2 } }],
    ["foreign campaign", { data: { ...complete(), campaignId: "foreign" } }],
    ["private snapshot", { data: { ...complete(), publishedOnly: false } }],
    ["draft response", { data: complete([{ ...response, status: "draft" }]) }],
  ] as const)("refuses %s", async (_label, snapshot) => {
    expect(await publicReviewStillCurrent(client(undefined, undefined, snapshot).service, source)).toBe(false);
  });
  it("permits unchanged retained responses when the campaign has additional public responses", async () => {
    expect(await publicReviewStillCurrent(client(undefined, undefined, { data: complete([response, { ...response, id: "other" }]) }).service, source)).toBe(true);
  });
  it.each([
    { visibility: "private" }, { visibility: "\uFEFF Private \u00A0" }, { private_note: true }, { private_note: " TRUE " },
    { internal_note: true }, { internal_note: "\u2003TRUE\u2003" },
  ])("denies a survey-only report with private metadata %j", async metadata => {
    const altered = client({ table: "engagement_survey_response_sessions", id: "session", values: { metadata_json: metadata } });
    expect(await publicReviewStillCurrent(altered.service, { ...source, responses: [] })).toBe(false);
    expect(altered.calls).toHaveLength(0);
  });
  it("refuses missing survey privacy fields", async () => {
    expect(await publicReviewStillCurrent(client({ table: "engagement_survey_response_sessions", id: "session", values: { metadata_json: undefined } }).service, source)).toBe(false);
  });
  it.each([null, {}, { visibility: "PUBLIC", private_note: false, internal_note: "false" }])("permits harmless survey metadata %j", async metadata => {
    expect(await publicReviewStillCurrent(client({ table: "engagement_survey_response_sessions", id: "session", values: { metadata_json: metadata } }).service, source)).toBe(true);
  });
  it("does not require response reads for a snapshot without responses", async () => {
    const { service, calls } = client(undefined, undefined, { error: true });
    expect(await publicReviewStillCurrent(service, { ...source, responses: [] })).toBe(true); expect(calls).toHaveLength(0);
  });
});
