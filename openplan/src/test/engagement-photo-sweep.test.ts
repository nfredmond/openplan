import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePublicInputDatabase, type FakePublicInputDatabase, type Row } from "@/test/helpers/fake-public-input-tables";

/**
 * KI-2026-10-12-012: PHOTOS NOTHING TOOK UP ARE REMOVED, AND NOTHING ELSE IS.
 *
 * A public photo is stored before its comment exists. The sweep removes one
 * that no record took up within a day of upload. The cases below put a photo
 * path in each place a record can keep one, and the sweep must keep every one
 * of those photos.
 */

let db: FakePublicInputDatabase;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: () => db.client,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { ENGAGEMENT_PHOTO_BUCKET } from "@/lib/engagement/photo";
import { PUBLIC_PHOTO_UPLOAD_BUCKET_KEY } from "@/lib/engagement/photo-upload-allowance";
import { PhotoSweepError, sweepUnattachedEngagementPhotos } from "@/lib/engagement/photo-sweep";
import { GET } from "@/app/api/cron/sweep-engagement-photos/route";

const CAMPAIGN = "11111111-1111-4111-8111-111111111111";
const OTHER_CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-12T12:00:00.000Z");

function photo(campaign: string, n: number): string {
  return `${campaign}/00000000-0000-4000-8000-${n.toString().padStart(12, "0")}.jpg`;
}

const ORPHAN = photo(CAMPAIGN, 1);
const ON_A_COMMENT = photo(CAMPAIGN, 2);
const IN_COMMENT_HISTORY_ONLY = photo(CAMPAIGN, 3);
const IN_A_SURVEY_ANSWER = photo(CAMPAIGN, 4);
const IN_SURVEY_REVIEW_HISTORY_ONLY = photo(CAMPAIGN, 5);
const TOO_RECENT = photo(CAMPAIGN, 6);
const ORPHAN_ELSEWHERE = photo(OTHER_CAMPAIGN, 7);
const NAMED_FOR_ANOTHER_CAMPAIGN = photo(OTHER_CAMPAIGN, 8);

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function upload(path: string, ageHours: number, campaign = path.split("/")[0]): Row {
  return {
    id: `upload-${path.slice(-16)}`,
    workspace_id: "99999999-9999-4999-8999-999999999999",
    bucket_key: PUBLIC_PHOTO_UPLOAD_BUCKET_KEY,
    event_key: path,
    weight: 1000,
    occurred_at: hoursAgo(ageHours),
    metadata_json: { campaign_id: campaign, source_fingerprint: "abc" },
  };
}

function seed(extra: Record<string, Row[]> = {}, options: Parameters<typeof createFakePublicInputDatabase>[1] = {}) {
  db = createFakePublicInputDatabase(
    {
      usage_events: [
        upload(ORPHAN, 30),
        upload(ON_A_COMMENT, 30),
        upload(IN_COMMENT_HISTORY_ONLY, 30),
        upload(IN_A_SURVEY_ANSWER, 30),
        upload(IN_SURVEY_REVIEW_HISTORY_ONLY, 30),
        upload(TOO_RECENT, 2),
        upload(ORPHAN_ELSEWHERE, 48),
        // A row whose path is not under the campaign it names is never trusted.
        upload(NAMED_FOR_ANOTHER_CAMPAIGN, 30, CAMPAIGN),
        { id: "ai-usage", workspace_id: "w", bucket_key: "assistant_chat", event_key: ORPHAN, weight: 1, occurred_at: hoursAgo(30), metadata_json: {} },
      ],
      engagement_items: [
        { id: "item-1", campaign_id: CAMPAIGN, photo_path: ON_A_COMMENT },
        { id: "item-2", campaign_id: CAMPAIGN, photo_path: null },
      ],
      engagement_item_history: [
        { id: "history-1", campaign_id: CAMPAIGN, item_id: "item-2", record_json: { id: "item-2", photo_path: IN_COMMENT_HISTORY_ONLY } },
        { id: "history-2", campaign_id: CAMPAIGN, item_id: "item-2", record_json: { id: "item-2", photo_path: null } },
      ],
      engagement_survey_answers: [
        { id: "answer-1", campaign_id: CAMPAIGN, question_type: "file_upload", answer_json: { files: [{ path: IN_A_SURVEY_ANSWER }] } },
        { id: "answer-2", campaign_id: CAMPAIGN, question_type: "file_upload", answer_json: { reviewed_redaction: "[removed]" } },
      ],
      engagement_survey_review_history: [
        {
          id: "review-1",
          campaign_id: CAMPAIGN,
          before_json: [{ id: "answer-2", answer_json: { files: [{ path: IN_SURVEY_REVIEW_HISTORY_ONLY }] } }],
          after_json: [{ id: "answer-2", answer_json: { reviewed_redaction: "[removed]" } }],
        },
      ],
      ...extra,
    },
    { now: () => NOW, ...options }
  );
  for (const path of [
    ORPHAN,
    ON_A_COMMENT,
    IN_COMMENT_HISTORY_ONLY,
    IN_A_SURVEY_ANSWER,
    IN_SURVEY_REVIEW_HISTORY_ONLY,
    TOO_RECENT,
    ORPHAN_ELSEWHERE,
    NAMED_FOR_ANOTHER_CAMPAIGN,
  ]) {
    db.putObject(ENGAGEMENT_PHOTO_BUCKET, path, hoursAgo(30));
  }
}

const queued = () => db.table("usage_events").map((row) => row.id);

describe("sweepUnattachedEngagementPhotos", () => {
  beforeEach(() => seed());

  it("removes only photos older than a day that nothing references", async () => {
    const result = await sweepUnattachedEngagementPhotos(db.client as never, { now: NOW });

    expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).toEqual(
      [
        ON_A_COMMENT,
        IN_COMMENT_HISTORY_ONLY,
        IN_A_SURVEY_ANSWER,
        IN_SURVEY_REVIEW_HISTORY_ONLY,
        TOO_RECENT,
        NAMED_FOR_ANOTHER_CAMPAIGN,
      ].sort()
    );
    expect(result).toEqual({ examined: 7, removed: 2, kept: 4, more: false });
    // Each decided upload leaves the queue; the recent one and other buckets stay.
    expect(queued().sort()).toEqual(["ai-usage", `upload-${TOO_RECENT.slice(-16)}`].sort());
  });

  it("asks for the upload rows of its own bucket older than the cutoff", async () => {
    await sweepUnattachedEngagementPhotos(db.client as never, { now: NOW });
    const [due] = db.queriesFor("usage_events").filter((query) => query.action === "select");
    expect(due.projection).toBe("id, event_key, metadata_json");
    expect(due.ops).toContainEqual({ verb: "eq", args: ["bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY] });
    expect(due.ops).toContainEqual({ verb: "lt", args: ["occurred_at", hoursAgo(24)] });
    const [dequeue] = db.queriesFor("usage_events").filter((query) => query.action === "delete");
    expect(dequeue.ops).toContainEqual({ verb: "eq", args: ["bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY] });
  });

  it("deletes nothing when any reference read fails", async () => {
    for (const table of [
      "engagement_items",
      "engagement_item_history",
      "engagement_survey_answers",
      "engagement_survey_review_history",
    ]) {
      seed({}, { failWhen: (query) => (query.table === table ? { message: "timeout" } : null) });
      await expect(sweepUnattachedEngagementPhotos(db.client as never, { now: NOW })).rejects.toBeInstanceOf(PhotoSweepError);
      expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).toHaveLength(8);
      expect(queued()).toHaveLength(9);
    }
  });

  it("finds a reference past the first page, whatever row cap the server uses", async () => {
    const filler = Array.from({ length: 900 }, (_, index) => ({
      id: `answer-${String(index).padStart(4, "0")}`,
      campaign_id: CAMPAIGN,
      question_type: "free_text",
      answer_json: { text: "filler" },
    }));
    seed(
      {
        engagement_survey_answers: [
          ...filler,
          { id: "answer-zzzz", campaign_id: CAMPAIGN, question_type: "file_upload", answer_json: { files: [{ path: IN_A_SURVEY_ANSWER }] } },
        ],
      },
      { maxRows: 400 }
    );

    await sweepUnattachedEngagementPhotos(db.client as never, { now: NOW });
    expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).toContain(IN_A_SURVEY_ANSWER);
  });

  it("works through the queue in batches and says when it stopped early", async () => {
    const first = await sweepUnattachedEngagementPhotos(db.client as never, { now: NOW, batchSize: 3, maxBatches: 1 });
    expect(first.more).toBe(true);
    expect(first.examined).toBe(3);
    const rest = await sweepUnattachedEngagementPhotos(db.client as never, { now: NOW, batchSize: 3 });
    expect(rest.more).toBe(false);
    expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).not.toContain(ORPHAN);
    expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).not.toContain(ORPHAN_ELSEWHERE);
    expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).toContain(IN_SURVEY_REVIEW_HISTORY_ONLY);
  });
});

describe("GET /api/cron/sweep-engagement-photos", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    seed();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.CRON_SECRET = "cron-secret-value";
  });
  afterEach(() => {
    vi.useRealTimers();
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  const call = (authorization?: string) =>
    GET(
      new NextRequest("http://localhost/api/cron/sweep-engagement-photos", {
        headers: authorization ? { authorization } : {},
      })
    );

  it("refuses a caller without the secret and removes nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer cron-secret-value")).status).toBe(401);
    expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).toHaveLength(8);
  });

  it("runs the sweep for the scheduler", async () => {
    const response = await call("Bearer cron-secret-value");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ examined: 7, removed: 2, kept: 4, more: false });
    expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).not.toContain(ORPHAN);
  });

  it("answers 500 when the sweep stops", async () => {
    seed({}, { failWhen: (query) => (query.table === "engagement_items" ? { message: "timeout" } : null) });
    expect((await call("Bearer cron-secret-value")).status).toBe(500);
    expect(db.objects(ENGAGEMENT_PHOTO_BUCKET)).toHaveLength(8);
  });
});
