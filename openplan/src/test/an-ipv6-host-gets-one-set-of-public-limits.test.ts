import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePublicInputDatabase, type FakePublicInputDatabase } from "@/test/helpers/fake-public-input-tables";

/**
 * ROADMAP M9a: AN IPv6 HOST THAT ROTATES ITS ADDRESS STILL HITS EACH LIMIT.
 *
 * Every public route that limits a connection is run here with a fresh address
 * inside ONE /64 on every request, as a phone with privacy extensions or a
 * script would send. Each must refuse at its own limit, and an address in a
 * different /64 must still get through. Before 2026-11-02 each new address was
 * a new connection and none of these refused.
 *
 * Comments, supports, photos and update sign-ups run against a fake database
 * that evaluates the routes' filters. The two survey routes run with their
 * storage library replaced by a store that counts by the fingerprint the route
 * passes, so the route's own key is what is counted.
 */

let db: FakePublicInputDatabase;
const sendEmail = vi.fn();

type SurveySession = { id: string; campaignId: string; fingerprint: string; created_at: string };
let surveySessions: SurveySession[] = [];
let surveyDrafts: SurveySession[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: () => db.client,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/notifications/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  emailTransportName: () => "resend",
  isEmailTransportConfigured: () => true,
}));

const SURVEY_QUESTION = "77777777-7777-4777-8777-777777777777";
vi.mock("@/lib/engagement/survey-responses", () => ({
  loadSurveyRequestReceipt: async () => ({ data: null, error: null }),
  loadSurveyDefinition: async () => ({
    questions: [
      {
        id: SURVEY_QUESTION,
        question_type: "free_text",
        prompt: "What would help?",
        help_text: null,
        required: true,
        sort_order: 0,
        config_json: {},
        category_id: null,
      },
    ],
    optionsByQuestion: new Map(),
  }),
  loadRecentFingerprintSessions: async (_client: unknown, campaignId: string, fingerprint: string) =>
    surveySessions.filter((row) => row.campaignId === campaignId && row.fingerprint === fingerprint),
  insertRetryableSurveyResponse: async (_client: unknown, input: { campaignId: string; respondentFingerprint: string }) => {
    const id = `session-${surveySessions.length}`;
    surveySessions.push({ id, campaignId: input.campaignId, fingerprint: input.respondentFingerprint, created_at: new Date().toISOString() });
    return { ok: true, sessionId: id };
  },
  purgeExpiredSurveyDrafts: async () => ({ ok: true }),
  countLiveSurveyDrafts: async (_client: unknown, campaignId: string, fingerprint: string) => ({
    ok: true,
    count: surveyDrafts.filter((row) => row.campaignId === campaignId && row.fingerprint === fingerprint).length,
  }),
  insertSurveyDraft: async (_client: unknown, input: { campaignId: string; respondentFingerprint: string; expiresAt: string }) => {
    const now = new Date().toISOString();
    surveyDrafts.push({ id: `draft-${surveyDrafts.length}`, campaignId: input.campaignId, fingerprint: input.respondentFingerprint, created_at: now });
    return { ok: true, draft: { updated_at: now, expires_at: input.expiresAt } };
  },
  updateSurveyDraft: async () => ({ ok: true, draft: null }),
  deleteSurveyDraftByTokenHash: async () => ({ ok: true }),
}));

import { POST as submitComment } from "@/app/api/engage/[shareToken]/submit/route";
import { POST as supportComment } from "@/app/api/engage/[shareToken]/items/[itemId]/vote/route";
import { POST as uploadPhoto } from "@/app/api/engage/[shareToken]/photo-upload/route";
import { POST as subscribe } from "@/app/api/engage/[shareToken]/subscribe/route";
import { POST as submitSurvey } from "@/app/api/engage/[shareToken]/survey/submit/route";
import { POST as saveSurveyDraft } from "@/app/api/engage/[shareToken]/survey/draft/route";
import { PUBLIC_SUBMISSION_MAX_PER_WINDOW } from "@/lib/engagement/public-submit";
import { PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM } from "@/lib/engagement/votes";
import { PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW } from "@/lib/engagement/photo";
import { SURVEY_DRAFT_MAX_LIVE_PER_FINGERPRINT } from "@/lib/engagement/survey-drafts";
import { PARTICIPANT_DEVICE_HEADER } from "@/lib/engagement/participant-device";

const CAMPAIGN = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "99999999-9999-4999-8999-999999999999";
const ITEM = "22222222-2222-4222-8222-222222222222";
const TOKEN = "share-token-ipv6";

/** A different address inside 2001:db8:a:b::/64 for every call. */
let rotation = 0;
function sameSlash64(): string {
  rotation += 1;
  return `2001:db8:a:b:${((rotation * 7919) & 0xffff).toString(16)}:${rotation.toString(16)}:0:${(rotation % 9) + 1}`;
}
const OTHER_SLASH64 = "2001:db8:a:c::1";

function device(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function json(path: string, ip: string, body: unknown) {
  return new NextRequest(`http://localhost/api/engage/${TOKEN}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
const tokenContext = { params: Promise.resolve({ shareToken: TOKEN }) };

/** Send `count` requests from rotating addresses in one /64; return their statuses. */
async function fromOneSlash64(count: number, send: (ip: string, index: number) => Promise<Response>) {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) statuses.push((await send(sameSlash64(), index)).status);
  return statuses;
}

let JPEG: Uint8Array;
beforeAll(async () => {
  JPEG = new Uint8Array(await sharp({ create: { width: 16, height: 12, channels: 3, background: "#336699" } }).jpeg().toBuffer());
});

beforeEach(() => {
  rotation = 0;
  surveySessions = [];
  surveyDrafts = [];
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ delivered: true, transport: "resend" });
  db = createFakePublicInputDatabase(
    {
      engagement_campaigns: [
        {
          id: CAMPAIGN,
          workspace_id: WORKSPACE,
          title: "Main Street",
          status: "active",
          share_token: TOKEN,
          allow_public_submissions: true,
          submissions_closed_at: null,
          participation_starts_at: null,
          participation_ends_at: null,
          configuration_version_id: null,
          demographics_enabled: false,
          survey_one_response_per_fingerprint: false,
        },
      ],
      engagement_public_items: [{ id: ITEM, campaign_id: CAMPAIGN, status: "approved", parent_item_id: null, votes_count: 0 }],
    },
    { unique: { engagement_item_votes: [["item_id", "voter_fingerprint"]], engagement_subscriptions: [["campaign_id", "email"]] } }
  );
});

describe("one IPv6 /64 with a new address on every request", () => {
  it("reaches the public comment limit", async () => {
    const send = (ip: string, index: number) => submitComment(json("submit", ip, { body: `Comment number ${index}` }), tokenContext);
    const statuses = await fromOneSlash64(PUBLIC_SUBMISSION_MAX_PER_WINDOW + 1, send);

    expect(statuses.slice(0, PUBLIC_SUBMISSION_MAX_PER_WINDOW)).toEqual(Array(PUBLIC_SUBMISSION_MAX_PER_WINDOW).fill(201));
    expect(statuses.at(-1)).toBe(429);
    expect((await send(OTHER_SLASH64, 999)).status).toBe(201);
  });

  it("reaches the limit on supports for one comment", async () => {
    const send = (ip: string, index: number) =>
      supportComment(
        new NextRequest(`http://localhost/api/engage/${TOKEN}/items/${ITEM}/vote`, {
          method: "POST",
          headers: { "x-forwarded-for": ip, [PARTICIPANT_DEVICE_HEADER]: device(index) },
        }),
        { params: Promise.resolve({ shareToken: TOKEN, itemId: ITEM }) }
      );
    const statuses = await fromOneSlash64(PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM + 1, send);

    expect(statuses.slice(0, PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM)).toEqual(Array(PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM).fill(201));
    expect(statuses.at(-1)).toBe(429);
    expect((await send(OTHER_SLASH64, 999)).status).toBe(201);
  });

  it("reaches the photo limit", async () => {
    const send = (ip: string) =>
      uploadPhoto(
        new NextRequest(`http://localhost/api/engage/${TOKEN}/photo-upload`, {
          method: "POST",
          headers: { "content-type": "image/jpeg", "x-forwarded-for": ip },
          body: JPEG as unknown as BodyInit,
        }),
        tokenContext
      );
    const statuses = await fromOneSlash64(PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW + 1, send);

    expect(statuses.slice(0, PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW)).toEqual(Array(PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW).fill(201));
    expect(statuses.at(-1)).toBe(429);
    expect((await send(OTHER_SLASH64)).status).toBe(201);
  });

  it("reaches the update sign-up limit", async () => {
    const send = (ip: string, index: number) => subscribe(json("subscribe", ip, { email: `person${index}@example.org` }), tokenContext);
    const statuses = await fromOneSlash64(PUBLIC_SUBMISSION_MAX_PER_WINDOW + 1, send);

    expect(statuses.slice(0, PUBLIC_SUBMISSION_MAX_PER_WINDOW)).toEqual(Array(PUBLIC_SUBMISSION_MAX_PER_WINDOW).fill(201));
    expect(statuses.at(-1)).toBe(429);
    expect((await send(OTHER_SLASH64, 999)).status).toBe(201);
  });

  it("reaches the survey response limit", async () => {
    const send = (ip: string, index: number) =>
      submitSurvey(json("survey/submit", ip, { answers: [{ questionId: SURVEY_QUESTION, answer: { text: `Answer ${index}` } }] }), tokenContext);
    const statuses = await fromOneSlash64(PUBLIC_SUBMISSION_MAX_PER_WINDOW + 1, send);

    expect(statuses.slice(0, PUBLIC_SUBMISSION_MAX_PER_WINDOW)).toEqual(Array(PUBLIC_SUBMISSION_MAX_PER_WINDOW).fill(201));
    expect(statuses.at(-1)).toBe(429);
    expect((await send(OTHER_SLASH64, 999)).status).toBe(201);
  });

  it("reaches the saved-draft limit", async () => {
    const send = (ip: string, index: number) =>
      saveSurveyDraft(json("survey/draft", ip, { answers: [{ questionId: SURVEY_QUESTION, answer: { text: `Draft ${index}` } }] }), tokenContext);
    const statuses = await fromOneSlash64(SURVEY_DRAFT_MAX_LIVE_PER_FINGERPRINT + 1, send);

    expect(statuses.slice(0, SURVEY_DRAFT_MAX_LIVE_PER_FINGERPRINT)).toEqual(Array(SURVEY_DRAFT_MAX_LIVE_PER_FINGERPRINT).fill(201));
    expect(statuses.at(-1)).toBe(429);
    expect((await send(OTHER_SLASH64, 999)).status).toBe(201);
  });
});
