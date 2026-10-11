/**
 * Cleaning engagement photos stored before uploads were re-encoded.
 *
 * Real images built with sharp, in an in-memory bucket shaped like Supabase
 * storage (a folder is an entry with no id; listing is paged). The local stack
 * had no stored engagement photos on 2026-10-10, so the script itself was only
 * dry-run there (scanned 0); folder listing semantics were checked read-only
 * against another bucket on the same stack.
 */
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { backfillEngagementPhotoMetadata, type PhotoBucket } from "@/lib/engagement/photo-metadata-backfill";

const GPS_MARKER = "BACKFILL-GPS-MARKER";

async function photo(withLocation: boolean): Promise<Uint8Array> {
  let image = sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  if (withLocation) {
    image = image.withExif({
      IFD0: { Make: "PhoneMaker", Model: "Phone 9" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "38/1 47/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "121/1 14/1 0/1", GPSMapDatum: GPS_MARKER },
    });
  }
  return new Uint8Array(await image.jpeg().toBuffer());
}

/** A bucket held in memory, listing the way Supabase storage does. */
function memoryBucket(objects: Record<string, Uint8Array>, options: { failUpload?: boolean } = {}) {
  const store = new Map(Object.entries(objects));
  const uploads: string[] = [];
  const bucket: PhotoBucket = {
    async list(prefix, { limit, offset }) {
      const base = prefix ? `${prefix}/` : "";
      const names = new Map<string, string | null>();
      for (const path of store.keys()) {
        if (!path.startsWith(base)) continue;
        const rest = path.slice(base.length);
        const [head, ...tail] = rest.split("/");
        names.set(head, tail.length > 0 ? null : `id-${path}`);
      }
      const entries = [...names].sort().map(([name, id]) => ({ name, id }));
      return { data: entries.slice(offset, offset + limit), error: null };
    },
    async download(path) {
      const bytes = store.get(path);
      return bytes ? { data: new Blob([bytes.slice()]), error: null } : { data: null, error: { message: "not found" } };
    },
    async upload(path, body) {
      if (options.failUpload) return { error: { message: "storage refused" } };
      uploads.push(path);
      store.set(path, body);
      return { error: null };
    },
  };
  return { bucket, store, uploads };
}

function carriesMarker(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).includes(GPS_MARKER);
}

describe("cleaning photos stored before uploads were re-encoded", () => {
  it("only reports on a dry run, and changes nothing", async () => {
    const dirty = await photo(true);
    expect(carriesMarker(dirty)).toBe(true);
    const { bucket, uploads } = memoryBucket({ "campaign-a/one.jpg": dirty, "campaign-a/two.jpg": await photo(false) });

    const report = await backfillEngagementPhotoMetadata(bucket, { apply: false });

    expect(report).toMatchObject({ applied: false, scanned: 2, clean: 1, withMetadata: 1, stripped: 0, failures: [] });
    expect(uploads).toEqual([]);
  });

  it("rewrites only the photos carrying metadata, across folders and pages, and verifies each", async () => {
    const objects: Record<string, Uint8Array> = {};
    for (let index = 0; index < 5; index += 1) objects[`campaign-a/${index}.jpg`] = await photo(index % 2 === 0);
    objects["campaign-b/nested/deep.jpg"] = await photo(true);
    const { bucket, store, uploads } = memoryBucket(objects);

    // Two per page, so every folder needs more than one page.
    const report = await backfillEngagementPhotoMetadata(bucket, { apply: true, pageSize: 2 });

    expect(report).toMatchObject({ applied: true, scanned: 6, clean: 2, withMetadata: 4, stripped: 4, failures: [] });
    expect(uploads.sort()).toEqual(["campaign-a/0.jpg", "campaign-a/2.jpg", "campaign-a/4.jpg", "campaign-b/nested/deep.jpg"]);
    for (const bytes of store.values()) {
      expect(carriesMarker(bytes)).toBe(false);
      expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    }
  });

  it("reports what it could not read or write, and leaves those photos as they were", async () => {
    const dirty = await photo(true);
    const { bucket, store } = memoryBucket(
      { "campaign-a/broken.jpg": new Uint8Array([1, 2, 3]), "campaign-a/dirty.jpg": dirty },
      { failUpload: true }
    );

    const report = await backfillEngagementPhotoMetadata(bucket, { apply: true });

    expect(report.stripped).toBe(0);
    const reasons = Object.fromEntries(report.failures.map((failure) => [failure.path, failure.reason]));
    expect(Object.keys(reasons).sort()).toEqual(["campaign-a/broken.jpg", "campaign-a/dirty.jpg"]);
    expect(reasons["campaign-a/broken.jpg"]).toContain("not a JPEG, PNG or WebP");
    // Named for what went wrong, not only caught by the read-back check after it.
    expect(reasons["campaign-a/dirty.jpg"]).toContain("upload failed: storage refused");
    expect(store.get("campaign-a/dirty.jpg")).toBe(dirty);
  });
});
