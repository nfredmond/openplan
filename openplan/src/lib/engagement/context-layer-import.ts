/**
 * Reading an operator's GIS file into a participant-drawable layer.
 *
 * THE FORMAT KNOWLEDGE DOES NOT LIVE HERE ANY MORE. Detection, parsing, CRS
 * evidence, and the honest refusal vocabulary for GeoJSON / KML / KMZ / zipped
 * shapefiles were extracted to `src/lib/geo/spatial-file-import.ts` (2026-08-10)
 * so that every OpenPlan surface accepting a GIS file reads it through the same
 * code — a format bug can then exist in exactly one place. That module's header
 * carries the full reasoning (the coordinate-reference-system rule, the WGS84
 * second net, the MultiPatch hazard); read it there.
 *
 * What THIS module is: the engagement-side, NODE-ONLY entry point. It binds the
 * environment-neutral core to node's synchronous `zlib.inflateRawSync` — the
 * one step of the import that differs between node and a browser — and keeps
 * the names the engagement lane has always imported (`importContextLayer`,
 * `readPrj`, the `ContextLayer*` types). The types and the query that client
 * code needs live in `context-layers.ts`, as before.
 */

import { inflateRawSync } from "node:zlib";

import {
  detectSpatialFileFormat,
  importSpatialFile,
  readPrj,
  type InflateRawSync,
  type SpatialFileImportRefusalReason,
} from "@/lib/geo/spatial-file-import";
import type {
  ContextLayerFeatureCollection,
  ContextLayerFormat,
  ContextLayerGeometryKind,
  ContextLayerSrs,
} from "./context-layers";

// ── Result contract (engagement vocabulary, unchanged) ───────────────────────

export type ContextLayerImportRefusalReason = SpatialFileImportRefusalReason;

export type ContextLayerImportRefusal = {
  ok: false;
  reason: ContextLayerImportRefusalReason;
  /** Shown to the planner. Always names the real cause and the next step. */
  message: string;
};

export type ContextLayerImport = {
  ok: true;
  format: ContextLayerFormat;
  srs: ContextLayerSrs;
  featureCollection: ContextLayerFeatureCollection;
  geometryKinds: ContextLayerGeometryKind[];
  /** Shapes stored — one GeoJSON Feature each, which is what the map draws. */
  featureCount: number;
  /** Every shape the file yielded, before the cap and before drops. Counted in
   * SHAPES, not source features — see the core module for why. */
  sourceFeatureCount: number;
  /** Shapes present in the file that are not on the map. */
  droppedFeatureCount: number;
  truncated: boolean;
  bbox: [number, number, number, number] | null;
};

export type ContextLayerImportResult = ContextLayerImport | ContextLayerImportRefusal;

export type ContextLayerImportInput = {
  filename: string;
  bytes: Uint8Array;
  /** Most features to store, or null for unlimited (operator configuration). */
  featureCap: number | null;
};

// ── The node binding ─────────────────────────────────────────────────────────

/**
 * Node's inflate, held to the byte count the archive itself declares — the
 * zip-bomb bound the core's contract requires. `maxOutputLength` must be at
 * least 1, and a legal zero-byte entry would otherwise be refused as damaged.
 */
const nodeInflateRaw: InflateRawSync = (compressed, declaredByteLength) =>
  new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.max(declaredByteLength, 1) }));

export function importContextLayer(input: ContextLayerImportInput): ContextLayerImportResult {
  return importSpatialFile(input, nodeInflateRaw);
}

export { readPrj };
export { detectSpatialFileFormat as detectContextLayerFormat };
