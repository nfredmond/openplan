/**
 * The comment-response record must not misstate what the public said.
 *
 * The failure modes worth testing here are not arithmetic. They are:
 * publishing a comment nobody moderated, publishing an answer the agency has
 * not published yet, and reporting a query that failed as an agency that heard
 * nothing. Each of those is a sentence an agency would have to retract.
 */
import { describe, expect, it } from "vitest";
import {
  RTP_COMMENT_RESPONSE_CAMPAIGN_COLUMNS,
  RTP_COMMENT_RESPONSE_ENTRY_COLUMNS,
  RTP_PUBLIC_COMMENT_COLUMNS,
  buildRtpCommentResponseRecord,
  describeRtpCommentResponse,
  loadRtpCommentResponseRecord,
  rtpCommentResponseTone,
  rtpCommentResponseUnreadableFrom,
  type RtpCommentResponseCampaignInput,
  type RtpCommentResponseEntryInput,
  type RtpCommentResponseQueryResult,
  type RtpCommentResponseSupabaseLike,
  type RtpPublicCommentInput,
} from "@/lib/rtp/comment-response";

// ── A recording fake, so the QUERY itself can be asserted ────────────────────
//
// A mocked Supabase client hands back the fixture whatever columns were asked
// for, so only the `.select()` string can catch a dropped column and only the
// recorded filters can catch a moderation filter that was removed.

type RecordedQuery = {
  table: string;
  columns: string;
  eq: Array<[string, string]>;
  in: Array<[string, readonly string[]]>;
  order: Array<[string, boolean]>;
};

function fakeClient(byTable: Record<string, RtpCommentResponseQueryResult>): {
  client: RtpCommentResponseSupabaseLike;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const recorded: RecordedQuery = { table, columns, eq: [], in: [], order: [] };
          queries.push(recorded);
          const builder = {
            eq(column: string, value: string) {
              recorded.eq.push([column, value]);
              return builder;
            },
            in(column: string, values: readonly string[]) {
              recorded.in.push([column, values]);
              return builder;
            },
            order(column: string, options: { ascending: boolean }) {
              recorded.order.push([column, options.ascending]);
              return builder;
            },
            then(onfulfilled: (value: RtpCommentResponseQueryResult) => unknown) {
              return Promise.resolve(byTable[table] ?? { data: [], error: null }).then(onfulfilled);
            },
          };
          return builder;
        },
      };
    },
  };
  return { client: client as unknown as RtpCommentResponseSupabaseLike, queries };
}

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    title: "Draft plan review",
    summary: "Tell us what you think of the draft RTP.",
    status: "active",
    engagement_type: "comment_collection",
    rtp_cycle_chapter_id: null,
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "comment-1",
    campaign_id: "campaign-1",
    parent_item_id: null,
    category_id: "category-1",
    title: "Bus frequency",
    body: "The evening service is too infrequent to get home from a shift.",
    submitted_by: "A resident",
    source_type: "public",
    status: "approved",
    metadata_json: {},
    created_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function responseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "response-1",
    campaign_id: "campaign-1",
    theme_title: "Evening service",
    you_said: "Evening buses are too infrequent.",
    we_did: "Added an evening frequency project to the first horizon band.",
    status: "published",
    ai_assisted: false,
    source_item_ids: ["comment-1"],
    sort_order: 0,
    published_at: "2026-04-01T00:00:00Z",
    created_at: "2026-03-15T00:00:00Z",
    ...overrides,
  };
}

// ── Fixtures for the pure builder ────────────────────────────────────────────

const CAMPAIGN: RtpCommentResponseCampaignInput = {
  id: "campaign-1",
  title: "Draft plan review",
  summary: null,
  status: "active",
  engagementType: "comment_collection",
  chapterId: null,
  updatedAt: "2026-03-01T00:00:00Z",
};

function comment(overrides: Partial<RtpPublicCommentInput> = {}): RtpPublicCommentInput {
  return {
    id: "comment-1",
    campaignId: "campaign-1",
    parentCommentId: null,
    categoryId: null,
    title: null,
    body: "The evening service is too infrequent.",
    submittedBy: "A resident",
    sourceType: "public",
    status: "approved",
    metadata: {},
    createdAt: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function response(overrides: Partial<RtpCommentResponseEntryInput> = {}): RtpCommentResponseEntryInput {
  return {
    id: "response-1",
    campaignId: "campaign-1",
    themeTitle: "Evening service",
    youSaid: "Evening buses are too infrequent.",
    weDid: "Added an evening frequency project.",
    status: "published",
    aiAssisted: false,
    citedCommentIds: ["comment-1"],
    sortOrder: 0,
    publishedAt: "2026-04-01T00:00:00Z",
    createdAt: "2026-03-15T00:00:00Z",
    ...overrides,
  };
}

const ALL_READ: { campaigns: boolean; comments: boolean; responses: boolean } = {
  campaigns: false,
  comments: false,
  responses: false,
};

describe("the join from a plan to what the public said about it", () => {
  it("asks the database for the columns it renders, and for approved comments only", async () => {
    const { client, queries } = fakeClient({
      engagement_campaigns: { data: [campaignRow()], error: null },
      engagement_items: { data: [commentRow()], error: null },
      engagement_closeloop_entries: { data: [responseRow()], error: null },
    });

    const loaded = await loadRtpCommentResponseRecord(client, "cycle-1");

    const campaignQuery = queries.find((query) => query.table === "engagement_campaigns");
    expect(campaignQuery?.columns).toBe(RTP_COMMENT_RESPONSE_CAMPAIGN_COLUMNS);
    // The plan → consultation edge is engagement_campaigns.rtp_cycle_id.
    expect(campaignQuery?.eq).toContainEqual(["rtp_cycle_id", "cycle-1"]);

    const commentQuery = queries.find((query) => query.table === "engagement_items");
    expect(commentQuery?.columns).toBe(RTP_PUBLIC_COMMENT_COLUMNS);
    expect(commentQuery?.in).toContainEqual(["campaign_id", ["campaign-1"]]);
    // THE MODERATION FILTER. Without it an unmoderated comment reaches a
    // published agency document.
    expect(commentQuery?.eq).toContainEqual(["status", "approved"]);

    const responseQuery = queries.find((query) => query.table === "engagement_closeloop_entries");
    expect(responseQuery?.columns).toBe(RTP_COMMENT_RESPONSE_ENTRY_COLUMNS);
    expect(responseQuery?.in).toContainEqual(["campaign_id", ["campaign-1"]]);

    expect(loaded.campaigns.map((campaign) => campaign.id)).toEqual(["campaign-1"]);
    expect(loaded.comments.map((item) => item.id)).toEqual(["comment-1"]);
    expect(loaded.responses[0]?.citedCommentIds).toEqual(["comment-1"]);
  });

  /**
   * ASSERTING `query.columns === THE_CONSTANT` IS VACUOUS ON ITS OWN, and this
   * test exists because a mutation proved it: deleting `status` from
   * `RTP_PUBLIC_COMMENT_COLUMNS` moved both sides of that equality and the
   * whole file stayed green, while the real loader would have stopped being
   * able to re-check moderation. The equality proves the query uses the
   * constant; only the list below proves the constant names what the record
   * reads. A mocked client returns the fixture whatever was selected, so this
   * string is the only place a dropped column can be caught.
   */
  it("names in its projections every column the record actually reads", () => {
    expect(RTP_COMMENT_RESPONSE_CAMPAIGN_COLUMNS.split(", ").sort()).toEqual(
      [
        "id", // the campaign a comment belongs to
        "title", // shown against every comment in the record
        "summary", // what the agency said it was asking about
        "status", // whether the consultation is still open
        "engagement_type", // how comment was gathered
        "rtp_cycle_chapter_id", // a consultation about one chapter, not the plan
        "updated_at",
      ].sort()
    );

    expect(RTP_PUBLIC_COMMENT_COLUMNS.split(", ").sort()).toEqual(
      [
        "id",
        "campaign_id",
        "parent_item_id", // a reply is public comment too (20260720000097)
        "category_id",
        "title",
        "body", // what was actually said
        "submitted_by",
        "source_type", // portal vs. open house vs. staff note
        "status", // WITHOUT THIS the builder cannot re-check moderation
        "metadata_json", // carries the operator's "private" marking
        "created_at", // the record is a chronology
      ].sort()
    );

    // The response projection is the engagement module's own constant, which may
    // legitimately grow in that lane — so this asserts what the record needs is
    // present rather than pinning the whole list.
    for (const column of [
      "campaign_id",
      "theme_title",
      "you_said",
      "we_did",
      "status", // draft vs. published — rule 2
      "ai_assisted",
      "source_item_ids", // THE CITATION back to the comments
      "sort_order",
      "published_at",
    ]) {
      expect(RTP_COMMENT_RESPONSE_ENTRY_COLUMNS.split(", ")).toContain(column);
    }
  });

  /**
   * SELECTING A COLUMN AND CARRYING IT ARE DIFFERENT THINGS, and the projection
   * assertions above cannot tell them apart. Three mutations proved it: making
   * the loader map `metadata: null`, `body: null` and the campaign `title: null`
   * — while every projection stayed intact — left the whole file green. The
   * metadata one is the dangerous member of that set, because `metadata_json`
   * is the ONLY carrier of the operator's "private" marking, so a loader that
   * drops it publishes every privately marked comment while the builder's own
   * privacy tests keep passing on their hand-built inputs.
   *
   * So this asserts every mapped field, and the metadata one is asserted
   * end-to-end below rather than as a field, because a field can be carried and
   * still not reach the decision it exists for.
   */
  it("carries every projected column into the object the record is built from", async () => {
    const { client } = fakeClient({
      engagement_campaigns: {
        data: [
          campaignRow({
            rtp_cycle_chapter_id: "chapter-9",
            title: "Chapter 4 workshop",
            summary: "What should the transit chapter say?",
            status: "closed",
            engagement_type: "meeting_intake",
            updated_at: "2026-03-09T00:00:00Z",
          }),
        ],
        error: null,
      },
      engagement_items: {
        data: [
          commentRow({
            parent_item_id: "comment-0",
            category_id: "category-7",
            title: "Evening service",
            body: "The last bus leaves before my shift ends.",
            submitted_by: "R. Alvarez",
            source_type: "email",
            metadata_json: { visibility: "public" },
            created_at: "2026-02-11T00:00:00Z",
          }),
        ],
        error: null,
      },
      engagement_closeloop_entries: {
        data: [
          responseRow({
            theme_title: "Evening service",
            you_said: "Evening buses stop too early.",
            we_did: "Added a later trip to the constrained list.",
            status: "published",
            ai_assisted: true,
            sort_order: 3,
            published_at: "2026-04-02T00:00:00Z",
            created_at: "2026-03-16T00:00:00Z",
          }),
        ],
        error: null,
      },
    });

    const loaded = await loadRtpCommentResponseRecord(client, "cycle-1");

    expect(loaded.campaigns[0]).toEqual({
      id: "campaign-1",
      title: "Chapter 4 workshop",
      summary: "What should the transit chapter say?",
      status: "closed",
      engagementType: "meeting_intake",
      chapterId: "chapter-9",
      updatedAt: "2026-03-09T00:00:00Z",
    });

    expect(loaded.comments[0]).toEqual({
      id: "comment-1",
      campaignId: "campaign-1",
      parentCommentId: "comment-0",
      categoryId: "category-7",
      title: "Evening service",
      body: "The last bus leaves before my shift ends.",
      submittedBy: "R. Alvarez",
      sourceType: "email",
      status: "approved",
      metadata: { visibility: "public" },
      createdAt: "2026-02-11T00:00:00Z",
    });

    expect(loaded.responses[0]).toEqual({
      id: "response-1",
      campaignId: "campaign-1",
      themeTitle: "Evening service",
      youSaid: "Evening buses stop too early.",
      weDid: "Added a later trip to the constrained list.",
      status: "published",
      aiAssisted: true,
      citedCommentIds: ["comment-1"],
      sortOrder: 3,
      publishedAt: "2026-04-02T00:00:00Z",
      createdAt: "2026-03-16T00:00:00Z",
    });
  });

  it("holds a privately marked row out of the record all the way from the DATABASE ROW", async () => {
    // The seam, not the unit: loader → builder, on rows shaped like the table.
    // A loader that selects `metadata_json` and then forgets to carry it makes
    // every privately marked comment public, and no builder-level test can see
    // that happen.
    const { client } = fakeClient({
      engagement_campaigns: { data: [campaignRow()], error: null },
      engagement_items: {
        data: [
          commentRow({ id: "public-one", metadata_json: {} }),
          commentRow({
            id: "private-one",
            metadata_json: { visibility: "private" },
            body: "a resident's home address",
          }),
        ],
        error: null,
      },
      engagement_closeloop_entries: { data: [], error: null },
    });

    const loaded = await loadRtpCommentResponseRecord(client, "cycle-1");
    const summary = buildRtpCommentResponseRecord({
      ...loaded,
      unreadable: rtpCommentResponseUnreadableFrom(loaded.results),
    });

    expect(summary.entries.map((entry) => entry.comment.id)).toEqual(["public-one"]);
    expect(summary.withheld.map((item) => item.reason)).toEqual(["marked_private"]);
    expect(JSON.stringify(summary)).not.toContain("home address");
    // And the comment that IS in the record carries its text and its campaign.
    expect(summary.entries[0]?.comment.body).toContain("evening service");
    expect(summary.entries[0]?.comment.campaignTitle).toBe("Draft plan review");
  });
});

describe("a read that failed is never an agency that heard nothing", () => {
  it("does not report unqueried comments as an empty result when the campaign read fails", async () => {
    const { client, queries } = fakeClient({
      engagement_campaigns: { data: null, error: { message: "permission denied for table engagement_campaigns" } },
    });

    const loaded = await loadRtpCommentResponseRecord(client, "cycle-1");

    // The dependent queries never ran, so they may not answer "there are none".
    expect(queries.map((query) => query.table)).toEqual(["engagement_campaigns"]);
    expect(loaded.results.comments.error).not.toBeNull();
    expect(loaded.results.responses.error).not.toBeNull();

    const unreadable = rtpCommentResponseUnreadableFrom(loaded.results);
    expect(unreadable).toEqual({ campaigns: true, comments: true, responses: true });

    const summary = buildRtpCommentResponseRecord({ ...loaded, unreadable });
    expect(summary.approvedCommentCount).toBeNull();
    expect(summary.answeredCount).toBeNull();
    expect(summary.unansweredCount).toBeNull();
    expect(summary.hasUnansweredComments).toBeNull();
    expect(describeRtpCommentResponse(summary)).toContain("could not be read");
    expect(describeRtpCommentResponse(summary)).not.toMatch(/\b0\b/);
  });

  it("does report a genuine absence of engagement as an absence", async () => {
    const { client, queries } = fakeClient({ engagement_campaigns: { data: [], error: null } });

    const loaded = await loadRtpCommentResponseRecord(client, "cycle-1");

    expect(queries).toHaveLength(1);
    expect(loaded.results.comments.error).toBeNull();
    const summary = buildRtpCommentResponseRecord({
      ...loaded,
      unreadable: rtpCommentResponseUnreadableFrom(loaded.results),
    });
    expect(summary.campaignsReadable).toBe(true);
    expect(describeRtpCommentResponse(summary)).toContain("No public engagement is attached to this plan");
    // No consultation attached is not an achievement.
    expect(rtpCommentResponseTone(summary)).toBe("neutral");
  });

  it("does not call an unread comment table 'no engagement attached to this plan'", () => {
    // An empty campaign list plus a failed comment read must report the FAILED
    // READ. "There is no comment-response record to publish yet" is a claim
    // about the comment table, and it may not be made while that table is
    // unread — the empty list can come from a scoping change rather than from
    // an agency that consulted nobody.
    const summary = buildRtpCommentResponseRecord({
      campaigns: [],
      comments: [],
      responses: [],
      unreadable: { ...ALL_READ, comments: true },
    });

    const sentence = describeRtpCommentResponse(summary);
    expect(sentence).toContain("could not be read");
    expect(sentence).not.toContain("No public engagement is attached");
  });

  it("counts nothing when the comments could not be read", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [],
      responses: [response()],
      unreadable: { ...ALL_READ, comments: true },
    });

    expect(summary.approvedCommentCount).toBeNull();
    expect(summary.answeredCount).toBeNull();
    expect(summary.unansweredCount).toBeNull();
    expect(summary.withheldCount).toBeNull();
    expect(summary.hasUnansweredComments).toBeNull();
    expect(summary.entries).toEqual([]);
    expect(rtpCommentResponseTone(summary)).toBe("neutral");

    const sentence = describeRtpCommentResponse(summary);
    expect(sentence).toContain("could not be read");
    expect(sentence).toContain("not an empty record");
    expect(sentence).not.toMatch(/\d/);
  });

  it("knows how many comments there are but not how many were answered when the responses fail", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [comment({ id: "a" }), comment({ id: "b" })],
      responses: [],
      unreadable: { ...ALL_READ, responses: true },
    });

    expect(summary.approvedCommentCount).toBe(2);
    expect(summary.answeredCount).toBeNull();
    expect(summary.unansweredCount).toBeNull();
    expect(summary.hasUnansweredComments).toBeNull();
    // No comment may be listed as outstanding when "answered" is unknowable.
    expect(summary.outstanding).toEqual([]);
    expect(rtpCommentResponseTone(summary)).toBe("neutral");

    const sentence = describeRtpCommentResponse(summary);
    expect(sentence).toContain("2 approved public comments are recorded");
    expect(sentence).toContain("could not be read");
    // It may not answer the question it could not answer.
    expect(sentence).not.toMatch(/\b0 (has|have|is|are)\b/);
    expect(sentence).not.toMatch(/outstanding/);
  });
});

describe("only what a human moderated may be published", () => {
  it("keeps a pending, rejected or flagged comment out of the record even when handed one directly", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [
        comment({ id: "approved", status: "approved" }),
        comment({ id: "pending", status: "pending", body: "unmoderated text" }),
        comment({ id: "rejected", status: "rejected", body: "abusive text" }),
        comment({ id: "flagged", status: "flagged", body: "flagged text" }),
      ],
      responses: [],
      unreadable: ALL_READ,
    });

    expect(summary.entries.map((entry) => entry.comment.id)).toEqual(["approved"]);
    expect(summary.approvedCommentCount).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("unmoderated text");
    expect(JSON.stringify(summary)).not.toContain("abusive text");
    expect(summary.withheld.filter((item) => item.reason === "not_approved")).toHaveLength(3);
  });

  it("holds a staff note and a privately marked comment out of the published record", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [
        comment({ id: "public", sourceType: "public" }),
        comment({ id: "staff", sourceType: "internal", body: "call the county about right of way" }),
        comment({ id: "private", sourceType: "public", metadata: { visibility: "private" }, body: "a named complainant" }),
        comment({ id: "private-note", sourceType: "public", metadata: { private_note: true }, body: "second private" }),
        comment({ id: "internal-note", sourceType: "public", metadata: { internal_note: true }, body: "third private" }),
      ],
      responses: [],
      unreadable: ALL_READ,
    });

    expect(summary.entries.map((entry) => entry.comment.id)).toEqual(["public"]);
    expect(JSON.stringify(summary)).not.toContain("right of way");
    expect(JSON.stringify(summary)).not.toContain("a named complainant");
    expect(summary.withheld.map((item) => item.reason).sort()).toEqual([
      "marked_private",
      "marked_private",
      "marked_private",
      "staff_note",
    ]);
    expect(describeRtpCommentResponse(summary)).toContain("held out of the published record");
  });

  it("does not describe an UNMODERATED comment as an approved item held out as a staff note", () => {
    // Both are withheld, and they are withheld for opposite reasons. Counting
    // them together made the published sentence say the agency had approved
    // comment it was holding back, over items that never cleared moderation —
    // a false statement about moderation in the document a resident inspects.
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [
        comment({ id: "public" }),
        comment({ id: "pending-1", status: "pending" }),
        comment({ id: "pending-2", status: "flagged" }),
      ],
      responses: [response({ citedCommentIds: ["public"] })],
      unreadable: ALL_READ,
    });

    expect(summary.withheldCount).toBe(2);
    const sentence = describeRtpCommentResponse(summary);
    expect(sentence).not.toContain("held out of the published record");
    expect(sentence).not.toContain("2 approved");

    // One genuine staff note, and the count is that one — not all three.
    const withStaffNote = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [
        comment({ id: "public" }),
        comment({ id: "pending-1", status: "pending" }),
        comment({ id: "pending-2", status: "flagged" }),
        comment({ id: "staff", sourceType: "internal" }),
      ],
      responses: [response({ citedCommentIds: ["public"] })],
      unreadable: ALL_READ,
    });
    expect(describeRtpCommentResponse(withStaffNote)).toContain(
      "1 approved item is held out of the published record"
    );
  });

  it("KEEPS offline public comment in the record — a meeting card is not a staff note", () => {
    // The regression this guards: treating everything that did not arrive
    // through the portal as internal would silently delete every paper comment
    // card and every letter an agency transcribed, in the one document that
    // proves it listened.
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [
        comment({ id: "portal", sourceType: "public" }),
        comment({ id: "open-house", sourceType: "meeting" }),
        comment({ id: "letter", sourceType: "email" }),
      ],
      responses: [],
      unreadable: ALL_READ,
    });

    expect(summary.entries.map((entry) => entry.comment.id).sort()).toEqual(["letter", "open-house", "portal"]);
    expect(summary.approvedCommentCount).toBe(3);
    expect(summary.withheld).toEqual([]);
  });
});

describe("what the agency did about it", () => {
  it("pairs each comment with the published response that cites it", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [comment({ id: "a", createdAt: "2026-02-01T00:00:00Z" }), comment({ id: "b", createdAt: "2026-02-02T00:00:00Z" })],
      responses: [response({ id: "r1", citedCommentIds: ["a"] })],
      unreadable: ALL_READ,
    });

    expect(summary.entries.map((entry) => [entry.comment.id, entry.response?.id])).toEqual([
      ["a", "r1"],
      ["b", undefined],
    ]);
    expect(summary.entries[0]?.response?.weDid).toContain("Added an evening frequency project");
    expect(summary.entries[0]?.comment.campaignTitle).toBe("Draft plan review");
    expect(summary.answeredCount).toBe(1);
    expect(summary.unansweredCount).toBe(1);
    expect(summary.publishedResponseCount).toBe(1);
    expect(summary.outstanding.map((entry) => entry.comment.id)).toEqual(["b"]);
  });

  it("does not let a DRAFT response answer a comment, or carry its words anywhere", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [comment({ id: "a" })],
      responses: [
        response({
          id: "draft-1",
          status: "draft",
          weDid: "we are still arguing about this internally",
          youSaid: "unpublished paraphrase",
          publishedAt: null,
          citedCommentIds: ["a"],
        }),
      ],
      unreadable: ALL_READ,
    });

    expect(summary.entries[0]?.response).toBeNull();
    expect(summary.entries[0]?.hasDraftResponse).toBe(true);
    expect(summary.answeredCount).toBe(0);
    expect(summary.unansweredCount).toBe(1);
    expect(summary.draftedResponseCount).toBe(1);
    expect(summary.publishedResponseCount).toBe(0);
    // Rule 2: no unpublished text leaves this module, in any field.
    expect(JSON.stringify(summary)).not.toContain("still arguing");
    expect(JSON.stringify(summary)).not.toContain("unpublished paraphrase");
    expect(describeRtpCommentResponse(summary)).toContain("drafted response awaiting publication");
  });

  it("surfaces a published response that answers no comment in the record", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [comment({ id: "a" })],
      responses: [
        response({ id: "linked", citedCommentIds: ["a"] }),
        response({ id: "unlinked", citedCommentIds: [], sortOrder: 1 }),
        response({ id: "cites-a-rejected-comment", citedCommentIds: ["gone"], sortOrder: 2 }),
      ],
      unreadable: ALL_READ,
    });

    expect(summary.unlinkedPublishedResponses.map((entry) => entry.id)).toEqual([
      "unlinked",
      "cites-a-rejected-comment",
    ]);
    expect(summary.unlinkedPublishedResponses[1]?.citedCommentCount).toBe(1);
    expect(summary.unlinkedPublishedResponses[1]?.matchedCommentCount).toBe(0);
    expect(summary.publishedResponseCount).toBe(3);
    expect(describeRtpCommentResponse(summary)).toContain("cite no comment in this record");
  });

  it("gives a comment cited by two published responses the first in display order", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [comment({ id: "a" })],
      responses: [
        response({ id: "second", sortOrder: 5, citedCommentIds: ["a"] }),
        response({ id: "first", sortOrder: 1, citedCommentIds: ["a"] }),
      ],
      unreadable: ALL_READ,
    });

    expect(summary.entries[0]?.response?.id).toBe("first");
  });
});

describe("an unanswered comment is an outstanding item, not a blocked adoption", () => {
  it("warns without blocking, and says so in words", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [comment({ id: "a" }), comment({ id: "b", createdAt: "2026-02-05T00:00:00Z" })],
      responses: [response({ citedCommentIds: ["a"] })],
      unreadable: ALL_READ,
    });

    expect(summary.hasUnansweredComments).toBe(true);
    expect(summary.outstanding.map((entry) => entry.comment.id)).toEqual(["b"]);
    expect(rtpCommentResponseTone(summary)).toBe("warning");

    const sentence = describeRtpCommentResponse(summary);
    expect(sentence).toContain("1 is still outstanding");
    expect(sentence).toContain("not a bar to adopting the plan");
    // Nothing in this module may read as a gate.
    expect(sentence).not.toMatch(/block|cannot be adopted|fails|invalid/i);
    expect(Object.keys(summary)).not.toContain("verdict");
    expect(Object.keys(summary)).not.toContain("blockers");
  });

  it("is not green when comments exist but no consultation does", () => {
    // Varies the OTHER half of the empty-record check: a mutation that dropped
    // `campaigns.length === 0` survived while every case that reached it also
    // had zero comments. Answered comment whose campaign is missing from the
    // record is an inconsistent record, not a completed one.
    const summary = buildRtpCommentResponseRecord({
      campaigns: [],
      comments: [comment({ id: "a" })],
      responses: [response({ citedCommentIds: ["a"] })],
      unreadable: ALL_READ,
    });

    expect(summary.approvedCommentCount).toBe(1);
    expect(summary.hasUnansweredComments).toBe(false);
    expect(summary.entries[0]?.comment.campaignTitle).toBeNull();
    expect(rtpCommentResponseTone(summary)).toBe("neutral");
  });

  it("says every comment is answered only when every one is", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [comment({ id: "a" })],
      responses: [response({ citedCommentIds: ["a"] })],
      unreadable: ALL_READ,
    });

    expect(summary.hasUnansweredComments).toBe(false);
    expect(rtpCommentResponseTone(summary)).toBe("success");
    expect(describeRtpCommentResponse(summary)).toContain("every one has a published response");
  });

  it("distinguishes an empty record from an unanswered one", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [],
      responses: [],
      unreadable: ALL_READ,
    });

    expect(summary.approvedCommentCount).toBe(0);
    expect(summary.hasUnansweredComments).toBe(false);
    // NOT a success. "Every comment has a response" is trivially true of no
    // comments, and a green badge over an empty record tells a board the
    // consultation is complete when nothing has been gathered.
    expect(rtpCommentResponseTone(summary)).toBe("neutral");
    const sentence = describeRtpCommentResponse(summary);
    expect(sentence).toContain("No public comment on this plan has been approved for publication yet");
    expect(sentence).toContain("rather than unanswered");
  });
});

describe("the record reads as a chronology", () => {
  it("orders comments by when they were made, and puts an undated one last", () => {
    const summary = buildRtpCommentResponseRecord({
      campaigns: [CAMPAIGN],
      comments: [
        comment({ id: "undated", createdAt: null }),
        comment({ id: "later", createdAt: "2026-02-09T00:00:00Z" }),
        comment({ id: "earlier", createdAt: "2026-02-01T00:00:00Z" }),
      ],
      responses: [],
      unreadable: ALL_READ,
    });

    expect(summary.entries.map((entry) => entry.comment.id)).toEqual(["earlier", "later", "undated"]);
  });
});
