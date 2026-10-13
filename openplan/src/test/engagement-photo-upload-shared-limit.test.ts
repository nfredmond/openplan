import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePublicInputDatabase, type FakePublicInputDatabase } from "@/test/helpers/fake-public-input-tables";

/**
 * KI-2026-10-12-012: PHOTO LIMITS ARE COUNTED WHERE EVERY SERVER CAN SEE THEM.
 *
 * The per-connection limit was a Map inside each server instance; a platform
 * that runs many instances gave each one its own count. Here two separately
 * loaded copies of the route share one fake database, as two instances share
 * the real one, and the limit has to hold across both.
 */

let db: FakePublicInputDatabase;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: () => db.client,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { ENGAGEMENT_PHOTO_BUCKET, PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW } from "@/lib/engagement/photo";
import {
  PUBLIC_PHOTO_UPLOAD_BUCKET_KEY,
  PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_BYTES_PER_WINDOW,
  PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_PER_WINDOW,
} from "@/lib/engagement/photo-upload-allowance";
import { buildPublicSubmissionClientFingerprint } from "@/lib/engagement/public-submit";

type RouteModule = typeof import("@/app/api/engage/[shareToken]/photo-upload/route");

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";
const TOKEN = "share-token-photos";
const IP = "203.0.113.10";
let JPEG: Uint8Array;

/** A fresh copy of the route module: its own module state, as on another server instance. */
async function loadInstance(): Promise<RouteModule> {
  vi.resetModules();
  return import("@/app/api/engage/[shareToken]/photo-upload/route");
}

function upload(instance: RouteModule, ip = IP) {
  const request = new NextRequest(`http://localhost/api/engage/${TOKEN}/photo-upload`, {
    method: "POST",
    headers: { "content-type": "image/jpeg", "x-forwarded-for": ip },
    body: JPEG as unknown as BodyInit,
  });
  return instance.POST(request, { params: Promise.resolve({ shareToken: TOKEN }) });
}

function fingerprintOf(ip: string) {
  return buildPublicSubmissionClientFingerprint(new NextRequest("http://localhost/", { headers: { "x-forwarded-for": ip } }));
}

function seedUploads(count: number, options: { ageHours: number; weight?: number; ip?: string }) {
  const at = new Date(Date.now() - options.ageHours * 60 * 60 * 1000).toISOString();
  db.table("usage_events").push(
    ...Array.from({ length: count }, (_, index) => ({
      id: `seed-${db.table("usage_events").length}-${index}`,
      workspace_id: WORKSPACE_ID,
      bucket_key: PUBLIC_PHOTO_UPLOAD_BUCKET_KEY,
      event_key: `${CAMPAIGN_ID}/seed-${index}.jpg`,
      weight: options.weight ?? 1000,
      occurred_at: at,
      metadata_json: { campaign_id: CAMPAIGN_ID, source_fingerprint: fingerprintOf(options.ip ?? `198.51.100.${index % 250}`) },
    }))
  );
}

const stored = () => db.objects(ENGAGEMENT_PHOTO_BUCKET);
const reservations = () => db.table("usage_events").filter((row) => row.bucket_key === PUBLIC_PHOTO_UPLOAD_BUCKET_KEY);

beforeAll(async () => {
  JPEG = new Uint8Array(
    await sharp({ create: { width: 16, height: 12, channels: 3, background: "#336699" } }).jpeg().toBuffer()
  );
});

beforeEach(() => {
  db = createFakePublicInputDatabase({
    engagement_campaigns: [
      {
        id: CAMPAIGN_ID,
        workspace_id: WORKSPACE_ID,
        share_token: TOKEN,
        status: "active",
        allow_public_submissions: true,
        submissions_closed_at: null,
        participation_starts_at: null,
        participation_ends_at: null,
      },
    ],
  });
});

describe("the per-connection photo limit", () => {
  it("holds across two server instances", async () => {
    const first = await loadInstance();
    const second = await loadInstance();
    expect(first).not.toBe(second);

    const statuses: number[] = [];
    for (let index = 0; index < PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW + 4; index += 1) {
      statuses.push((await upload(index % 2 === 0 ? first : second)).status);
    }

    expect(statuses.filter((status) => status === 201)).toHaveLength(PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW);
    expect(statuses.slice(PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW)).toEqual([429, 429, 429, 429]);
    expect(stored()).toHaveLength(PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW);
    // Another connection is unaffected.
    expect((await upload(second, "198.51.100.200")).status).toBe(201);
  });

  it("is not passed by a burst of parallel uploads", async () => {
    const instance = await loadInstance();
    const responses = await Promise.all(
      Array.from({ length: PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW + 10 }, () => upload(instance))
    );

    expect(stored().length).toBeLessThanOrEqual(PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(stored().length);
    // A refused upload withdraws its row, so the record matches storage.
    expect(reservations()).toHaveLength(stored().length);
  });
});

describe("the per-campaign daily budget", () => {
  it("refuses an upload once the campaign has its day's count, from any connections", async () => {
    seedUploads(PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_PER_WINDOW, { ageHours: 23 });
    const response = await upload(await loadInstance());

    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatch(/cannot take more photos today/);
    expect(stored()).toEqual([]);
  });

  it("refuses an upload once the campaign has its day's bytes", async () => {
    seedUploads(1, { ageHours: 1, weight: PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_BYTES_PER_WINDOW });
    expect((await upload(await loadInstance())).status).toBe(429);
    expect(stored()).toEqual([]);
  });

  it("counts only the last day", async () => {
    seedUploads(PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_PER_WINDOW, { ageHours: 25 });
    seedUploads(1, { ageHours: 25, weight: PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_BYTES_PER_WINDOW });
    expect((await upload(await loadInstance())).status).toBe(201);
  });
});

describe("what each upload records", () => {
  it("writes one row naming the path, bytes, campaign and connection, and reads the counts it compares", async () => {
    const response = await upload(await loadInstance());
    const { photoPath } = (await response.json()) as { photoPath: string };

    expect(reservations()).toHaveLength(1);
    expect(reservations()[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      event_key: photoPath,
      metadata_json: { campaign_id: CAMPAIGN_ID, source_fingerprint: fingerprintOf(IP) },
    });
    expect(reservations()[0].weight).toBeGreaterThan(0);
    expect(stored()).toEqual([photoPath]);

    const reads = db.queriesFor("usage_events").filter((query) => query.action === "select");
    const connectionReads = reads.filter((query) =>
      query.ops.some((op) => op.verb === "eq" && op.args[0] === "metadata_json->>source_fingerprint")
    );
    const campaignReads = reads.filter((query) =>
      query.ops.some((op) => op.verb === "eq" && op.args[0] === "metadata_json->>campaign_id")
    );
    // Once before the row is written, once after.
    expect(connectionReads).toHaveLength(2);
    expect(campaignReads).toHaveLength(2);
    for (const query of connectionReads) {
      expect(query.ops).toContainEqual({ verb: "eq", args: ["bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY] });
      expect(query.ops).toContainEqual({ verb: "eq", args: ["metadata_json->>source_fingerprint", fingerprintOf(IP)] });
      expect(query.countMode).toBe("exact");
    }
    for (const query of campaignReads) {
      expect(query.projection).toBe("weight");
      expect(query.countMode).toBe("exact");
      expect(query.ops).toContainEqual({ verb: "eq", args: ["workspace_id", WORKSPACE_ID] });
      expect(query.ops).toContainEqual({ verb: "eq", args: ["bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY] });
    }
  });

  it("withdraws the row when storage refuses the photo", async () => {
    const instance = await loadInstance();
    const upload_ = db.client.storage.from(ENGAGEMENT_PHOTO_BUCKET);
    vi.spyOn(db.client.storage, "from").mockReturnValue({
      ...upload_,
      upload: async () => ({ data: null, error: { message: "bucket unavailable" } }),
    });

    expect((await upload(instance)).status).toBe(500);
    expect(reservations()).toEqual([]);
  });

  it("refuses the upload when the counts cannot be read", async () => {
    db = createFakePublicInputDatabase(
      { engagement_campaigns: db.table("engagement_campaigns") },
      { failWhen: (query) => (query.table === "usage_events" && query.action === "select" ? { message: "timeout" } : null) }
    );
    expect((await upload(await loadInstance())).status).toBe(500);
    expect(stored()).toEqual([]);
  });
});
