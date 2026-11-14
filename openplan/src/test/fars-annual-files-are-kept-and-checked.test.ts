// @vitest-environment node
/**
 * FARS annual files are read once, checked, and kept (D24).
 *
 * Each National archive is 33 to 35 MB, over the Next.js data cache's 2 MB
 * item limit, so every acquisition downloaded three archives one after
 * another (about 71 s on 2026-11-13 from a home connection; the hosted ingest
 * route stops at 60 s). These tests stub NHTSA and the kept-file store and
 * check what the adapter downloads, what it keeps, and what it refuses.
 *
 * Blind category: NHTSA and Storage are fakes. Real transfer times, Supabase
 * Storage behavior, and the hosted 60 s limit are not exercised here; the
 * archives are small synthetic ones except where the Puerto Rico fixture
 * (rows copied verbatim from NHTSA's 2024 file) is used.
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import sample from "./fixtures/fars-puerto-rico-accident-sample.json";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import {
  farsAnnualArchiveUrl,
  farsPuertoRicoArchiveUrl,
  fetchFarsCrashes,
  parseFarsAnnualCsv,
} from "@/lib/safety/sources/fars";
import { readFarsAnnualFile, type FarsFileTiming } from "@/lib/safety/sources/fars-annual-files";
import { KEPT_SOURCE_FILE_BUCKET, KEPT_SOURCE_FILE_PREFIX } from "@/lib/safety/sources/kept-source-files";
import type { CrashSourceFileReceipt, KeptSourceFileStore } from "@/lib/safety/sources/types";

/** A rural Nevada rectangle: inside the National file's envelope, far from Puerto Rico's. */
const BBOX = { minLon: -119.9, minLat: 39.1, maxLon: -119.1, maxLat: 39.9 };
const PUERTO_RICO_BBOX = { minLon: -67.3, minLat: 17.9, maxLon: -65.4, maxLat: 18.52 };
const YEARS = [2024, 2023, 2022];
const CRASHES_PER_YEAR = 5;
const QUICK: FarsFileTiming = { deadlineMs: 5_000, downloadLimitMs: 10_000, sourceCheckMs: 1_000, keepLimitMs: 1_000 };

/**
 * A National archive for `year`. `rowYear` lets a test publish a table for
 * another year under this year's URL. STATENAME and CITYNAME are columns the
 * parser never reads, so the kept copy must drop them.
 */
async function nationalArchive(year: number, rowYear = year): Promise<Uint8Array> {
  const header = "STATE,STATENAME,ST_CASE,PEDS,CITYNAME,MONTH,DAY,YEAR,LATITUDE,LONGITUD,FATALS";
  const rows = Array.from({ length: CRASHES_PER_YEAR }, (_, index) =>
    [32, "Nevada", 320000 + index + 1, index % 2, "\"RENO, CITY OF\"", 3, index + 1, rowYear,
      (39.2 + index * 0.1).toFixed(6), (-119.8 + index * 0.1).toFixed(6), 1].join(",")
  );
  const zip = new JSZip();
  zip.file(`FARS${year}NationalCSV/accident.csv`, [header, ...rows].join("\r\n"));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

type Served = { bytes: Uint8Array; etag?: string; declaredLength?: number } | "hang" | { delayMs: number; bytes: Uint8Array };

/** A stub of static.nhtsa.gov that counts archive downloads and HEAD checks per URL. */
function stubNhtsa(served: Map<string, Served>) {
  const downloads = new Map<string, number>();
  const checks = new Map<string, number>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const counter = method === "HEAD" ? checks : downloads;
    counter.set(url, (counter.get(url) ?? 0) + 1);
    const entry = served.get(url);
    if (!entry) return new Response("NoSuchKey", { status: 404 });
    if (entry === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    if ("delayMs" in entry && method !== "HEAD") await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
    const headers = {
      "content-length": String("declaredLength" in entry && entry.declaredLength ? entry.declaredLength : entry.bytes.byteLength),
      etag: "etag" in entry && entry.etag ? entry.etag : `"${url.length}-1"`,
      "last-modified": "Wed, 01 Apr 2026 19:46:56 GMT",
    };
    return method === "HEAD"
      ? new Response(null, { status: 200, headers })
      : new Response(entry.bytes.slice(), { status: 200, headers });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { downloads, checks };
}

function memoryStore() {
  const objects = new Map<string, Uint8Array>();
  const store: KeptSourceFileStore = {
    read: async (path) => objects.get(path)?.slice() ?? null,
    write: async (path, bytes) => {
      objects.set(path, bytes.slice());
      return true;
    },
  };
  return { objects, store };
}

function manifestFor(objects: Map<string, Uint8Array>, url: string): Record<string, unknown> {
  for (const [path, bytes] of objects) {
    if (!path.endsWith("/manifest.json")) continue;
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (manifest.sourceUrl === url) return manifest;
  }
  throw new Error(`nothing kept for ${url}`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function receipts(result: Awaited<ReturnType<typeof fetchFarsCrashes>>): CrashSourceFileReceipt[] {
  return (result.publishedCutoff?.provenance.sourceFiles ?? []) as CrashSourceFileReceipt[];
}

async function serveAllYears(): Promise<Map<string, Served>> {
  const served = new Map<string, Served>();
  for (const year of YEARS) served.set(farsAnnualArchiveUrl(year), { bytes: await nationalArchive(year) });
  return served;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a second FARS acquisition reads the kept copies", () => {
  it("downloads each annual archive once and reads the same crashes from the kept copies", async () => {
    const served = await serveAllYears();
    const nhtsa = stubNhtsa(served);
    const { store } = memoryStore();

    const first = await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, QUICK);
    const second = await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, QUICK);

    for (const year of YEARS) {
      expect(nhtsa.downloads.get(farsAnnualArchiveUrl(year)), `${year} downloads`).toBe(1);
      expect(nhtsa.checks.get(farsAnnualArchiveUrl(year)), `${year} live-file checks`).toBe(1);
    }
    expect(first.records).toHaveLength(CRASHES_PER_YEAR * YEARS.length);
    expect(second.records).toEqual(first.records);
    expect(second.yearsQueried).toEqual([2022, 2023, 2024]);

    const firstReceipts = receipts(first);
    const secondReceipts = receipts(second);
    for (const year of YEARS) {
      const archive = served.get(farsAnnualArchiveUrl(year)) as { bytes: Uint8Array };
      const downloaded = firstReceipts.find((receipt) => receipt.year === year)!;
      const kept = secondReceipts.find((receipt) => receipt.year === year)!;
      expect(downloaded).toMatchObject({
        status: "read",
        retrieval: "source_download",
        sourceUrl: farsAnnualArchiveUrl(year),
        sha256: sha256(archive.bytes),
        bytes: archive.bytes.byteLength,
      });
      expect(kept).toMatchObject({ status: "read", retrieval: "kept_copy", sha256: downloaded.sha256, readAt: downloaded.readAt });
      expect(kept.sourceCheckedAt).toEqual(expect.any(String));
    }
  });

  it("keeps every field the parser reads from NHTSA's published header", async () => {
    const file = sample.files["2024"];
    const zip = new JSZip();
    zip.file(file.member, file.csv);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    stubNhtsa(new Map([[farsPuertoRicoArchiveUrl(2024), { bytes }]]));

    const read = await readFarsAnnualFile({ url: farsPuertoRicoArchiveUrl(2024), year: 2024, timing: QUICK });
    expect(read.ok).toBe(true);
    const keptCsv = read.ok ? read.csv : "";

    const fromFullTable = parseFarsAnnualCsv(file.csv, 2024, PUERTO_RICO_BBOX);
    expect(fromFullTable.records.length).toBeGreaterThan(0);
    expect(parseFarsAnnualCsv(keptCsv, 2024, PUERTO_RICO_BBOX)).toEqual(fromFullTable);
    expect(keptCsv.split("\n")[0].split(",").length).toBeLessThan(file.csv.split("\n")[0].split(",").length);
  });

  it("does not use a kept copy once NHTSA has replaced the file at the same URL", async () => {
    const served = await serveAllYears();
    const nhtsa = stubNhtsa(served);
    const { store } = memoryStore();
    await fetchFarsCrashes({ bbox: BBOX, years: [2024], keptFiles: store }, QUICK);

    // NHTSA republishes the 2024 annual file as the final file.
    served.set(farsAnnualArchiveUrl(2024), { bytes: await nationalArchive(2024), etag: '"final-release"' });
    const second = await fetchFarsCrashes({ bbox: BBOX, years: [2024], keptFiles: store }, QUICK);

    expect(nhtsa.downloads.get(farsAnnualArchiveUrl(2024))).toBe(2);
    expect(receipts(second)[0]).toMatchObject({ status: "read", retrieval: "source_download" });
  });
});

describe("a truncated or wrong-year file is refused, not parsed", () => {
  it("refuses a kept copy that no longer matches its recorded SHA-256 and reads NHTSA again", async () => {
    const served = await serveAllYears();
    const nhtsa = stubNhtsa(served);
    const { objects, store } = memoryStore();
    await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, QUICK);

    // Truncate the kept 2023 copy at a row boundary, so it would still parse:
    // header and two of five crashes.
    const manifest = manifestFor(objects, farsAnnualArchiveUrl(2023));
    const keptPath = String(manifest.extractPath);
    const kept = new TextDecoder().decode(objects.get(keptPath)!);
    objects.set(keptPath, new TextEncoder().encode(kept.split("\n").slice(0, 3).join("\n")));

    const second = await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, QUICK);

    expect(second.records.filter((record) => record.collisionYear === 2023)).toHaveLength(CRASHES_PER_YEAR);
    expect(nhtsa.downloads.get(farsAnnualArchiveUrl(2023))).toBe(2);
    expect(nhtsa.downloads.get(farsAnnualArchiveUrl(2024))).toBe(1);
    expect(receipts(second).find((receipt) => receipt.year === 2023)).toMatchObject({ retrieval: "source_download" });
    // The fresh read put a whole copy back.
    expect(sha256(objects.get(keptPath)!)).toBe(manifestFor(objects, farsAnnualArchiveUrl(2023)).extractSha256);
  });

  it("refuses a download shorter than NHTSA declared and keeps nothing for that year", async () => {
    const served = await serveAllYears();
    const whole = await nationalArchive(2023);
    served.set(farsAnnualArchiveUrl(2023), { bytes: whole.slice(0, Math.floor(whole.byteLength / 2)), declaredLength: whole.byteLength });
    stubNhtsa(served);
    const { objects, store } = memoryStore();

    const result = await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, QUICK);

    expect(receipts(result).find((receipt) => receipt.year === 2023)).toMatchObject({
      status: "failed",
      sha256: null,
      failure: `received ${Math.floor(whole.byteLength / 2)} of ${whole.byteLength} bytes`,
    });
    expect(result.yearsQueried).toEqual([2022, 2024]);
    expect(() => manifestFor(objects, farsAnnualArchiveUrl(2023))).toThrow(/nothing kept/);
  });

  it("refuses an archive whose accident table is for another year", async () => {
    const served = await serveAllYears();
    served.set(farsAnnualArchiveUrl(2024), { bytes: await nationalArchive(2024, 2023) });
    stubNhtsa(served);
    const { objects, store } = memoryStore();

    const result = await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, QUICK);

    expect(receipts(result).find((receipt) => receipt.year === 2024)).toMatchObject({
      status: "failed",
      failure: "the accident table holds 2023 crashes, not 2024",
    });
    expect(result.yearsQueried).toEqual([2022, 2023]);
    expect(result.records.filter((record) => record.collisionYear === 2023)).toHaveLength(CRASHES_PER_YEAR);
    expect(() => manifestFor(objects, farsAnnualArchiveUrl(2024))).toThrow(/nothing kept/);
  });

  it("refuses a kept copy whose rows are another year even when its hash was rewritten to match", async () => {
    const served = await serveAllYears();
    const nhtsa = stubNhtsa(served);
    const { objects, store } = memoryStore();
    await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, QUICK);

    // Put the 2023 copy under the 2024 manifest and record its hash there.
    const manifest2024 = manifestFor(objects, farsAnnualArchiveUrl(2024));
    const manifest2023 = manifestFor(objects, farsAnnualArchiveUrl(2023));
    const copied = objects.get(String(manifest2023.extractPath))!;
    objects.set(String(manifest2024.extractPath), copied);
    const manifestPath = [...objects.keys()].find(
      (path) => path.endsWith("/manifest.json") && manifestFor(new Map([[path, objects.get(path)!]]), farsAnnualArchiveUrl(2024))
    )!;
    objects.set(manifestPath, new TextEncoder().encode(JSON.stringify({ ...manifest2024, extractSha256: sha256(copied) })));

    const second = await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, QUICK);

    expect(nhtsa.downloads.get(farsAnnualArchiveUrl(2024))).toBe(2);
    expect(second.records.filter((record) => record.collisionYear === 2024)).toHaveLength(CRASHES_PER_YEAR);
  });
});

describe("a year that misses the deadline is failed, never zero", () => {
  it("reports the late year as failed, answers the others, and keeps the late file once it arrives", async () => {
    const served = await serveAllYears();
    const late = (served.get(farsAnnualArchiveUrl(2023)) as { bytes: Uint8Array }).bytes;
    served.set(farsAnnualArchiveUrl(2023), { delayMs: 600, bytes: late });
    const nhtsa = stubNhtsa(served);
    const { objects, store } = memoryStore();
    const timing: FarsFileTiming = { deadlineMs: 200, downloadLimitMs: 5_000, sourceCheckMs: 1_000, keepLimitMs: 1_000 };

    const result = await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, timing);

    expect(result.yearsQueried).toEqual([2022, 2024]);
    expect(result.records.some((record) => record.collisionYear === 2023)).toBe(false);
    expect(result.records).toHaveLength(CRASHES_PER_YEAR * 2);
    expect(receipts(result).find((receipt) => receipt.year === 2023)).toMatchObject({
      status: "failed",
      retrieval: null,
      failure: "NHTSA did not deliver the file within 0 s",
    });

    // The download keeps going after the acquisition stopped waiting, and the
    // next acquisition reads what it kept.
    await vi.waitFor(() => manifestFor(objects, farsAnnualArchiveUrl(2023)), { timeout: 3_000, interval: 50 });
    const next = await fetchFarsCrashes({ bbox: BBOX, years: YEARS, keptFiles: store }, timing);
    expect(next.yearsQueried).toEqual([2022, 2023, 2024]);
    expect(nhtsa.downloads.get(farsAnnualArchiveUrl(2023))).toBe(1);
  });

  it("fails every year, and says why, when no file arrives in time", async () => {
    stubNhtsa(new Map(YEARS.map((year) => [farsAnnualArchiveUrl(year), "hang" as const])));
    const timing: FarsFileTiming = { deadlineMs: 100, downloadLimitMs: 300, sourceCheckMs: 100, keepLimitMs: 100 };

    await expect(fetchFarsCrashes({ bbox: BBOX, years: YEARS }, timing)).rejects.toThrow(
      /no usable response for any published requested year \(2024: NHTSA did not deliver the file within 0 s; 2023: .*; 2022: .*\)/
    );
    // Let the abandoned downloads reach their limit before the next test.
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
});

describe("keeping a copy is optional and never fails a checked year", () => {
  /** A kept-file store whose extract and manifest uploads each take a set time. */
  function slowStore(extractMs: number, manifestMs: number) {
    const objects = new Map<string, Uint8Array>();
    const store: KeptSourceFileStore = {
      read: async (path) => objects.get(path)?.slice() ?? null,
      write: async (path, bytes) => {
        await new Promise((resolve) => setTimeout(resolve, path.endsWith("/manifest.json") ? manifestMs : extractMs));
        objects.set(path, bytes.slice());
        return true;
      },
    };
    return { objects, store };
  }
  const hasManifest = (objects: Map<string, Uint8Array>) => [...objects.keys()].some((path) => path.endsWith("/manifest.json"));

  it("returns the checked table when the download lands near the deadline and the uploads run past it", async () => {
    const url = "https://static.nhtsa.gov/test/keep-past-deadline/FARS2024NationalCSV.zip";
    stubNhtsa(new Map<string, Served>([[url, { delayMs: 150, bytes: await nationalArchive(2024) }]]));
    const { store } = slowStore(400, 400);
    const timing: FarsFileTiming = { deadlineMs: 300, downloadLimitMs: 5_000, sourceCheckMs: 100, keepLimitMs: 100 };

    const result = await readFarsAnnualFile({ url, year: 2024, keptFiles: store, timing });

    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({ status: "read", retrieval: "source_download", copyKept: false });
    expect(result.ok && result.csv.split("\n")).toHaveLength(CRASHES_PER_YEAR + 1);
  });

  it("writes no manifest after the upload's limit, so the next read downloads again", async () => {
    const url = "https://static.nhtsa.gov/test/keep-abandoned/FARS2024NationalCSV.zip";
    const nhtsa = stubNhtsa(new Map<string, Served>([[url, { bytes: await nationalArchive(2024) }]]));
    const { objects, store } = slowStore(250, 0);
    const timing: FarsFileTiming = { deadlineMs: 2_000, downloadLimitMs: 5_000, sourceCheckMs: 100, keepLimitMs: 100 };

    const first = await readFarsAnnualFile({ url, year: 2024, keptFiles: store, timing });
    expect(first.receipt).toMatchObject({ status: "read", copyKept: false });

    // The abandoned extract upload lands later; no manifest may follow it.
    await vi.waitFor(() => expect([...objects.keys()].some((path) => path.endsWith(".csv"))).toBe(true), { timeout: 2_000, interval: 25 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hasManifest(objects), "a manifest written after the limit").toBe(false);

    const second = await readFarsAnnualFile({ url, year: 2024, keptFiles: store, timing });
    expect(second.receipt).toMatchObject({ status: "read", retrieval: "source_download" });
    expect(nhtsa.downloads.get(url)).toBe(2);
  });

  it("records a copy kept within its limit, and reads it next time", async () => {
    const url = "https://static.nhtsa.gov/test/keep-in-time/FARS2024NationalCSV.zip";
    const nhtsa = stubNhtsa(new Map<string, Served>([[url, { bytes: await nationalArchive(2024) }]]));
    const { objects, store } = slowStore(20, 20);
    const timing: FarsFileTiming = { deadlineMs: 2_000, downloadLimitMs: 5_000, sourceCheckMs: 100, keepLimitMs: 1_000 };

    const first = await readFarsAnnualFile({ url, year: 2024, keptFiles: store, timing });
    expect(first.receipt).toMatchObject({ status: "read", retrieval: "source_download", copyKept: true });
    expect(hasManifest(objects)).toBe(true);

    const second = await readFarsAnnualFile({ url, year: 2024, keptFiles: store, timing });
    expect(second.receipt).toMatchObject({ status: "read", retrieval: "kept_copy" });
    expect(nhtsa.downloads.get(url)).toBe(1);
  });
});

describe("the Safety acquisition keeps FARS copies and records each file", () => {
  function storageService() {
    const uploads: Array<{ bucket: string; path: string }> = [];
    const objects = new Map<string, Uint8Array>();
    const updates: Record<string, unknown>[] = [];
    const upserts: Record<string, unknown>[] = [];
    const service = {
      storage: {
        from(bucket: string) {
          return {
            async download(path: string) {
              const bytes = objects.get(`${bucket}/${path}`);
              return bytes ? { data: new Blob([bytes.slice()]), error: null } : { data: null, error: { message: "Object not found" } };
            },
            async upload(path: string, bytes: Uint8Array) {
              uploads.push({ bucket, path });
              objects.set(`${bucket}/${path}`, bytes.slice());
              return { data: { path }, error: null };
            },
          };
        },
      },
      from(table: string) {
        if (table === "safety_crash_ingests") {
          return {
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: "ingest-fars-kept" }, error: null }) }) }),
            update: (row: Record<string, unknown>) => {
              updates.push(row);
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        return {
          upsert: (rows: Record<string, unknown>[]) => {
            upserts.push(...rows);
            return {
              select: async () => ({ data: rows.map((row, index) => ({ id: `crash-${index}`, external_id: row.external_id })), error: null }),
            };
          },
        };
      },
    };
    return { service, uploads, updates, upserts };
  }

  it("stores the answered years, records the failed one, and keeps copies in private Storage", async () => {
    const served = await serveAllYears();
    served.delete(farsAnnualArchiveUrl(2022));
    const nhtsa = stubNhtsa(served);
    const recorded = storageService();
    const params = {
      service: recorded.service as never,
      workspaceId: "workspace-1",
      bbox: BBOX,
      stateFips: ["32"],
      years: YEARS,
      includeParties: false,
    };

    const result = await ingestCrashesForStudyArea(params);

    expect(result.status).toBe("ready");
    expect(new Set(recorded.upserts.map((row) => row.collision_year))).toEqual(new Set([2023, 2024]));
    const finalized = recorded.updates.find((row) => row.status === "ready")!;
    const files = (finalized.published_through_provenance as { sourceFiles: CrashSourceFileReceipt[] }).sourceFiles;
    expect(files.map((file) => [file.year, file.status])).toEqual([[2024, "read"], [2023, "read"], [2022, "failed"]]);
    expect(files.find((file) => file.year === 2022)?.failure).toBe("NHTSA answered HTTP 404");
    expect(recorded.uploads.length).toBeGreaterThan(0);
    for (const upload of recorded.uploads) {
      expect(upload.bucket).toBe(KEPT_SOURCE_FILE_BUCKET);
      expect(upload.path.startsWith(`${KEPT_SOURCE_FILE_PREFIX}fars/`)).toBe(true);
    }

    await ingestCrashesForStudyArea(params);
    expect(nhtsa.downloads.get(farsAnnualArchiveUrl(2024))).toBe(1);
    expect(nhtsa.downloads.get(farsAnnualArchiveUrl(2023))).toBe(1);
  });
});
