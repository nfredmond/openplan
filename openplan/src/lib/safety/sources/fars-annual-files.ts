/**
 * NHTSA FARS annual files: reading, checking and keeping them (D24).
 *
 * WHY THIS EXISTS. Each National annual archive is 33 to 35 MB (measured
 * 2026-11-13 for 2022 to 2024), over the Next.js data cache's 2 MB item limit,
 * so `fetch(..., { cache: "force-cache" })` kept nothing and every acquisition
 * downloaded three archives one after another. Measured the same day on a home
 * connection: 22 to 26 s per archive, about 71 s for three, past the hosted
 * ingest route's 60 s limit. Unzip, parse and filter took under 2 s per year.
 *
 * WHAT THIS DOES.
 *   - The adapter starts every file at once and waits at most
 *     `FARS_FILE_TIMING.deadlineMs` for all of them. A file that is not
 *     complete by then is a failed year, never a year with no crashes. Its
 *     download keeps going, up to `downloadLimitMs`, so the next acquisition
 *     can use what it finished.
 *   - A download is used only when the bytes received equal the declared
 *     length and the accident table is for the requested year.
 *   - After a good download, a reduced copy of the accident table (only the
 *     columns the FARS parser reads, about 1.9 MB a year) is kept in private
 *     Storage with a manifest that records the archive's URL, SHA-256, size,
 *     ETag, Last-Modified and read date, and the reduced copy's SHA-256.
 *     Keeping it is optional. Its uploads run on their own bound,
 *     `keepLimitMs`, outside the deadline: a slow upload never fails a year
 *     whose table was read and checked. An upload that misses its bound is
 *     abandoned, the manifest is not written, and the receipt says the copy
 *     was not kept.
 *   - A later read uses the kept copy only when its SHA-256 matches the
 *     manifest and NHTSA's live file still has the recorded size, ETag and
 *     date. Anything else is refused and the file is downloaded again.
 *
 * NHTSA REPLACES FILES AT THE SAME URL. The 2023 release notes
 * (https://static.nhtsa.gov/nhtsa/downloads/FARS/2023/FARS2023%20Release%20Notes.txt,
 * read 2026-11-13) list three releases of one archive: the annual file on
 * 04/08/2025, a revision on 07/03/2025 and the final file on 04/01/2026. That
 * is why a kept copy is compared with the live file on every read. When NHTSA
 * cannot be reached for that check, the kept copy is used as first read and
 * its receipt says the check did not run.
 */

import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import JSZip from "jszip";
import type { CrashSourceFileReceipt, KeptSourceFileStore } from "./types";

const MAX_ARCHIVE_BYTES = 48 * 1024 * 1024;
const MAX_ACCIDENT_CSV_BYTES = 36 * 1024 * 1024;
const MAX_EXTRACT_BYTES = 8 * 1024 * 1024;

export type FarsFileTiming = {
  /** How long an acquisition waits for its files, all started together. */
  deadlineMs: number;
  /** How long a download may continue, including after the acquisition stopped waiting. */
  downloadLimitMs: number;
  /** How long the live-file check for a kept copy may take. */
  sourceCheckMs: number;
  /**
   * How long keeping a copy may take after a good download, counted from the
   * end of the download, not against `deadlineMs`. Past it the copy is
   * abandoned and its manifest is never written.
   */
  keepLimitMs: number;
};

/**
 * 40 s leaves the hosted ingest route (`maxDuration = 60`) about 20 s for
 * parsing and writing crashes. A kept copy reads in about 1 s. Keeping a
 * copy (about 1.9 MB a year, uploaded in parallel) may add at most 5 s, so a
 * download that lands at the deadline still leaves the route about 15 s.
 */
export const FARS_FILE_TIMING: FarsFileTiming = {
  deadlineMs: 40_000,
  downloadLimitMs: 300_000,
  sourceCheckMs: 5_000,
  keepLimitMs: 5_000,
};

const EXTRACT_FORMAT = "openplan.fars-accident-extract.v1";

/**
 * Every accident-table field name the FARS parser (`toFarsCrashRecord` in
 * `fars.ts`) can read, in its normalized form. A column whose normalized name
 * is not here is dropped from the kept copy. Adding a field to the parser
 * means adding it here and changing `EXTRACT_FORMAT`, so older kept copies
 * stop matching and are read again from NHTSA.
 */
const EXTRACT_FIELDS: ReadonlySet<string> = new Set([
  "state", "statecode", "statefips",
  "stcase", "case",
  "caseyear", "year", "month", "day",
  "crashdt", "crashdate", "date",
  "latitude", "lat", "longitud", "longitude", "lon", "lng",
  "fatals", "totalfatals",
  "peds", "pedestrians", "bicyclists", "pedalcyclists", "bikes",
]);

type FarsAnnualFileResult =
  | { ok: true; csv: string; receipt: CrashSourceFileReceipt }
  | { ok: false; receipt: CrashSourceFileReceipt };

type KeptRecord = Omit<KeptManifest, "format" | "extractPath" | "extractSha256">;

/**
 * A read and, after a good download, the bounded upload of its kept copy.
 * `keeping` resolves true only when the manifest was written within
 * `keepLimitMs`; it never rejects.
 */
type FarsAnnualFileRead = { result: FarsAnnualFileResult; keeping: Promise<boolean> | null };

type KeptManifest = {
  format: string;
  sourceUrl: string;
  year: number;
  archiveSha256: string;
  archiveBytes: number;
  etag: string | null;
  lastModified: string | null;
  readAt: string;
  extractPath: string;
  extractSha256: string;
};

function normalizeField(name: string): string {
  return name.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function failed(url: string, year: number, failure: string): FarsAnnualFileResult {
  return {
    ok: false,
    receipt: { year, sourceUrl: url, status: "failed", sha256: null, bytes: null, readAt: null, retrieval: null, failure },
  };
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The accident table reduced to the fields the parser reads, or the reason it
 * was refused. A row whose YEAR is another year refuses the whole table: a
 * file for the wrong year is not this year's census, whatever its URL says.
 */
function reduceFarsAccidentTable(csv: string, year: number): { csv: string; rowCount: number } | { refused: string } {
  let rows: unknown[];
  try {
    rows = parseCsv(csv, { bom: true, relax_column_count: true, skip_empty_lines: true }) as unknown[];
  } catch {
    return { refused: "the accident table could not be parsed" };
  }
  const [header, ...body] = rows;
  if (!Array.isArray(header) || header.length === 0) return { refused: "the accident table has no header" };

  const kept = header
    .map((name, index) => ({ name: String(name).trim(), index }))
    .filter((column) => EXTRACT_FIELDS.has(normalizeField(column.name)));
  const yearColumn = kept.find((column) => normalizeField(column.name) === "year");
  const lines = [kept.map((column) => csvField(column.name)).join(",")];

  for (const row of body) {
    if (!Array.isArray(row)) continue;
    if (yearColumn) {
      const rowYear = Number.parseInt(String(row[yearColumn.index] ?? "").trim(), 10);
      if (Number.isFinite(rowYear) && rowYear !== year) {
        return { refused: `the accident table holds ${rowYear} crashes, not ${year}` };
      }
    }
    lines.push(kept.map((column) => csvField(String(row[column.index] ?? ""))).join(","));
  }
  return { csv: lines.join("\n"), rowCount: body.length };
}

function keptPaths(url: string): { dir: string; manifest: string } {
  const dir = `fars/${sha256Hex(new TextEncoder().encode(url)).slice(0, 32)}`;
  return { dir, manifest: `${dir}/manifest.json` };
}

const HEX_64 = /^[a-f0-9]{64}$/;

function parseManifest(bytes: Uint8Array, url: string, year: number, dir: string): KeptManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  const optionalText = (field: unknown) => field === null || typeof field === "string";
  const valid =
    m.format === EXTRACT_FORMAT &&
    m.sourceUrl === url &&
    m.year === year &&
    typeof m.archiveSha256 === "string" && HEX_64.test(m.archiveSha256) &&
    typeof m.extractSha256 === "string" && HEX_64.test(m.extractSha256) &&
    typeof m.archiveBytes === "number" && Number.isInteger(m.archiveBytes) && m.archiveBytes > 0 &&
    typeof m.readAt === "string" && !Number.isNaN(Date.parse(m.readAt)) &&
    typeof m.extractPath === "string" && m.extractPath === `${dir}/${m.archiveSha256}.csv` &&
    optionalText(m.etag) && optionalText(m.lastModified);
  return valid ? (m as KeptManifest) : null;
}

/** Whether NHTSA's live file is still the one the manifest recorded. */
async function checkLiveFile(url: string, manifest: KeptManifest, timeoutMs: number): Promise<"match" | "changed" | "unchecked"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", signal: controller.signal });
    if (!response.ok) return "unchecked";
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) !== manifest.archiveBytes) return "changed";
    const etag = response.headers.get("etag");
    if (etag !== null && manifest.etag !== null && etag !== manifest.etag) return "changed";
    const lastModified = response.headers.get("last-modified");
    if (lastModified !== null && manifest.lastModified !== null && lastModified !== manifest.lastModified) return "changed";
    return "match";
  } catch {
    return "unchecked";
  } finally {
    clearTimeout(timer);
  }
}

async function readKeptCopy(
  url: string,
  year: number,
  store: KeptSourceFileStore,
  sourceCheckMs: number,
): Promise<FarsAnnualFileResult | null> {
  const paths = keptPaths(url);
  const manifestBytes = await store.read(paths.manifest);
  if (!manifestBytes) return null;
  const manifest = parseManifest(manifestBytes, url, year, paths.dir);
  if (!manifest) return null;

  const live = await checkLiveFile(url, manifest, sourceCheckMs);
  if (live === "changed") return null;

  const extractBytes = await store.read(manifest.extractPath);
  if (!extractBytes || extractBytes.byteLength > MAX_EXTRACT_BYTES) return null;
  // Used only when it is, byte for byte, what was kept at first read. A
  // truncated or altered copy is refused here, before anything parses it.
  if (sha256Hex(extractBytes) !== manifest.extractSha256) return null;

  const checked = reduceFarsAccidentTable(new TextDecoder().decode(extractBytes), year);
  if ("refused" in checked) return null;

  return {
    ok: true,
    csv: checked.csv,
    receipt: {
      year,
      sourceUrl: url,
      status: "read",
      sha256: manifest.archiveSha256,
      bytes: manifest.archiveBytes,
      readAt: manifest.readAt,
      retrieval: "kept_copy",
      sourceCheckedAt: live === "match" ? new Date().toISOString() : null,
    },
  };
}

/**
 * Keep the reduced copy, then its manifest, within `limitMs`. Resolves true
 * only when both writes succeeded in time, false otherwise; never rejects.
 * Past the limit the copy is abandoned: an extract upload still under way may
 * land, but no manifest is written after the limit, so no later read trusts it.
 */
async function keep(store: KeptSourceFileStore, record: KeptRecord, extractCsv: string, limitMs: number): Promise<boolean> {
  const paths = keptPaths(record.sourceUrl);
  const extractBytes = new TextEncoder().encode(extractCsv);
  const manifest: KeptManifest = {
    format: EXTRACT_FORMAT,
    ...record,
    extractPath: `${paths.dir}/${record.archiveSha256}.csv`,
    extractSha256: sha256Hex(extractBytes),
  };
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      abandoned = true;
      resolve(false);
    }, limitMs);
  });
  // The manifest goes last, so a copy whose upload stopped part way, or ran
  // past the limit, is never named by one.
  const writes = (async () => {
    if (!(await store.write(manifest.extractPath, extractBytes, "text/csv"))) return false;
    if (abandoned) return false;
    return store.write(paths.manifest, new TextEncoder().encode(JSON.stringify(manifest)), "application/json");
  })().catch(() => false);
  try {
    return await Promise.race([writes, limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function accidentTable(archiveBytes: Uint8Array): Promise<string | null> {
  try {
    const archive = await JSZip.loadAsync(archiveBytes);
    const entry = Object.values(archive.files).find((file) => !file.dir && /(?:^|\/)accident\.csv$/i.test(file.name));
    if (!entry) return null;
    const csv = await entry.async("string");
    return Buffer.byteLength(csv, "utf8") <= MAX_ACCIDENT_CSV_BYTES ? csv : null;
  } catch {
    return null;
  }
}

/** A failed read, with no copy to keep. */
function failedRead(url: string, year: number, failure: string): FarsAnnualFileRead {
  return { result: failed(url, year, failure), keeping: null };
}

/**
 * Download, check and reduce one archive. The checked table is returned as
 * soon as it is ready; keeping a copy starts then and runs on its own bound.
 */
async function downloadAndKeep(
  url: string,
  year: number,
  store: KeptSourceFileStore | undefined,
  timing: FarsFileTiming,
): Promise<FarsAnnualFileRead> {
  const read = await download(url, year, timing.downloadLimitMs);
  if (!read.result.ok || !store || !read.kept) return { result: read.result, keeping: null };
  return { result: read.result, keeping: keep(store, read.kept, read.result.csv, timing.keepLimitMs) };
}

async function download(
  url: string,
  year: number,
  limitMs: number,
): Promise<{ result: FarsAnnualFileResult; kept: KeptRecord | null }> {
  const fail = (failure: string) => ({ result: failed(url, year, failure), kept: null });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { cache: "no-store", signal: controller.signal });
    } catch {
      return fail("NHTSA could not be reached");
    }
    if (!response.ok) return fail(`NHTSA answered HTTP ${response.status}`);

    const declaredHeader = response.headers.get("content-length");
    const declared = declaredHeader === null ? Number.NaN : Number(declaredHeader);
    if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) return fail("the archive is larger than OpenPlan reads");

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      return fail("the download stopped before the archive was complete");
    }
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) return fail("the archive is larger than OpenPlan reads");
    if (Number.isFinite(declared) && bytes.byteLength !== declared) {
      return fail(`received ${bytes.byteLength} of ${declared} bytes`);
    }

    const csv = await accidentTable(bytes);
    if (csv === null) return fail("the archive has no readable accident table");
    const extract = reduceFarsAccidentTable(csv, year);
    if ("refused" in extract) return fail(extract.refused);

    const archiveSha256 = sha256Hex(bytes);
    const readAt = new Date().toISOString();
    return {
      result: {
        ok: true,
        csv: extract.csv,
        receipt: {
          year,
          sourceUrl: url,
          status: "read",
          sha256: archiveSha256,
          bytes: bytes.byteLength,
          readAt,
          retrieval: "source_download",
        },
      },
      kept: {
        sourceUrl: url,
        year,
        archiveSha256,
        archiveBytes: bytes.byteLength,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        readAt,
      },
    };
  } catch {
    return fail("the archive could not be read");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads under way in this process, by URL. Two acquisitions that need the
 * same file at the same time share one download, and an acquisition that
 * stopped waiting leaves its download here for the next one.
 */
const downloadsUnderWay = new Map<string, Promise<FarsAnnualFileRead>>();

function downloadOnce(url: string, year: number, store: KeptSourceFileStore | undefined, timing: FarsFileTiming) {
  const existing = downloadsUnderWay.get(url);
  if (existing) return existing;
  const started = downloadAndKeep(url, year, store, timing).finally(() => downloadsUnderWay.delete(url));
  downloadsUnderWay.set(url, started);
  return started;
}

async function readKeptOrDownload(
  url: string,
  year: number,
  store: KeptSourceFileStore | undefined,
  timing: FarsFileTiming,
): Promise<FarsAnnualFileRead> {
  if (store) {
    const kept = await readKeptCopy(url, year, store, timing.sourceCheckMs).catch(() => null);
    if (kept) return { result: kept, keeping: null };
  }
  return downloadOnce(url, year, store, timing);
}

/**
 * One annual file's accident table, reduced to the parser's fields, or a
 * failed receipt saying why not. Never rejects.
 */
export async function readFarsAnnualFile(input: {
  url: string;
  year: number;
  keptFiles?: KeptSourceFileStore;
  signal?: AbortSignal;
  timing?: FarsFileTiming;
}): Promise<FarsAnnualFileResult> {
  const { url, year } = input;
  const timing = input.timing ?? FARS_FILE_TIMING;
  if (input.signal?.aborted) return failed(url, year, "the request was stopped");

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopWaiting = new Promise<FarsAnnualFileRead>((resolve) => {
    timer = setTimeout(
      () => resolve(failedRead(url, year, `NHTSA did not deliver the file within ${Math.round(timing.deadlineMs / 1000)} s`)),
      timing.deadlineMs,
    );
    onAbort = () => resolve(failedRead(url, year, "the request was stopped"));
    input.signal?.addEventListener("abort", onAbort, { once: true });
  });

  let read: FarsAnnualFileRead;
  try {
    read = await Promise.race([readKeptOrDownload(url, year, input.keptFiles, timing), stopWaiting]);
  } finally {
    clearTimeout(timer);
    if (onAbort) input.signal?.removeEventListener("abort", onAbort);
  }
  if (!read.keeping || !read.result.ok) return read.result;
  // The table is read and checked. The copy's upload is bounded by
  // `keepLimitMs` on its own, so waiting here never fails the year.
  const copyKept = await read.keeping;
  return { ...read.result, receipt: { ...read.result.receipt, copyKept } };
}
