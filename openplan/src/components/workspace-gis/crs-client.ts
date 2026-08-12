/**
 * The browser's half of the coordinate-system registry.
 *
 * ═══ WHY THIS DOES NOT IMPORT `@/lib/geo/crs` ═══
 *
 * That barrel re-exports the registry — `crs-registry.generated.ts`, well over a
 * megabyte of generated rows — and a client component importing it ships all of
 * it to every browser that opens the upload wizard. So this module imports only
 * the two registry-free pieces (`reproject`, `area-of-use`), takes ENTRIES over
 * HTTP, and builds the importer's `SpatialFileCrs` here.
 *
 * `spatialFileCrsFor` in the barrel does exactly what `crsFor` below does, and
 * the duplication is deliberate rather than an oversight: importing the barrel
 * for that one four-line function is what would pull the registry in. If the
 * barrel is ever split so that the function can be reached without the data,
 * this should collapse back into it — `src/test/the-crs-picker-records-an-assertion.test.ts`
 * asserts the two agree on a real entry, so the copy cannot drift silently.
 */

import { reprojectPosition } from "@/lib/geo/crs/reproject";
import type { CrsRegistryEntry } from "@/lib/geo/crs/types";
import type { SpatialFileCrs } from "@/lib/geo/spatial-file-import";
import type {
  CrsIdentifyResponse,
  CrsPickerResponse,
} from "@/lib/cartographic/crs-http-types";

/** Bind a registry entry to the arithmetic the shared importer consumes. */
export function crsFor(entry: CrsRegistryEntry): SpatialFileCrs {
  return {
    authority: entry.authority,
    code: entry.code,
    name: entry.name,
    unit: entry.unit,
    kind: entry.kind,
    datumNote: entry.datumShiftNote,
    toLngLat: (x, y) => reprojectPosition(entry, x, y),
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin" });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok && typeof payload.error === "string") {
    throw new Error(payload.error);
  }
  return payload as T;
}

/**
 * Systems whose area of use covers the planner's region.
 *
 * The region is the workspace's home geography. With none, the response comes
 * back flagged `unscoped` and the wizard says so — a list of every system
 * OpenPlan carries is not a shortlist, and presenting it as one would invite a
 * planner to pick the first plausible-looking row.
 */
export async function fetchCrsOptions(
  region: [number, number, number, number] | null
): Promise<CrsPickerResponse> {
  const query = region ? `?bbox=${region.join(",")}` : "";
  return getJson<CrsPickerResponse>(`/api/geo/crs${query}`);
}

/** One system in full, including its projection parameters. */
export async function fetchCrsByCode(authorityCode: string): Promise<CrsIdentifyResponse> {
  return getJson<CrsIdentifyResponse>(`/api/geo/crs?code=${encodeURIComponent(authorityCode)}`);
}

/**
 * What the file's own `.prj` names.
 *
 * THE SERVER ANSWERS THIS, ALWAYS. The browser holds the .prj text and could
 * parse it, and must not: which system a file is in decides where every shape
 * lands, and this repository's rule is that the server owns that call. The
 * ingest route resolves it a second time from the same text, so the record can
 * never say something this preview talked the browser into.
 */
export async function identifyCrsFromPrjText(prjText: string): Promise<CrsIdentifyResponse> {
  const response = await fetch("/api/geo/crs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prjText }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok && typeof payload.error === "string") {
    throw new Error(payload.error);
  }
  return payload as unknown as CrsIdentifyResponse;
}
