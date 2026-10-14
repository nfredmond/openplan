import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePublicInputDatabase, type FakePublicInputDatabase } from "@/test/helpers/fake-public-input-tables";

/**
 * KI-2026-10-12-011: SUPPORT FOR ONE COMMENT FROM ONE CONNECTION IS CAPPED.
 *
 * The device token is the browser's word. A script sent a fresh one with every
 * request and, under the room limit alone, added about 120 supports to one
 * comment every 10 minutes from one connection. These tests run the vote route
 * against a fake database that evaluates the route's filters, so a cap counted
 * on the wrong column or the wrong window fails here.
 */

let db: FakePublicInputDatabase;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: () => db.client,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { DELETE, POST } from "@/app/api/engage/[shareToken]/items/[itemId]/vote/route";
import { PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM } from "@/lib/engagement/votes";
import { buildPublicParticipantDeviceFingerprint, buildPublicSubmissionClientFingerprint } from "@/lib/engagement/public-submit";
import { PARTICIPANT_DEVICE_HEADER } from "@/lib/engagement/participant-device";

const CAMPAIGN_A = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_B = "33333333-3333-4333-8333-333333333333";
const ITEM = "22222222-2222-4222-8222-222222222222";
const OTHER_ITEM = "44444444-4444-4444-8444-444444444444";
const ITEM_IN_B = "55555555-5555-4555-8555-555555555555";
const ROOM_IP = "203.0.113.10";

function device(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function vote(itemId: string, deviceId: string | null, ip = ROOM_IP, token = "share-token-a", method: "POST" | "DELETE" = "POST") {
  const request = new NextRequest(`http://localhost/api/engage/${token}/items/${itemId}/vote`, {
    method,
    headers: { "x-forwarded-for": ip, ...(deviceId ? { [PARTICIPANT_DEVICE_HEADER]: deviceId } : {}) },
  });
  const context = { params: Promise.resolve({ shareToken: token, itemId }) };
  return method === "POST" ? POST(request, context) : DELETE(request, context);
}

function votesOn(itemId: string) {
  return db.table("engagement_item_votes").filter((row) => row.item_id === itemId);
}

beforeEach(() => {
  db = createFakePublicInputDatabase(
    {
      engagement_campaigns: [
        { id: CAMPAIGN_A, status: "active", share_token: "share-token-a" },
        { id: CAMPAIGN_B, status: "active", share_token: "share-token-b" },
      ],
      engagement_public_items: [ITEM, OTHER_ITEM, ITEM_IN_B].map((id) => ({
        id,
        campaign_id: id === ITEM_IN_B ? CAMPAIGN_B : CAMPAIGN_A,
        status: "approved",
        parent_item_id: null,
        votes_count: 0,
      })),
    },
    { unique: { engagement_item_votes: [["item_id", "voter_fingerprint"]] } }
  );
});

describe("support for one comment from one connection", () => {
  it("is refused past the cap, however many device tokens the connection sends", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM + 10; index += 1) {
      statuses.push((await vote(ITEM, device(index))).status);
    }

    expect(statuses.slice(0, PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM)).toEqual(
      Array(PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM).fill(201)
    );
    expect(statuses.slice(PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM)).toEqual(Array(10).fill(429));
    expect(votesOn(ITEM)).toHaveLength(PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM);
  });

  it("is not passed by a burst of parallel requests", async () => {
    const burst = PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM + 30;
    const responses = await Promise.all(Array.from({ length: burst }, (_, index) => vote(ITEM, device(index))));
    const accepted = responses.filter((response) => response.status === 201).length;

    expect(votesOn(ITEM).length).toBeLessThanOrEqual(PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM);
    // Every vote the route reported as recorded is still there.
    expect(votesOn(ITEM)).toHaveLength(accepted);
    expect(responses.every((response) => [201, 429].includes(response.status))).toBe(true);
  });

  it("lets a whole meeting room support a comment, up to the cap, without touching other comments or connections", async () => {
    for (let index = 0; index < PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM; index += 1) {
      expect((await vote(ITEM, device(index))).status).toBe(201);
    }
    expect((await vote(OTHER_ITEM, device(0))).status).toBe(201);
    expect((await vote(ITEM, device(999), "198.51.100.7")).status).toBe(201);
  });

  it("counts only the last day", async () => {
    const connection = buildPublicSubmissionClientFingerprint(
      new NextRequest("http://localhost/", { headers: { "x-forwarded-for": ROOM_IP } })
    );
    const dayAndAnHourAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.table("engagement_item_votes").push(
      ...Array.from({ length: PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM }, (_, index) => ({
        id: `old-${index}`,
        item_id: ITEM,
        campaign_id: CAMPAIGN_A,
        voter_fingerprint: `${connection}:old${index}`,
        created_at: dayAndAnHourAgo,
      }))
    );

    expect((await vote(ITEM, device(1))).status).toBe(201);
  });

  it("asks for exactly this comment, this connection and the last day", async () => {
    await vote(ITEM, device(1));
    const connection = buildPublicSubmissionClientFingerprint(
      new NextRequest("http://localhost/", { headers: { "x-forwarded-for": ROOM_IP } })
    );
    const perItem = db
      .queriesFor("engagement_item_votes")
      .filter((query) => query.ops.some((op) => op.verb === "eq" && op.args[0] === "item_id"));

    // Once before the insert and once after it.
    expect(perItem).toHaveLength(2);
    for (const query of perItem) {
      expect(query.projection).toBe("id");
      expect(query.countMode).toBe("exact");
      expect(query.ops).toContainEqual({ verb: "eq", args: ["item_id", ITEM] });
      expect(query.ops).toContainEqual({
        verb: "or",
        args: [`voter_fingerprint.eq.${connection},voter_fingerprint.like.${connection}:*`],
      });
      const since = query.ops.find((op) => op.verb === "gte" && op.args[0] === "created_at")?.args[1] as string;
      expect(Date.now() - Date.parse(since)).toBeGreaterThan(23.9 * 60 * 60 * 1000);
      expect(Date.now() - Date.parse(since)).toBeLessThan(24.1 * 60 * 60 * 1000);
    }
  });
});

describe("one device", () => {
  it("still supports a comment once, and can take it back", async () => {
    expect((await vote(ITEM, device(7))).status).toBe(201);
    const again = await vote(ITEM, device(7));
    expect(again.status).toBe(200);
    expect((await again.json()).alreadyVoted).toBe(true);
    expect(votesOn(ITEM)).toHaveLength(1);

    expect((await vote(ITEM, device(7), ROOM_IP, "share-token-a", "DELETE")).status).toBe(200);
    expect(votesOn(ITEM)).toHaveLength(0);
  });
});

describe("the stored device hash", () => {
  it("differs between campaigns for the same browser", async () => {
    await vote(ITEM, device(7), ROOM_IP, "share-token-a");
    await vote(ITEM_IN_B, device(7), ROOM_IP, "share-token-b");
    const [inA] = votesOn(ITEM);
    const [inB] = votesOn(ITEM_IN_B);
    const deviceHash = (row: { voter_fingerprint?: unknown }) => String(row.voter_fingerprint).split(":")[1];

    expect(deviceHash(inA)).toMatch(/^[0-9a-f]{24}$/);
    expect(deviceHash(inB)).toMatch(/^[0-9a-f]{24}$/);
    expect(deviceHash(inA)).not.toBe(deviceHash(inB));

    const request = new NextRequest("http://localhost/", { headers: { [PARTICIPANT_DEVICE_HEADER]: device(7) } });
    expect(buildPublicParticipantDeviceFingerprint(request, CAMPAIGN_A)).toBe(deviceHash(inA));
    expect(buildPublicParticipantDeviceFingerprint(request, CAMPAIGN_B)).toBe(deviceHash(inB));
  });
});
