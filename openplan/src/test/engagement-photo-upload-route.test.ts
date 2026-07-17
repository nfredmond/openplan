import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqStatusMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignEqTokenMock = vi.fn(() => ({ eq: campaignEqStatusMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqTokenMock }));

const storageUploadMock = vi.fn();
const storageFromMock = vi.fn(() => ({ upload: storageUploadMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

import { POST } from "@/app/api/engage/[shareToken]/photo-upload/route";
import {
  PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW,
  resetEngagementPhotoUploadRateLimiter,
} from "@/lib/engagement/photo";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const SHARE_TOKEN = "test-share-token-12345";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

function photoRequest(body: Uint8Array, contentType: string, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/engage/${SHARE_TOKEN}/photo-upload`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "user-agent": "Vitest Photo Upload",
      "x-forwarded-for": "203.0.113.10",
      ...(headers ?? {}),
    },
    // TS 5.7 Uint8Array<ArrayBufferLike> is not assignable to BodyInit even
    // though the runtime accepts it; the cast is test-only plumbing.
    body: body as unknown as BodyInit,
  });
}

function routeContext() {
  return { params: Promise.resolve({ shareToken: SHARE_TOKEN }) };
}

describe("POST /api/engage/[shareToken]/photo-upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEngagementPhotoUploadRateLimiter();

    createServiceRoleClientMock.mockReturnValue({
      from: fromMock,
      storage: { from: storageFromMock },
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: CAMPAIGN_ID,
        status: "active",
        allow_public_submissions: true,
        submissions_closed_at: null,
      },
      error: null,
    });

    storageUploadMock.mockResolvedValue({ error: null });
  });

  it("stores a valid JPEG under the campaign prefix and returns the path", async () => {
    const response = await POST(photoRequest(JPEG_BYTES, "image/jpeg"), routeContext());

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.photoPath).toMatch(
      new RegExp(`^${CAMPAIGN_ID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`)
    );

    expect(storageFromMock).toHaveBeenCalledWith("engagement-photos");
    expect(storageUploadMock).toHaveBeenCalledWith(
      json.photoPath,
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "image/jpeg", upsert: false })
    );
  });

  it("accepts PNG and WebP with matching magic bytes", async () => {
    const pngResponse = await POST(photoRequest(PNG_BYTES, "image/png"), routeContext());
    expect(pngResponse.status).toBe(201);
    expect((await pngResponse.json()).photoPath).toMatch(/\.png$/);

    const webpResponse = await POST(photoRequest(WEBP_BYTES, "image/webp"), routeContext());
    expect(webpResponse.status).toBe(201);
    expect((await webpResponse.json()).photoPath).toMatch(/\.webp$/);
  });

  it("rejects unsupported content types before reading storage", async () => {
    const response = await POST(photoRequest(JPEG_BYTES, "image/gif"), routeContext());

    expect(response.status).toBe(415);
    expect(storageUploadMock).not.toHaveBeenCalled();
    expect(campaignSelectMock).not.toHaveBeenCalled();
  });

  it("rejects payloads whose magic bytes do not match the declared type", async () => {
    // PNG bytes declared as JPEG.
    const response = await POST(photoRequest(PNG_BYTES, "image/jpeg"), routeContext());

    expect(response.status).toBe(415);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("rejects non-image payloads masquerading as images", async () => {
    const htmlBytes = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const response = await POST(photoRequest(htmlBytes, "image/jpeg"), routeContext());

    expect(response.status).toBe(415);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("rejects oversized uploads with 413 before any campaign lookup", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set(JPEG_BYTES, 0);

    const response = await POST(photoRequest(oversized, "image/jpeg"), routeContext());

    expect(response.status).toBe(413);
    expect(campaignSelectMock).not.toHaveBeenCalled();
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("rejects empty uploads", async () => {
    const response = await POST(photoRequest(new Uint8Array(0), "image/jpeg"), routeContext());
    expect(response.status).toBe(400);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("rate limits repeated uploads from the same connection", async () => {
    for (let index = 0; index < PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW; index += 1) {
      const response = await POST(photoRequest(JPEG_BYTES, "image/jpeg"), routeContext());
      expect(response.status).toBe(201);
    }

    const blocked = await POST(photoRequest(JPEG_BYTES, "image/jpeg"), routeContext());
    expect(blocked.status).toBe(429);
    expect(storageUploadMock).toHaveBeenCalledTimes(PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW);
  });

  it("rejects uploads when the campaign is not accepting submissions", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: CAMPAIGN_ID,
        status: "active",
        allow_public_submissions: false,
        submissions_closed_at: null,
      },
      error: null,
    });

    const response = await POST(photoRequest(JPEG_BYTES, "image/jpeg"), routeContext());

    expect(response.status).toBe(403);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown share token", async () => {
    campaignMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(photoRequest(JPEG_BYTES, "image/jpeg"), routeContext());

    expect(response.status).toBe(404);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });
});
