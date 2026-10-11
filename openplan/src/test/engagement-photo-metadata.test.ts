// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import {
  ENGAGEMENT_PHOTO_MAX_INPUT_PIXELS,
  stripPhotoMetadata,
} from "@/lib/engagement/photo-metadata";
import type { EngagementPhotoContentType } from "@/lib/engagement/photo";

// An ASCII GPS tag gives a byte-level marker inside the GPS IFD, so the tests
// can prove the fixture carried location before asserting the output does not.
const GPS_MARKER = "OPENPLAN-GPS-MARKER";
const DEVICE_MARKER = "OpenPlanTestPhone";
const PHONE_EXIF = {
  IFD0: { Make: DEVICE_MARKER, Model: "Test Model 7" },
  IFD3: {
    GPSLatitudeRef: "N",
    GPSLatitude: "38/1 47/1 0/1",
    GPSLongitudeRef: "W",
    GPSLongitude: "121/1 14/1 0/1",
    GPSMapDatum: GPS_MARKER,
  },
};
const XMP_PACKET =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>';

const FORMATS: Array<[EngagementPhotoContentType, "jpeg" | "png" | "webp"]> = [
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
];

function canvas(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#336699" } });
}

async function phonePhoto(format: "jpeg" | "png" | "webp"): Promise<Uint8Array> {
  const buffer = await canvas(40, 20).withExif(PHONE_EXIF).withXmp(XMP_PACKET).withIccProfile("p3")[format]().toBuffer();
  return new Uint8Array(buffer);
}

function contains(bytes: Uint8Array, marker: string): boolean {
  return Buffer.from(bytes).includes(marker);
}

describe("stripPhotoMetadata", () => {
  for (const [contentType, format] of FORMATS) {
    it(`removes GPS, device, XMP and ICC metadata from ${format} and keeps the format`, async () => {
      const original = await phonePhoto(format);
      const before = await sharp(original).metadata();
      // Negative control: the fixture really carries what we claim to strip.
      expect(before.exif && contains(before.exif, GPS_MARKER)).toBe(true);
      expect(contains(original, DEVICE_MARKER)).toBe(true);
      expect(before.xmp).toBeDefined();
      expect(before.icc).toBeDefined();

      const result = await stripPhotoMetadata(original, contentType);
      if (!result.ok) throw new Error("expected a decodable fixture");

      expect(result.contentType).toBe(contentType);
      const after = await sharp(result.bytes).metadata();
      expect(after.format).toBe(format);
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.iptc).toBeUndefined();
      expect(after.icc).toBeUndefined();
      expect(contains(result.bytes, GPS_MARKER)).toBe(false);
      expect(contains(result.bytes, DEVICE_MARKER)).toBe(false);
      expect([after.width, after.height]).toEqual([40, 20]);
    });
  }

  it("applies EXIF orientation to the pixels so a portrait photo stays upright", async () => {
    // Orientation 6: stored landscape, displayed rotated 90 degrees clockwise.
    const original = new Uint8Array(
      await canvas(40, 20).withExif(PHONE_EXIF).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    );
    expect((await sharp(original).metadata()).orientation).toBe(6);

    const result = await stripPhotoMetadata(original, "image/jpeg");
    if (!result.ok) throw new Error("expected a decodable fixture");

    const after = await sharp(result.bytes).metadata();
    expect(after.orientation).toBeUndefined();
    expect([after.width, after.height]).toEqual([20, 40]);
  });

  it("refuses bytes that pass the magic-byte check but do not decode", async () => {
    const truncatedJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(await stripPhotoMetadata(truncatedJpeg, "image/jpeg")).toEqual({ ok: false });

    const pngHeaderOnly = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    expect(await stripPhotoMetadata(pngHeaderOnly, "image/png")).toEqual({ ok: false });
  });

  it("refuses an image that declares more pixels than the decode cap", async () => {
    // A flat 9000 x 9000 PNG is a few hundred KB but 81 million pixels.
    const side = 9000;
    expect(side * side).toBeGreaterThan(ENGAGEMENT_PHOTO_MAX_INPUT_PIXELS);
    const bomb = new Uint8Array(
      await sharp({ create: { width: side, height: side, channels: 3, background: "#000000" } }).png().toBuffer()
    );
    expect(await stripPhotoMetadata(bomb, "image/png")).toEqual({ ok: false });
  });
});
