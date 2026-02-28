/**
 * Crash data fetcher
 *
 * Priority order:
 * 1) State/local crash CSV adapter when configured (e.g., SWITRS for California)
 * 2) FARS API (fatal-only, nationwide)
 * 3) Area-based estimate fallback
 */

import { readFile } from "node:fs/promises";

export interface CrashSummary {
  totalFatalCrashes: number;
  totalFatalities: number;
  pedestrianFatalities: number;
  bicyclistFatalities: number;
  severeInjuryCrashes: number;
  totalInjuryCrashes: number;
  yearsQueried: number[];
  crashesPerSquareMile: number;
  source: "switrs-local" | "fars-api" | "fars-estimate";
}

interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const SWITRS_CSV_PATH = process.env.SWITRS_CSV_PATH;

function bboxArea(bbox: BBox): number {
  const latMid = (bbox.minLat + bbox.maxLat) / 2;
  const latDist = Math.abs(bbox.maxLat - bbox.minLat) * 69.0;
  const lonDist = Math.abs(bbox.maxLon - bbox.minLon) * 69.0 * Math.cos((latMid * Math.PI) / 180);
  return Math.max(0.01, latDist * lonDist);
}

function isCaliforniaBBox(bbox: BBox): boolean {
  return bbox.minLon >= -125 && bbox.maxLon <= -114 && bbox.minLat >= 32 && bbox.maxLat <= 43;
}

function parseNum(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function splitCsvLine(line: string): string[] {
  // lightweight CSV split with quote handling
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchSwitrsFromCsv(bbox: BBox): Promise<CrashSummary | null> {
  if (!SWITRS_CSV_PATH || !isCaliforniaBBox(bbox)) return null;

  try {
    const text = await readFile(SWITRS_CSV_PATH, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;

    const header = splitCsvLine(lines[0]).map((h) => h.trim().toUpperCase());
    const idx = (name: string) => header.indexOf(name.toUpperCase());

    const latIdx = idx("LATITUDE");
    const lonIdx = idx("LONGITUDE");
    const yearIdx = idx("COLLISION_YEAR");
    const sevIdx = idx("COLLISION_SEVERITY");
    const fatalCntIdx = idx("COUNT_FATALITY");
    const injCntIdx = idx("COUNT_INJURED");
    const pedIdx = idx("PEDESTRIAN_ACCIDENT");
    const bikeIdx = idx("BICYCLE_ACCIDENT");

    if (latIdx < 0 || lonIdx < 0) return null;

    let totalFatalCrashes = 0;
    let totalFatalities = 0;
    let severeInjuryCrashes = 0;
    let totalInjuryCrashes = 0;
    let pedestrianFatalities = 0;
    let bicyclistFatalities = 0;
    const years = new Set<number>();

    for (let i = 1; i < lines.length; i += 1) {
      const cols = splitCsvLine(lines[i]);
      const lat = parseNum(cols[latIdx]);
      const lon = parseNum(cols[lonIdx]);
      if (!lat || !lon) continue;
      if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLon || lon > bbox.maxLon) continue;

      const year = parseNum(cols[yearIdx]);
      if (year) years.add(year);

      const severity = parseNum(cols[sevIdx]);
      const fatalCount = parseNum(cols[fatalCntIdx]);
      const injuryCount = parseNum(cols[injCntIdx]);
      const isPed = (cols[pedIdx] ?? "").toUpperCase() === "Y";
      const isBike = (cols[bikeIdx] ?? "").toUpperCase() === "Y";

      if (severity === 1 || fatalCount > 0) {
        totalFatalCrashes += 1;
        totalFatalities += Math.max(1, fatalCount);
        if (isPed) pedestrianFatalities += 1;
        if (isBike) bicyclistFatalities += 1;
      }

      // SWITRS severity coding commonly uses 2 for severe injury
      if (severity === 2) severeInjuryCrashes += 1;
      if (injuryCount > 0 || severity === 2 || severity === 3) totalInjuryCrashes += 1;
    }

    const yearsQueried = Array.from(years).sort();
    const area = bboxArea(bbox);
    const annualCrashBasis = yearsQueried.length > 0 ? yearsQueried.length : 1;

    return {
      totalFatalCrashes,
      totalFatalities,
      pedestrianFatalities,
      bicyclistFatalities,
      severeInjuryCrashes,
      totalInjuryCrashes,
      yearsQueried,
      crashesPerSquareMile: Math.round((totalInjuryCrashes / annualCrashBasis / area) * 10) / 10,
      source: "switrs-local",
    };
  } catch {
    return null;
  }
}

async function fetchFars(bbox: BBox): Promise<CrashSummary> {
  const years = [2022, 2021, 2020];
  let totalCrashes = 0;
  let totalFatalities = 0;
  let pedFatalities = 0;
  let bikeFatalities = 0;
  const queriedYears: number[] = [];

  for (const year of years) {
    try {
      const url =
        `https://crashviewer.nhtsa.dot.gov/CrashAPI/crashes/GetCrashesByLocation?` +
        `fromCaseYear=${year}&toCaseYear=${year}` +
        `&minLat=${bbox.minLat}&maxLat=${bbox.maxLat}` +
        `&minLong=${bbox.minLon}&maxLong=${bbox.maxLon}` +
        `&format=json`;

      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;

      const data = await resp.json();
      const results = data?.Results?.[0] || [];
      queriedYears.push(year);

      for (const crash of results) {
        totalCrashes += 1;
        totalFatalities += parseInt(crash.FATALS, 10) || 0;
        pedFatalities += parseInt(crash.PEDS, 10) || 0;
        bikeFatalities += parseInt(crash.BICYCLISTS, 10) || 0;
      }
    } catch {
      // ignore API failures per-year
    }
  }

  const area = bboxArea(bbox);

  if (queriedYears.length === 0) {
    const estCrashesPerYear = Math.round(area * 1.3);
    const estYears = 3;
    return {
      totalFatalCrashes: estCrashesPerYear * estYears,
      totalFatalities: Math.round(estCrashesPerYear * estYears * 1.1),
      pedestrianFatalities: Math.round(estCrashesPerYear * estYears * 0.17),
      bicyclistFatalities: Math.round(estCrashesPerYear * estYears * 0.02),
      severeInjuryCrashes: Math.round(estCrashesPerYear * estYears * 1.8),
      totalInjuryCrashes: Math.round(estCrashesPerYear * estYears * 4.5),
      yearsQueried: years,
      crashesPerSquareMile: Math.round((estCrashesPerYear / area) * 10) / 10,
      source: "fars-estimate",
    };
  }

  return {
    totalFatalCrashes: totalCrashes,
    totalFatalities,
    pedestrianFatalities: pedFatalities,
    bicyclistFatalities: bikeFatalities,
    severeInjuryCrashes: 0,
    totalInjuryCrashes: totalCrashes,
    yearsQueried: queriedYears,
    crashesPerSquareMile: Math.round((totalCrashes / queriedYears.length / area) * 10) / 10,
    source: "fars-api",
  };
}

export async function fetchCrashesForBbox(bbox: BBox): Promise<CrashSummary> {
  const switrs = await fetchSwitrsFromCsv(bbox);
  if (switrs) return switrs;
  return fetchFars(bbox);
}
