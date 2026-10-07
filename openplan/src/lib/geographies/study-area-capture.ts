import { z } from "zod";
import { placeKindSchema, type PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { validateCorridorGeometry } from "@/lib/geo/corridor-geometry";
import { corridorGeojsonSchema } from "@/lib/models/run-launch";
import { bboxOfGeometry, DRAWN_PLACE_SOURCE, UPLOADED_PLACE_SOURCE, type PlaceOfRecord } from "./place-of-record";
import { subdivisionCodeFromTigerwebGeoid, TIGERWEB_GEOGRAPHY_SOURCE } from "@/lib/workspaces/home-geography";

export const studyAreaGeometrySchema = corridorGeojsonSchema.refine(value => validateCorridorGeometry(value).ok, "Use a closed WGS84 polygon or multipolygon");

const label = z.string().trim().min(1).max(240);
export const studyAreaCaptureSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("place"), kind: placeKindSchema, geoid: z.string().trim().min(5).max(7), label }).strict(),
  z.object({ mode: z.literal("drawn"), geometry: studyAreaGeometrySchema, label }).strict(),
  z.object({ mode: z.literal("uploaded"), geometry: studyAreaGeometrySchema, label }).strict(),
]);
export type StudyAreaCapture = z.infer<typeof studyAreaCaptureSchema>;

/** Only a server-resolved boundary may carry resolver identity and jurisdiction codes. */
export function placeOfRecordFromBoundary(boundary: PlaceBoundaryResponse, label: string): PlaceOfRecord {
  return { source: TIGERWEB_GEOGRAPHY_SOURCE, kind: boundary.kind, ref: boundary.geoid, label,
    countryCode: "US", subdivisionCode: subdivisionCodeFromTigerwebGeoid(boundary.kind, boundary.geoid),
    bbox: structuredClone(boundary.bbox), geometry: structuredClone(boundary.geojson) };
}

/** Drawn and uploaded geometry preserves its capture path without inventing identity. */
export function placeOfRecordFromCapturedArea(capture: Exclude<StudyAreaCapture, { mode: "place" }>): PlaceOfRecord | null {
  const bbox = bboxOfGeometry(capture.geometry);
  if (!bbox) return null;
  return { source: capture.mode === "drawn" ? DRAWN_PLACE_SOURCE : UPLOADED_PLACE_SOURCE,
    kind: null, ref: null, label: capture.label, countryCode: null, subdivisionCode: null,
    bbox, geometry: structuredClone(capture.geometry) };
}
