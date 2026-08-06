/**
 * READING A GTFS ARCHIVE WITHOUT EVER HOLDING ONE OF ITS TABLES IN MEMORY.
 *
 * A GTFS zip's `stop_times.txt` is the largest single thing this product parses:
 * King County Metro's is 126.6 MB inside a 17.5 MB archive (measured
 * 2026-08-05), CTA Chicago's archive is 94 MiB. Reading a member with jszip's
 * `async("string")` materialises the whole thing — a quarter of a gigabyte of
 * JavaScript string for one agency, before a single row is looked at. So nothing
 * here ever does that. Every table is a `nodeStream` piped through `csv-parse`,
 * yielded a row at a time, and the row is the caller's to discard.
 *
 * THE THREE THINGS THIS FILE IS RESPONSIBLE FOR:
 *
 *   1. FINDING A TABLE BY BASENAME. Feeds are commonly published zipped inside a
 *      wrapping directory (`google_transit/stops.txt`, `gtfs-2026-08/stops.txt`).
 *      Matching the full path finds nothing and the feed reads as
 *      `missing_required_file` — a working feed refused over a directory name.
 *
 *   2. REFUSING AMBIGUITY INSTEAD OF GUESSING. If two members share a basename,
 *      there is no honest answer to "which one is stops.txt". Picking the first,
 *      the shortest path, or the largest is a guess, and a guess about which
 *      stops file is real is a guess about where an agency's bus stops are.
 *
 *   3. BOUNDING DECOMPRESSION. A zip is an untrusted input that decides how much
 *      memory and CPU it costs us. Both caps below are enforced on bytes
 *      ACTUALLY DECOMPRESSED as they stream.
 *
 * ON THE DECLARED SIZE, AND WHY IT MAY ONLY EVER SAY NO. jszip exposes
 * `entry._data.uncompressedSize` after `loadAsync` without decompressing
 * anything, which makes an instant early reject possible. Two facts govern its
 * use and both are load-bearing:
 *
 *   - IT IS ATTACKER-CONTROLLED. It is a number in the archive's own header. A
 *     bomb can declare 1 KB and deliver 4 PB. So it may REJECT (a member that
 *     admits to being enormous is enormous) and it may NEVER ADMIT (a member
 *     that claims to be small proves nothing). The streaming counters are the
 *     real defence; this is a fast path that saves us decompressing an archive
 *     that already told us it was too big.
 *   - IT IS A PRIVATE FIELD. `_data` is not jszip's public API and a future
 *     version may rename it. Its absence is handled as "no early reject
 *     available", never as "size 0" — which is the same rule again: absence of
 *     evidence may not be read as evidence of smallness.
 */

import { Transform } from "node:stream";
import JSZip from "jszip";
import { parse } from "csv-parse";
import { resolveGtfsLimits, type GtfsLimitEnv, type ResolvedGtfsLimits } from "./limits";

/**
 * Every file the GTFS static specification defines, by basename.
 *
 * Used for ONE thing: deciding which basename collisions are worth refusing an
 * archive over. A feed that happens to contain `notes/readme.txt` twice under
 * two directories is not ambiguous in any way that matters — we will never read
 * it. A feed containing two `stops.txt` is unreadable, and saying so is the
 * whole point. Scoping the refusal to files we might actually open keeps it a
 * statement about the FEED rather than about the zip's housekeeping.
 */
export const GTFS_SPEC_TABLE_FILES = [
  "agency.txt",
  "stops.txt",
  "routes.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "fare_attributes.txt",
  "fare_rules.txt",
  "timeframes.txt",
  "fare_media.txt",
  "fare_products.txt",
  "fare_leg_rules.txt",
  "fare_transfer_rules.txt",
  "areas.txt",
  "stop_areas.txt",
  "networks.txt",
  "route_networks.txt",
  "shapes.txt",
  "frequencies.txt",
  "transfers.txt",
  "pathways.txt",
  "levels.txt",
  "location_groups.txt",
  "location_group_stops.txt",
  "booking_rules.txt",
  "translations.txt",
  "feed_info.txt",
  "attributions.txt",
] as const;

const GTFS_SPEC_TABLE_FILE_SET: ReadonlySet<string> = new Set(GTFS_SPEC_TABLE_FILES);

/**
 * Thrown from inside a member stream when a decompression cap is passed, and
 * converted to a `too_large` result by whoever is driving the stream. A tagged
 * class rather than a bare Error so `parse.ts` can tell a feed problem (which
 * becomes a result) from a programming error (which must keep throwing).
 */
export class GtfsArchiveLimitError extends Error {
  readonly limitName: string;
  constructor(limitName: string, message: string) {
    super(message);
    this.name = "GtfsArchiveLimitError";
    this.limitName = limitName;
  }
}

/** A member stream failed part-way — truncated deflate stream, bad CRC, and so on. */
export class GtfsArchiveStreamError extends Error {
  readonly table: string;
  constructor(table: string, message: string) {
    super(message);
    this.name = "GtfsArchiveStreamError";
    this.table = table;
  }
}

export type GtfsArchiveOpenFailureCode = "too_large" | "not_a_zip" | "ambiguous_archive";

export type GtfsArchiveOpenResult =
  | { ok: true; archive: GtfsArchive }
  | { ok: false; code: GtfsArchiveOpenFailureCode; detail: string };

/** The size an archive DECLARES for a member, when jszip will tell us. */
type DeclaredSizes = { uncompressed: number | null; compressed: number | null };

function readDeclaredSizes(entry: JSZip.JSZipObject): DeclaredSizes {
  // `_data` is jszip-private. Reached deliberately and defensively: every read
  // below tolerates the field being gone, because a jszip upgrade that renames
  // it must cost us a fast path, not correctness.
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown; compressedSize?: unknown } })._data;
  const uncompressed = typeof data?.uncompressedSize === "number" && Number.isFinite(data.uncompressedSize)
    ? data.uncompressedSize
    : null;
  const compressed = typeof data?.compressedSize === "number" && Number.isFinite(data.compressedSize)
    ? data.compressedSize
    : null;
  return { uncompressed, compressed };
}

/**
 * The basename of an archive member, or null if the member is one we must not
 * consider at all.
 *
 * Excluded, and each for a reason a real feed produced:
 *   - directory entries (`foo/`) are not files;
 *   - `__MACOSX/` is the resource-fork sidecar every macOS Finder zip carries,
 *     and its contents mirror the real names;
 *   - `._stops.txt` is the AppleDouble form of the same thing;
 *   - an empty basename is a malformed entry.
 *
 * Without the first two exclusions, a feed zipped on a Mac — which is most feeds
 * from a small agency — would collide with itself and be refused as ambiguous.
 * That would be a refusal caused entirely by the uploader's operating system.
 */
export function archiveMemberBasename(path: string): string | null {
  if (path.endsWith("/")) return null;
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("__MACOSX/") || normalized.includes("/__MACOSX/")) return null;
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (!base) return null;
  if (base.startsWith("._")) return null;
  return base;
}

/**
 * A counting pass-through that refuses to carry more bytes than it is allowed.
 *
 * Two ceilings, because they catch different attacks: one enormous member, and
 * many members that are individually plausible. Both are checked on real bytes
 * leaving the decompressor, which is the only number an archive cannot lie
 * about.
 */
function createByteCounter(
  table: string,
  memberCap: number,
  onTotal: (delta: number) => number,
  totalCap: number,
): Transform {
  let memberBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      memberBytes += chunk.length;
      const total = onTotal(chunk.length);
      if (memberBytes > memberCap) {
        callback(
          new GtfsArchiveLimitError(
            "maxMemberUncompressedBytes",
            `${table} decompressed past the ${memberCap.toLocaleString("en-US")}-byte per-file limit for this deployment.`,
          ),
        );
        return;
      }
      if (total > totalCap) {
        callback(
          new GtfsArchiveLimitError(
            "maxTotalUncompressedBytes",
            `This feed decompressed past the ${totalCap.toLocaleString("en-US")}-byte total limit for this deployment.`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

/**
 * An opened GTFS archive: which tables it has, and a row stream for each.
 *
 * Holds the compressed archive, never a decompressed table.
 */
export class GtfsArchive {
  readonly #entries: ReadonlyMap<string, JSZip.JSZipObject>;
  readonly #limits: ResolvedGtfsLimits;
  #bytesDecompressed = 0;

  constructor(entries: ReadonlyMap<string, JSZip.JSZipObject>, limits: ResolvedGtfsLimits) {
    this.#entries = entries;
    this.#limits = limits;
  }

  /** Basenames present, sorted. Provenance for a UI and for a test. */
  get tableNames(): string[] {
    return [...this.#entries.keys()].sort();
  }

  /** Real bytes decompressed so far across every table streamed. */
  get bytesDecompressed(): number {
    return this.#bytesDecompressed;
  }

  has(table: string): boolean {
    return this.#entries.has(table);
  }

  /**
   * The size the archive CLAIMS for a table, or null when jszip will not say.
   * Never used to decide that a table is small enough to read — see the header.
   */
  declaredUncompressedSize(table: string): number | null {
    const entry = this.#entries.get(table);
    if (!entry) return null;
    return readDeclaredSizes(entry).uncompressed;
  }

  /**
   * Rows of one table, streamed. A table the archive does not have yields
   * nothing — an ABSENT optional table and an EMPTY one are the same thing to
   * every caller here, and the difference is available through `has()` for the
   * one caller (the required-file check) that needs it.
   *
   * The csv-parse options are the ones a real corpus of feeds requires:
   *   columns          - rows as objects keyed by the header.
   *   bom              - a UTF-8 BOM is extremely common in published feeds and
   *                      without this the first column is named "﻿stop_id"
   *                      and every lookup of `stop_id` silently returns
   *                      undefined. `gtfs_skim.py` handles the same thing with
   *                      `encoding="utf-8-sig"`.
   *   skip_empty_lines - trailing newlines are universal.
   *   relax_column_count - a row with more or fewer fields than the header is
   *                      kept rather than throwing. This is the row-level
   *                      tolerance rule: one malformed row must not cost an
   *                      agency their whole feed. The caller sees the row with
   *                      missing keys and records a `bad_csv_row` warning.
   */
  async *streamTable(table: string): AsyncGenerator<Record<string, string>, void, undefined> {
    const entry = this.#entries.get(table);
    if (!entry) return;

    // jszip types `nodeStream` as `NodeJS.ReadableStream`, which does not
    // declare `destroy`. The object really is a `Readable` (jszip's
    // NodejsStreamOutputAdapter extends it), and without destroying it an
    // abandoned stream keeps a decompressor alive — so the cast is narrowed to
    // exactly the one method the declared type is missing rather than to `any`.
    const source = entry.nodeStream("nodebuffer") as NodeJS.ReadableStream & {
      destroy: (error?: Error) => void;
    };
    const counter = createByteCounter(
      table,
      this.#limits.maxMemberUncompressedBytes,
      (delta) => (this.#bytesDecompressed += delta),
      this.#limits.maxTotalUncompressedBytes,
    );
    const parser = parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    // ERRORS MUST BE FORWARDED BY HAND. `pipe()` does not propagate them, so
    // without these two lines a cap breach destroys the counter, the parser
    // never learns, the `for await` below waits forever, and the counter's
    // unhandled 'error' takes the process down instead. That is precisely the
    // zip-bomb case: the defence would hang the request rather than refuse it.
    // Found by the streaming-cap test, which timed out at 5 s before this
    // existed.
    source.on("error", (error: Error) => counter.destroy(error));
    counter.on("error", (error: Error) => parser.destroy(error));
    counter.pipe(parser);
    source.pipe(counter);

    try {
      for await (const row of parser) {
        yield row as Record<string, string>;
      }
    } catch (error) {
      if (error instanceof GtfsArchiveLimitError) throw error;
      throw new GtfsArchiveStreamError(
        table,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      // Consumers legitimately stop early (a row cap, a deadline). Nothing here
      // is auto-destroyed by `pipe`, so an abandoned stream would keep a
      // decompressor alive for the life of the request.
      source.destroy();
      counter.destroy();
      parser.destroy();
    }
  }
}

/**
 * Open an archive: index it by basename, refuse it if it is ambiguous, oversized
 * or not a zip at all.
 *
 * Returns a result rather than throwing, because "this file is not a zip" is
 * something a person did, not something that went wrong.
 */
export async function openGtfsZip(
  bytes: Uint8Array,
  options: { limits?: ResolvedGtfsLimits; env?: GtfsLimitEnv } = {},
): Promise<GtfsArchiveOpenResult> {
  const limits = options.limits ?? resolveGtfsLimits(options.env);

  if (bytes.byteLength > limits.maxArchiveBytes) {
    return {
      ok: false,
      code: "too_large",
      detail:
        `This feed is ${bytes.byteLength.toLocaleString("en-US")} bytes and this deployment accepts up to ` +
        `${limits.maxArchiveBytes.toLocaleString("en-US")}. Whoever operates this deployment can raise the limit.`,
    };
  }

  let loaded: JSZip;
  try {
    loaded = await JSZip.loadAsync(bytes);
  } catch (error) {
    return {
      ok: false,
      code: "not_a_zip",
      detail: `This file could not be opened as a zip archive: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const entries = new Map<string, JSZip.JSZipObject>();
  const collisions = new Set<string>();
  const collisionPaths = new Map<string, string[]>();
  let declaredTotal = 0;
  let compressedTotal = 0;

  loaded.forEach((path, entry) => {
    if (entry.dir) return;
    const base = archiveMemberBasename(path);
    if (!base) return;

    const declared = readDeclaredSizes(entry);
    if (declared.uncompressed !== null) declaredTotal += declared.uncompressed;
    if (declared.compressed !== null) compressedTotal += declared.compressed;

    if (entries.has(base)) {
      if (GTFS_SPEC_TABLE_FILE_SET.has(base)) {
        collisions.add(base);
        const seen = collisionPaths.get(base) ?? [];
        collisionPaths.set(base, [...seen, path]);
      }
      // A non-spec collision is left alone: the first entry wins for a file
      // nothing will ever open.
      return;
    }
    entries.set(base, entry);
    if (GTFS_SPEC_TABLE_FILE_SET.has(base)) collisionPaths.set(base, [path]);
  });

  if (collisions.size > 0) {
    const named = [...collisions].sort();
    const detail = named
      .map((base) => `${base} (${(collisionPaths.get(base) ?? []).join(", ")})`)
      .join("; ");
    return {
      ok: false,
      code: "ambiguous_archive",
      detail:
        `This archive contains more than one copy of ${named.length === 1 ? "a GTFS file" : "several GTFS files"}: ${detail}. ` +
        `OpenPlan will not guess which one is the real table — re-zip the feed with one copy of each file.`,
    };
  }

  // EARLY REJECT ONLY. A declared total over the cap means the archive itself
  // says it is too big; believing that is safe because it can only make us
  // refuse. The opposite reading — "declared total is small, therefore safe" —
  // is what makes zip bombs work, and the streaming counters exist precisely
  // because nothing here is entitled to trust this number in that direction.
  if (declaredTotal > limits.maxTotalUncompressedBytes) {
    return {
      ok: false,
      code: "too_large",
      detail:
        `This feed declares ${declaredTotal.toLocaleString("en-US")} bytes of content and this deployment accepts up to ` +
        `${limits.maxTotalUncompressedBytes.toLocaleString("en-US")}.`,
    };
  }

  if (compressedTotal > 0 && declaredTotal / compressedTotal > limits.maxDeclaredCompressionRatio) {
    return {
      ok: false,
      code: "too_large",
      detail:
        `This archive claims to expand ${Math.round(declaredTotal / compressedTotal).toLocaleString("en-US")}x, past the ` +
        `${limits.maxDeclaredCompressionRatio}x this deployment allows. Real GTFS feeds expand about 5-8x.`,
    };
  }

  for (const [base, entry] of entries) {
    const declared = readDeclaredSizes(entry).uncompressed;
    if (declared !== null && declared > limits.maxMemberUncompressedBytes) {
      return {
        ok: false,
        code: "too_large",
        detail:
          `${base} declares ${declared.toLocaleString("en-US")} bytes and this deployment accepts up to ` +
          `${limits.maxMemberUncompressedBytes.toLocaleString("en-US")} for one file.`,
      };
    }
  }

  return { ok: true, archive: new GtfsArchive(entries, limits) };
}
