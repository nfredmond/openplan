/**
 * The comment-response record — what the public said about a draft plan, and
 * what the agency did about it.
 *
 * 23 CFR 450.316(a) requires an MPO to "consider and respond to public input
 * received"; 450.324(b) requires the same for the plan itself, and the response
 * is the artifact a court, a funder or a resident actually inspects. OpenPlan
 * already holds both halves — public comment in `engagement_items`, the
 * agency's answer in `engagement_closeloop_entries` ("you said / we did") — and
 * `engagement_campaigns.rtp_cycle_id` (20260409000038) is the edge that says
 * which consultation was about which plan. Nothing joined the three, so an
 * agency could hold a complete record and have no way to publish it.
 *
 * ══ THE JOIN PATH, ESTABLISHED BY READING THE SCHEMA ══
 *
 *   rtp_cycles.id
 *     ← engagement_campaigns.rtp_cycle_id  (nullable; rtp_cycle_chapter_id may
 *       narrow the same campaign to one chapter, and the table's own CHECK
 *       makes a chapter without a cycle unstorable)
 *       ← engagement_items.campaign_id     (status ∈ pending|approved|rejected|
 *         flagged — `approved` is the only publishable one)
 *       ← engagement_closeloop_entries.campaign_id
 *           .source_item_ids uuid[]        ← the citation back to the comments
 *           .status ∈ draft|published      ← a draft has never been public
 *
 * ══ FOUR RULES THIS MODULE ENFORCES BY SHAPE, NOT BY CONVENTION ══
 *
 * 1. ONLY APPROVED COMMENT IS IN THE RECORD. Publishing an unmoderated comment
 *    is a real harm — it is how a resident's phone number, or somebody's abuse,
 *    ends up on an agency letterhead. `pending`, `rejected` and `flagged` are
 *    filtered in the query AND re-checked in the pure builder, because the two
 *    are used independently and a caller that assembles its own inputs must not
 *    be able to slip a pending comment in.
 *
 * 2. A DRAFT RESPONSE CARRIES NO TEXT OUT OF HERE. `engagement_closeloop_entries`
 *    starts life as `draft` precisely so an agency can write its answer before
 *    standing behind it, and its own migration says drafts never leave the
 *    operator. So a draft is reported as a COUNT and a per-comment boolean, and
 *    its `we_did` text is not carried into the summary at all — a public
 *    renderer holding this object cannot print it, whatever it does.
 *
 * 3. A READ THAT FAILED IS NEVER A COUNT. Every count here is `number | null`,
 *    and null is what a failed read produces. "No comment was received" and
 *    "the comment query failed" are opposite facts about an agency, and the
 *    second must never be published as the first.
 *
 * 4. AN UNANSWERED COMMENT IS RECORDED AND WARNED, NEVER A BLOCK. Decided by
 *    Nathaniel. There is no verdict, no gate, and nothing in this module returns
 *    a pass/fail — `outstanding` is a work-list and the wording says so. An
 *    agency may adopt a plan with comments still to answer; what it may not do
 *    is not know.
 */
import { CLOSE_LOOP_ENTRY_COLUMNS } from "@/lib/engagement/close-loop";
import { isInternalOrPrivateEngagementNote } from "@/lib/engagement/comment-matrix";

// ── The reads ────────────────────────────────────────────────────────────────

export type RtpCommentResponseQueryResult = {
  data: unknown;
  error: { message?: string | null } | null;
};

type QueryBuilder = PromiseLike<RtpCommentResponseQueryResult> & {
  eq(column: string, value: string): QueryBuilder;
  in(column: string, values: readonly string[]): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
};

export interface RtpCommentResponseSupabaseLike {
  from(table: string): { select(columns: string): QueryBuilder };
}

/**
 * The projection every surface must select before rendering a campaign.
 *
 * `rtp_cycle_chapter_id` is here because a consultation may be about one
 * chapter rather than the whole plan, and a record that flattens the two
 * misreports the scope of what was asked.
 */
export const RTP_COMMENT_RESPONSE_CAMPAIGN_COLUMNS =
  "id, title, summary, status, engagement_type, rtp_cycle_chapter_id, updated_at";

/**
 * The projection every surface must select before rendering a comment.
 *
 * `status` is selected even though the query filters on it: the pure builder
 * re-checks it (rule 1), and it cannot re-check a column nobody asked for.
 * `metadata_json` is what carries an operator's "this one is private" marking.
 */
export const RTP_PUBLIC_COMMENT_COLUMNS =
  "id, campaign_id, parent_item_id, category_id, title, body, submitted_by, source_type, status, metadata_json, created_at";

/**
 * Responses reuse the engagement module's own projection rather than restating
 * it. A second column list would drift from the first, and the failure mode is
 * silent: the record would simply stop showing whatever column was added.
 */
export const RTP_COMMENT_RESPONSE_ENTRY_COLUMNS = CLOSE_LOOP_ENTRY_COLUMNS;

/** The moderation status that may be published. Nothing else is in the record. */
export const RTP_PUBLISHABLE_COMMENT_STATUS = "approved";

/** The response status that has actually been shown to the public. */
export const RTP_PUBLISHED_RESPONSE_STATUS = "published";

export interface RtpCommentResponseCampaignInput {
  id: string;
  title: string | null;
  summary: string | null;
  status: string | null;
  engagementType: string | null;
  /** Set when the consultation was about one chapter rather than the whole plan. */
  chapterId: string | null;
  updatedAt: string | null;
}

export interface RtpPublicCommentInput {
  id: string;
  campaignId: string;
  parentCommentId: string | null;
  categoryId: string | null;
  title: string | null;
  body: string | null;
  submittedBy: string | null;
  sourceType: string | null;
  /** The moderation status as stored — re-checked, not assumed. */
  status: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
}

export interface RtpCommentResponseEntryInput {
  id: string;
  campaignId: string;
  themeTitle: string | null;
  youSaid: string | null;
  weDid: string | null;
  /** `draft` | `published` as stored; anything else is treated as unpublished. */
  status: string | null;
  aiAssisted: boolean;
  /** `engagement_closeloop_entries.source_item_ids` — the citation to comments. */
  citedCommentIds: readonly string[];
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string | null;
}

export interface RtpCommentResponseLoadResult {
  campaigns: RtpCommentResponseCampaignInput[];
  comments: RtpPublicCommentInput[];
  responses: RtpCommentResponseEntryInput[];
  /**
   * The raw results, so the CALLER discloses each failure in its own words —
   * the same seam `loadRtpFinancialElement` uses. A loader that swallowed these
   * would let a page publish "no comment was received on this plan" over a
   * query that failed.
   */
  results: {
    campaigns: RtpCommentResponseQueryResult;
    comments: RtpCommentResponseQueryResult;
    responses: RtpCommentResponseQueryResult;
  };
}

type CampaignRow = {
  id: string;
  title: string | null;
  summary: string | null;
  status: string | null;
  engagement_type: string | null;
  rtp_cycle_chapter_id: string | null;
  updated_at: string | null;
};

type CommentRow = {
  id: string;
  campaign_id: string;
  parent_item_id: string | null;
  category_id: string | null;
  title: string | null;
  body: string | null;
  submitted_by: string | null;
  source_type: string | null;
  status: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
};

type ResponseRow = {
  id: string;
  campaign_id: string;
  theme_title: string | null;
  you_said: string | null;
  we_did: string | null;
  status: string | null;
  ai_assisted: boolean | null;
  source_item_ids: string[] | null;
  sort_order: number | null;
  published_at: string | null;
  created_at: string | null;
};

/**
 * Why a dependent read reports its own failure instead of an empty result.
 *
 * When the campaign read fails there is no id list to query comments with, so
 * the comment query is not run. Returning `{ data: [], error: null }` for it
 * would tell the caller the comments were read and there were none — which is
 * the exact defect this module exists to prevent, arriving through the back
 * door. The synthesized error names the cause so a `ReadFailureLog` line reads
 * as a consequence rather than a second unrelated outage.
 */
function notQueried(reason: string): RtpCommentResponseQueryResult {
  return { data: null, error: { message: reason } };
}

/**
 * The campaigns targeting one RTP cycle, their approved public comments, and
 * every response recorded against them.
 *
 * Workspace scoping is the CALLER's job and is already done by the time this
 * runs: a route resolves the membership and verifies the cycle belongs to that
 * workspace, and every table read here is reachable only through campaigns of
 * that cycle (RLS scopes `engagement_campaigns` to the member's workspace as
 * well). Passing a workspace id in here would add a second, weaker check of
 * something already established.
 *
 * Drafts ARE loaded. The builder needs to know a response exists in order to
 * say "drafted, not published" — it just never carries the draft's words out.
 */
export async function loadRtpCommentResponseRecord(
  supabase: RtpCommentResponseSupabaseLike,
  rtpCycleId: string
): Promise<RtpCommentResponseLoadResult> {
  const campaignsResult = await supabase
    .from("engagement_campaigns")
    .select(RTP_COMMENT_RESPONSE_CAMPAIGN_COLUMNS)
    .eq("rtp_cycle_id", rtpCycleId)
    .order("updated_at", { ascending: false });

  const campaignRows = (campaignsResult.data ?? []) as CampaignRow[];
  const campaigns: RtpCommentResponseCampaignInput[] = campaignRows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    engagementType: row.engagement_type,
    chapterId: row.rtp_cycle_chapter_id,
    updatedAt: row.updated_at,
  }));

  if (campaignsResult.error) {
    const reason =
      "the engagement attached to this plan could not be read, so its comments and responses were not queried";
    return {
      campaigns: [],
      comments: [],
      responses: [],
      results: {
        campaigns: campaignsResult,
        comments: notQueried(reason),
        responses: notQueried(reason),
      },
    };
  }

  const campaignIds = campaigns.map((campaign) => campaign.id);
  if (campaignIds.length === 0) {
    // A successful read that found no campaign IS the answer "none": no
    // consultation is attached to this plan, so there is nothing to query.
    return {
      campaigns,
      comments: [],
      responses: [],
      results: {
        campaigns: campaignsResult,
        comments: { data: [], error: null },
        responses: { data: [], error: null },
      },
    };
  }

  const [commentsResult, responsesResult] = await Promise.all([
    supabase
      .from("engagement_items")
      .select(RTP_PUBLIC_COMMENT_COLUMNS)
      .in("campaign_id", campaignIds)
      // Moderation is enforced in the query as well as in the builder. Neither
      // alone is enough: the query protects callers that read rows straight out
      // of the loader, the builder protects callers that assemble their own.
      .eq("status", RTP_PUBLISHABLE_COMMENT_STATUS)
      // Chronological, because a record reads as a chronology of what was said.
      .order("created_at", { ascending: true }),
    supabase
      .from("engagement_closeloop_entries")
      .select(RTP_COMMENT_RESPONSE_ENTRY_COLUMNS)
      .in("campaign_id", campaignIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const comments = ((commentsResult.data ?? []) as CommentRow[]).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    parentCommentId: row.parent_item_id,
    categoryId: row.category_id,
    title: row.title,
    body: row.body,
    submittedBy: row.submitted_by,
    sourceType: row.source_type,
    status: row.status,
    metadata: row.metadata_json,
    createdAt: row.created_at,
  }));

  const responses = ((responsesResult.data ?? []) as ResponseRow[]).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    themeTitle: row.theme_title,
    youSaid: row.you_said,
    weDid: row.we_did,
    status: row.status,
    aiAssisted: row.ai_assisted === true,
    citedCommentIds: (row.source_item_ids ?? []).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    ),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }));

  return {
    campaigns,
    comments,
    responses,
    results: { campaigns: campaignsResult, comments: commentsResult, responses: responsesResult },
  };
}

// ── The record ───────────────────────────────────────────────────────────────

export interface RtpCommentResponseReadState {
  campaigns: boolean;
  comments: boolean;
  responses: boolean;
}

/**
 * Which of the three reads FAILED, derived from the loader's raw results.
 *
 * Exported so the mapping is written once. Every caller needs it and a caller
 * that hand-rolls it can invert a boolean and turn a failed read back into a
 * confident zero.
 */
export function rtpCommentResponseUnreadableFrom(
  results: RtpCommentResponseLoadResult["results"]
): RtpCommentResponseReadState {
  return {
    campaigns: Boolean(results.campaigns.error),
    comments: Boolean(results.comments.error),
    responses: Boolean(results.responses.error),
  };
}

export interface RtpCommentResponseRecordInput {
  campaigns: readonly RtpCommentResponseCampaignInput[];
  comments: readonly RtpPublicCommentInput[];
  responses: readonly RtpCommentResponseEntryInput[];
  /**
   * REQUIRED, and deliberately not defaulted. A caller that forgets to say a
   * read failed would publish its zeros as findings, so the type makes
   * forgetting a build error instead of a false statement.
   */
  unreadable: RtpCommentResponseReadState;
}

export interface RtpCommentResponseCampaignView {
  id: string;
  title: string;
  summary: string | null;
  status: string | null;
  engagementType: string | null;
  chapterId: string | null;
  updatedAt: string | null;
}

export interface RtpPublicCommentView {
  id: string;
  campaignId: string;
  campaignTitle: string | null;
  /** Set when this comment is a reply to another (20260720000097). */
  parentCommentId: string | null;
  categoryId: string | null;
  title: string | null;
  body: string;
  /** What the commenter called themselves; null when they gave no name. */
  submittedBy: string | null;
  sourceType: string | null;
  createdAt: string | null;
}

export interface RtpCommentResponseView {
  id: string;
  campaignId: string;
  themeTitle: string;
  youSaid: string;
  weDid: string;
  /** Honest provenance: was the "you said" side AI-seeded. */
  aiAssisted: boolean;
  publishedAt: string | null;
  /** How many comment ids this response cites. */
  citedCommentCount: number;
  /** How many of those resolve to a comment in this record. */
  matchedCommentCount: number;
}

export interface RtpCommentResponsePair {
  comment: RtpPublicCommentView;
  /**
   * The PUBLISHED response citing this comment, or null. When more than one
   * published response cites it, this is the first in display order (sort
   * order, then creation) — the same order the operator arranged them in.
   */
  response: RtpCommentResponseView | null;
  /**
   * True when an UNPUBLISHED response cites this comment. Deliberately a
   * boolean and not the draft: see rule 2 in the module header.
   */
  hasDraftResponse: boolean;
}

export type RtpWithheldCommentReason = "staff_note" | "marked_private" | "not_approved";

export interface RtpWithheldComment {
  id: string;
  campaignId: string;
  reason: RtpWithheldCommentReason;
  /** A sentence a planner reads. Carries no comment text, by design. */
  detail: string;
}

export interface RtpCommentResponseSummary {
  campaigns: RtpCommentResponseCampaignView[];
  campaignsReadable: boolean;
  commentsReadable: boolean;
  responsesReadable: boolean;
  /** One entry per approved public comment, chronological. */
  entries: RtpCommentResponsePair[];
  /**
   * The approved comments with no published response — an OUTSTANDING work
   * list, not a failure and not a bar to adoption.
   */
  outstanding: RtpCommentResponsePair[];
  /** null when it could not be determined, which is not the same as `false`. */
  hasUnansweredComments: boolean | null;
  approvedCommentCount: number | null;
  answeredCount: number | null;
  unansweredCount: number | null;
  /** Approved comments cited only by an unpublished response. */
  draftedResponseCount: number | null;
  publishedResponseCount: number | null;
  /**
   * Published responses that answer no comment in this record — either they
   * cite nothing, or they cite comments that are not approved. They are real
   * work the agency did, so they are surfaced rather than dropped.
   */
  unlinkedPublishedResponses: RtpCommentResponseView[];
  /**
   * Items kept out of the published record, with the reason. NOT all of these
   * are approved comment: `not_approved` covers a caller-assembled item that
   * never cleared moderation, and describing that as "held out as a staff note"
   * would be a false statement about the agency's moderation. Read `reason`
   * before counting.
   */
  withheld: RtpWithheldComment[];
  withheldCount: number | null;
}

function isPublishedResponse(response: RtpCommentResponseEntryInput): boolean {
  return response.status === RTP_PUBLISHED_RESPONSE_STATUS;
}

/**
 * Whether the operator marked this item private, asked of the engagement
 * module's own predicate so the two definitions cannot drift apart.
 *
 * `isInternalOrPrivateEngagementNote` answers two questions at once — "is it
 * marked private" and "is it a staff/offline source" — and only the first
 * belongs here, because a comment card filled in at an open house and a letter
 * to the project inbox ARE public comment and belong in the record
 * (`comment-import.ts` says so explicitly). Asking it about the item as though
 * it arrived through the portal isolates the metadata half of its answer: its
 * visibility check runs before its source check. If that order ever changes,
 * the tests over the three metadata markings fail rather than the record
 * quietly publishing a private note.
 */
function isMarkedPrivate(comment: RtpPublicCommentInput): boolean {
  return isInternalOrPrivateEngagementNote({
    id: comment.id,
    source_type: "public",
    metadata_json: comment.metadata,
  });
}

/**
 * `internal` means staff-authored (`comment-import.ts`: "a resident's comment
 * from an open house filed as staff-authored is a misattribution"). It is also
 * the column default, so an item with no source recorded is treated the same
 * way — the safe direction, since the harm here is publishing a staff note as
 * though a resident said it.
 */
function isStaffAuthored(comment: RtpPublicCommentInput): boolean {
  const source = (comment.sourceType ?? "").trim();
  return source === "" || source === "internal";
}

function compareByCreatedAt(a: { createdAt: string | null; id: string }, b: { createdAt: string | null; id: string }): number {
  const left = a.createdAt ?? "";
  const right = b.createdAt ?? "";
  if (left !== right) {
    // A comment with no timestamp sorts last rather than to the beginning of
    // the record, where it would look like the first thing anyone said.
    if (!left) return 1;
    if (!right) return -1;
    return left < right ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareResponses(a: RtpCommentResponseEntryInput, b: RtpCommentResponseEntryInput): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return compareByCreatedAt(a, b);
}

/**
 * Assemble the record. Pure — no clock, no client, no I/O.
 */
export function buildRtpCommentResponseRecord(
  input: RtpCommentResponseRecordInput
): RtpCommentResponseSummary {
  const campaignsReadable = !input.unreadable.campaigns;
  const commentsReadable = !input.unreadable.comments;
  const responsesReadable = !input.unreadable.responses;

  const campaigns: RtpCommentResponseCampaignView[] = campaignsReadable
    ? input.campaigns.map((campaign) => ({
        id: campaign.id,
        title: campaign.title?.trim() || "Untitled consultation",
        summary: campaign.summary,
        status: campaign.status,
        engagementType: campaign.engagementType,
        chapterId: campaign.chapterId,
        updatedAt: campaign.updatedAt,
      }))
    : [];
  const campaignTitleById = new Map(campaigns.map((campaign) => [campaign.id, campaign.title]));

  if (!commentsReadable) {
    // Nothing below can be counted without the comments, so nothing below is
    // counted. Zero would be a claim; null is the absence of one.
    return {
      campaigns,
      campaignsReadable,
      commentsReadable,
      responsesReadable,
      entries: [],
      outstanding: [],
      hasUnansweredComments: null,
      approvedCommentCount: null,
      answeredCount: null,
      unansweredCount: null,
      draftedResponseCount: null,
      publishedResponseCount: responsesReadable
        ? input.responses.filter(isPublishedResponse).length
        : null,
      unlinkedPublishedResponses: [],
      withheld: [],
      withheldCount: null,
    };
  }

  const withheld: RtpWithheldComment[] = [];
  const included: RtpPublicCommentInput[] = [];

  for (const comment of input.comments) {
    // Rule 1, re-checked. The loader filters on this too; a caller that built
    // its own input list does not go through the loader.
    if (comment.status !== RTP_PUBLISHABLE_COMMENT_STATUS) {
      withheld.push({
        id: comment.id,
        campaignId: comment.campaignId,
        reason: "not_approved",
        detail: "Not approved in moderation, so it is not part of the published record.",
      });
      continue;
    }
    if (isMarkedPrivate(comment)) {
      withheld.push({
        id: comment.id,
        campaignId: comment.campaignId,
        reason: "marked_private",
        detail: "Marked private by staff, so it is held out of the published record.",
      });
      continue;
    }
    if (isStaffAuthored(comment)) {
      withheld.push({
        id: comment.id,
        campaignId: comment.campaignId,
        reason: "staff_note",
        detail:
          "Recorded as a staff-authored note rather than public comment, so it is held out of the published record.",
      });
      continue;
    }
    included.push(comment);
  }

  const includedIds = new Set(included.map((comment) => comment.id));

  const orderedResponses = [...input.responses].sort(compareResponses);
  const publishedByCommentId = new Map<string, RtpCommentResponseEntryInput>();
  const draftedCommentIds = new Set<string>();
  const unlinkedPublished: RtpCommentResponseEntryInput[] = [];

  if (responsesReadable) {
    for (const response of orderedResponses) {
      const matched = response.citedCommentIds.filter((id) => includedIds.has(id));

      if (isPublishedResponse(response)) {
        if (matched.length === 0) {
          unlinkedPublished.push(response);
          continue;
        }
        for (const commentId of matched) {
          // First in display order wins; a later response does not overwrite it.
          if (!publishedByCommentId.has(commentId)) publishedByCommentId.set(commentId, response);
        }
        continue;
      }

      for (const commentId of matched) draftedCommentIds.add(commentId);
    }
  }

  const toResponseView = (response: RtpCommentResponseEntryInput): RtpCommentResponseView => ({
    id: response.id,
    campaignId: response.campaignId,
    themeTitle: response.themeTitle?.trim() || "Untitled theme",
    youSaid: response.youSaid ?? "",
    weDid: response.weDid ?? "",
    aiAssisted: response.aiAssisted,
    publishedAt: response.publishedAt,
    citedCommentCount: response.citedCommentIds.length,
    matchedCommentCount: response.citedCommentIds.filter((id) => includedIds.has(id)).length,
  });

  const entries: RtpCommentResponsePair[] = [...included]
    .sort(compareByCreatedAt)
    .map((comment) => {
      const published = publishedByCommentId.get(comment.id) ?? null;
      return {
        comment: {
          id: comment.id,
          campaignId: comment.campaignId,
          campaignTitle: campaignTitleById.get(comment.campaignId) ?? null,
          parentCommentId: comment.parentCommentId,
          categoryId: comment.categoryId,
          title: comment.title,
          body: comment.body ?? "",
          submittedBy: comment.submittedBy,
          sourceType: comment.sourceType,
          createdAt: comment.createdAt,
        },
        response: published ? toResponseView(published) : null,
        hasDraftResponse: draftedCommentIds.has(comment.id),
      };
    });

  // With the responses unreadable, "answered" is unknown for every comment, so
  // no comment may be listed as outstanding and no count may be given.
  const outstanding = responsesReadable ? entries.filter((entry) => entry.response === null) : [];

  return {
    campaigns,
    campaignsReadable,
    commentsReadable,
    responsesReadable,
    entries,
    outstanding,
    hasUnansweredComments: responsesReadable ? outstanding.length > 0 : null,
    approvedCommentCount: entries.length,
    answeredCount: responsesReadable ? entries.length - outstanding.length : null,
    unansweredCount: responsesReadable ? outstanding.length : null,
    draftedResponseCount: responsesReadable
      ? outstanding.filter((entry) => entry.hasDraftResponse).length
      : null,
    publishedResponseCount: responsesReadable
      ? orderedResponses.filter(isPublishedResponse).length
      : null,
    unlinkedPublishedResponses: unlinkedPublished.map(toResponseView),
    withheld,
    withheldCount: withheld.length,
  };
}

// ── Saying it in one sentence ────────────────────────────────────────────────

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * The tone a badge should take. An outstanding comment is a `warning` — the
 * repo's word for "attend to this" — and never `danger`, because it is not a
 * defect and does not stop an adoption.
 */
export function rtpCommentResponseTone(
  summary: RtpCommentResponseSummary
): "success" | "warning" | "neutral" {
  if (!summary.campaignsReadable || !summary.commentsReadable || !summary.responsesReadable) {
    return "neutral";
  }
  if (summary.hasUnansweredComments) return "warning";
  // A plan with no consultation attached, or with no approved comment, is NOT a
  // success. "Every comment has a response" is trivially true of zero comments,
  // and a green badge over it tells a board the consultation record is complete
  // when nothing has been gathered — the badge is what gets read, not the
  // sentence under it. Neutral is the honest colour for "nothing to report yet".
  if (summary.campaigns.length === 0 || summary.approvedCommentCount === 0) return "neutral";
  return "success";
}

/**
 * One sentence a board can read, which never claims a number it did not
 * compute. Every branch below is guarded by the readability flag for the
 * numbers it uses; a count that is null is never printed as zero.
 */
export function describeRtpCommentResponse(summary: RtpCommentResponseSummary): string {
  if (!summary.campaignsReadable) {
    return (
      "The public engagement attached to this plan could not be read, so this record states nothing " +
      "about what the public said or how the agency answered. This is a failed read, not an empty record."
    );
  }

  // The failed COMMENT read is reported before the empty campaign list, and the
  // order matters. "No engagement is attached, so there is nothing to publish"
  // is a statement about the comment table, and it may not be made while that
  // table is unread — an empty campaign list can also come back from a scoping
  // change rather than from an agency that consulted nobody.
  if (!summary.commentsReadable || summary.approvedCommentCount === null) {
    return (
      "The public comments on this plan could not be read, so no count of comments or responses is " +
      "stated here. This is a failed read, not an empty record."
    );
  }

  if (summary.campaigns.length === 0) {
    return (
      "No public engagement is attached to this plan in OpenPlan, so there is no comment-response " +
      "record to publish yet. Comment gathered elsewhere would not appear here."
    );
  }

  const total = summary.approvedCommentCount;
  // ONLY the staff/private holds are described this way. `not_approved` items
  // are withheld too, but they are not approved comment and saying "N approved
  // items are held out as staff or private notes" over them would misstate the
  // agency's moderation in the document a resident inspects. They stay in
  // `withheld` for the operator view and out of this sentence: whether an
  // unmoderated comment exists is not a fact the published record asserts.
  const heldOutCount = summary.withheld.filter((item) => item.reason !== "not_approved").length;
  const withheldNote =
    heldOutCount > 0
      ? ` ${heldOutCount} approved ${plural(heldOutCount, "item is", "items are")} held out of the published record as staff or private notes.`
      : "";

  if (total === 0) {
    return (
      "No public comment on this plan has been approved for publication yet, so the record is empty " +
      `rather than unanswered.${withheldNote}`
    );
  }

  const scope = `${total} approved public ${plural(total, "comment is", "comments are")} recorded on this plan`;

  if (!summary.responsesReadable || summary.unansweredCount === null || summary.answeredCount === null) {
    return (
      `${scope}. The agency's responses could not be read, so how many have been answered is not ` +
      `stated here.${withheldNote}`
    );
  }

  const unlinkedNote =
    summary.unlinkedPublishedResponses.length > 0
      ? ` ${summary.unlinkedPublishedResponses.length} published ${plural(summary.unlinkedPublishedResponses.length, "response cites", "responses cite")} no comment in this record; linking the comments each one answers would show them here.`
      : "";

  if (summary.unansweredCount === 0) {
    return `${scope}, and every one has a published response.${unlinkedNote}${withheldNote}`;
  }

  const draftNote =
    summary.draftedResponseCount && summary.draftedResponseCount > 0
      ? ` ${summary.draftedResponseCount} of those already ${plural(summary.draftedResponseCount, "has", "have")} a drafted response awaiting publication.`
      : "";

  return (
    `${scope}; ${summary.answeredCount} ${plural(summary.answeredCount, "has", "have")} a published ` +
    `response and ${summary.unansweredCount} ${plural(summary.unansweredCount, "is", "are")} still outstanding. ` +
    `Outstanding comments are work to finish, not a bar to adopting the plan.${draftNote}${unlinkedNote}${withheldNote}`
  );
}
