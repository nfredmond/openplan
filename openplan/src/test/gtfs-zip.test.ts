import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  GtfsArchive,
  GtfsArchiveLimitError,
  archiveMemberBasename,
  openGtfsZip,
} from "@/lib/gtfs/zip";
import { resolveGtfsLimits } from "@/lib/gtfs/limits";

/**
 * The archive reader on its own — real zips built in memory, no feed semantics.
 *
 * Every case here is one a published feed actually produces: a feed zipped
 * inside a wrapping directory, a feed zipped on a Mac, a BOM on the first
 * column, a row with the wrong number of fields. The refusals are asserted with
 * their CODE, because "it failed" and "two files claim to be stops.txt" send a
 * person to completely different places.
 */

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array" });
}

async function collect(archive: GtfsArchive, table: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of archive.streamTable(table)) rows.push(row);
  return rows;
}

describe("finding a table inside an archive", () => {
  it("matches by basename, so a feed zipped inside a directory still reads", async () => {
    // Publishing a feed as google_transit/stops.txt is completely ordinary.
    // Matching the full path would report this working feed as missing every
    // required file.
    const bytes = await zipOf({ "google_transit/stops.txt": "stop_id,stop_name\nA,Alpha\n" });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.archive.has("stops.txt")).toBe(true);
    expect(await collect(opened.archive, "stops.txt")).toEqual([{ stop_id: "A", stop_name: "Alpha" }]);
  });

  it("matches a basename nested arbitrarily deep", async () => {
    const bytes = await zipOf({ "exports/2026-08/gtfs/routes.txt": "route_id\nR1\n" });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.archive.tableNames).toEqual(["routes.txt"]);
  });

  it("yields nothing for a table the archive does not contain", async () => {
    const bytes = await zipOf({ "stops.txt": "stop_id\nA\n" });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await collect(opened.archive, "frequencies.txt")).toEqual([]);
  });
});

describe("an archive that names one file twice is refused, not guessed at", () => {
  it("refuses ambiguous_archive when two entries share a GTFS basename", async () => {
    const bytes = await zipOf({
      "feed_a/stops.txt": "stop_id\nA\n",
      "feed_b/stops.txt": "stop_id\nB\n",
    });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe("ambiguous_archive");
    // The refusal must name the file and both paths — otherwise nobody can fix it.
    expect(opened.detail).toContain("stops.txt");
    expect(opened.detail).toContain("feed_a/stops.txt");
    expect(opened.detail).toContain("feed_b/stops.txt");
  });

  it("does not refuse over a collision in a file no GTFS reader will ever open", async () => {
    const bytes = await zipOf({
      "stops.txt": "stop_id\nA\n",
      "docs/readme.txt": "hello",
      "notes/readme.txt": "hello again",
    });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(true);
  });

  it("ignores the macOS resource-fork sidecar rather than colliding with it", async () => {
    // A Finder-zipped feed — which is what a small agency sends — carries these.
    // Treating them as real entries would refuse the feed as ambiguous, and the
    // cause would be the uploader's operating system.
    const bytes = await zipOf({
      "stops.txt": "stop_id\nA\n",
      "__MACOSX/._stops.txt": "resource fork bytes",
      "__MACOSX/stops.txt": "resource fork bytes",
      "._stops.txt": "apple double",
    });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.archive.tableNames).toEqual(["stops.txt"]);
  });
});

describe("archiveMemberBasename", () => {
  it("keeps a plain name, strips directories, and refuses what must not be read", () => {
    expect(archiveMemberBasename("stops.txt")).toBe("stops.txt");
    expect(archiveMemberBasename("google_transit/stops.txt")).toBe("stops.txt");
    expect(archiveMemberBasename("a/b/c/stops.txt")).toBe("stops.txt");
    expect(archiveMemberBasename("windows\\style\\stops.txt")).toBe("stops.txt");
    expect(archiveMemberBasename("google_transit/")).toBeNull();
    expect(archiveMemberBasename("__MACOSX/stops.txt")).toBeNull();
    expect(archiveMemberBasename("wrapper/__MACOSX/stops.txt")).toBeNull();
    expect(archiveMemberBasename("._stops.txt")).toBeNull();
  });
});

describe("reading rows out of a table", () => {
  it("strips a UTF-8 BOM so the first column is not silently unreachable", async () => {
    // Without bom:true the first key is "﻿stop_id" and every lookup of
    // stop_id returns undefined — a feed that parses into nothing at all.
    const bytes = await zipOf({ "stops.txt": "﻿stop_id,stop_name\nA,Alpha\n" });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const rows = await collect(opened.archive, "stops.txt");
    expect(rows[0].stop_id).toBe("A");
  });

  it("keeps a row with the wrong number of fields instead of throwing", async () => {
    const bytes = await zipOf({
      "stops.txt": "stop_id,stop_name,stop_lat\nA,Alpha\nB,Beta,37.1,extra\n",
    });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const rows = await collect(opened.archive, "stops.txt");
    expect(rows).toHaveLength(2);
    expect(rows[0].stop_id).toBe("A");
    expect(rows[1].stop_id).toBe("B");
  });

  it("counts the bytes it actually decompressed", async () => {
    const content = "stop_id\n" + Array.from({ length: 500 }, (_, i) => `S${i}`).join("\n") + "\n";
    const bytes = await zipOf({ "stops.txt": content });
    const opened = await openGtfsZip(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.archive.bytesDecompressed).toBe(0);
    await collect(opened.archive, "stops.txt");
    expect(opened.archive.bytesDecompressed).toBe(Buffer.byteLength(content));
  });
});

describe("decompression is bounded", () => {
  it("refuses an archive larger than the deployment allows", async () => {
    const bytes = await zipOf({ "stops.txt": "stop_id\nA\n" });
    const limits = { ...resolveGtfsLimits({}), maxArchiveBytes: 10 };
    const opened = await openGtfsZip(bytes, { limits });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe("too_large");
  });

  it("refuses a file that is not a zip at all", async () => {
    const opened = await openGtfsZip(new TextEncoder().encode("this is a CSV, not a zip"));
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe("not_a_zip");
  });

  it("rejects early on the size a member DECLARES", async () => {
    const bytes = await zipOf({ "stops.txt": "stop_id\n" + "A".repeat(5_000) + "\n" });
    const limits = { ...resolveGtfsLimits({}), maxMemberUncompressedBytes: 100 };
    const opened = await openGtfsZip(bytes, { limits });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe("too_large");
    expect(opened.detail).toContain("stops.txt");
  });

  it("rejects an archive that claims an implausible expansion ratio", async () => {
    // DEFLATE explicitly: JSZip's default is STORE, which reports a compressed
    // size equal to the uncompressed one and a ratio of exactly 1. A test
    // written without this passes the ratio gate no matter what the gate does,
    // and would have proved nothing.
    const zip = new JSZip();
    zip.file("stops.txt", "A".repeat(200_000));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    const limits = { ...resolveGtfsLimits({}), maxDeclaredCompressionRatio: 5 };
    const opened = await openGtfsZip(bytes, { limits });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe("too_large");
  });

  it("STOPS MID-STREAM when a member decompresses past the cap, not only when it admits to it", async () => {
    // The declared size may only ever reject and may never admit — an archive
    // header is attacker-controlled. This drives the streaming counter directly,
    // with the declared-size gate deliberately out of the way, because that gate
    // is exactly what a bomb lies to.
    const content = "stop_id\n" + Array.from({ length: 2_000 }, (_, i) => `S${i}`).join("\n") + "\n";
    const zip = new JSZip();
    zip.file("stops.txt", content);
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
    const entries = new Map([["stops.txt", loaded.file("stops.txt")!]]);
    const archive = new GtfsArchive(entries, {
      ...resolveGtfsLimits({}),
      maxMemberUncompressedBytes: 64,
    });

    await expect(collect(archive, "stops.txt")).rejects.toBeInstanceOf(GtfsArchiveLimitError);
  });

  it("stops mid-stream when the TOTAL across members passes the cap", async () => {
    const content = "stop_id\n" + Array.from({ length: 2_000 }, (_, i) => `S${i}`).join("\n") + "\n";
    const zip = new JSZip();
    zip.file("stops.txt", content);
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
    const entries = new Map([["stops.txt", loaded.file("stops.txt")!]]);
    const archive = new GtfsArchive(entries, {
      ...resolveGtfsLimits({}),
      maxTotalUncompressedBytes: 64,
    });

    await expect(collect(archive, "stops.txt")).rejects.toBeInstanceOf(GtfsArchiveLimitError);
  });
});
