"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import {
  type CorridorGeometry,
  type CorridorPosition,
  validateCorridorGeometry,
} from "@/lib/geo/corridor-geometry";
import { importSpatialFileAsync } from "@/lib/geo/spatial-file-import";

/**
 * The corridor boundary upload.
 *
 * FORMAT KNOWLEDGE LIVES IN ONE PLACE. This card does not parse files itself:
 * `src/lib/geo/spatial-file-import.ts` — the same core the engagement module
 * uses for context layers — reads GeoJSON, KML, KMZ, and zipped shapefiles,
 * establishes the coordinate system from evidence, and refuses what it cannot
 * prove it understands, with a message that names the next step. What this file
 * adds is only the corridor-shaped decision: a study area is ONE area boundary,
 * so the parsed features have to become a single Polygon or MultiPolygon.
 *
 * THE MULTI-FEATURE DECISION, AND ITS DISCLOSURE. A file can legitimately carry
 * several areas (a corridor exported as segments, a district in pieces). All of
 * them are combined into one MultiPolygon boundary — refusing would strand a
 * perfectly good export, and silently taking the first area (what this card
 * once did) is a quiet claim that the file said something it did not. The
 * combination is SAID, in the card, every time it happens; so is every shape
 * that was in the file and not used (points, lines). A boundary a planner
 * believes is their whole file must not quietly be a third of it.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type CorridorPolygonal = Extract<GeoJSON.Geometry, { type: "Polygon" | "MultiPolygon" }>;

export type CorridorBoundaryRead =
  | {
      ok: true;
      geometry: CorridorGeometry;
      /** Disclosures the planner is owed: combined areas, unused shapes. Empty
       * when the file was exactly one area boundary. */
      notices: string[];
    }
  | { ok: false; message: string };

/**
 * Read an uploaded file into one corridor boundary.
 *
 * Exported so tests exercise the same code path the change handler runs; the
 * component adds only state wiring around this.
 */
export async function readCorridorBoundaryFile(filename: string, bytes: Uint8Array): Promise<CorridorBoundaryRead> {
  const imported = await importSpatialFileAsync({ filename, bytes, featureCap: null });
  if (!imported.ok) {
    return { ok: false, message: imported.message };
  }

  const areas: CorridorPolygonal[] = [];
  let nonAreaCount = 0;
  for (const feature of imported.featureCollection.features) {
    const geometry = feature.geometry;
    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      areas.push(geometry);
    } else {
      nonAreaCount += 1;
    }
  }

  if (areas.length === 0) {
    return {
      ok: false,
      message:
        "This file contains no area (polygon) shapes, so it cannot set a study boundary — a corridor boundary " +
        "must be an area, not points or lines. Export the corridor as a polygon layer and upload it again.",
    };
  }

  let geometry: CorridorGeometry;
  const notices: string[] = [];

  if (areas.length === 1) {
    geometry = areas[0] as CorridorGeometry;
  } else {
    // Combined, not dissolved: every area's rings become parts of one
    // MultiPolygon. Nothing is merged, moved, or simplified — and the planner
    // is told the boundary is a combination, not a single drawn shape.
    const parts: CorridorPosition[][][] = [];
    for (const area of areas) {
      if (area.type === "Polygon") {
        parts.push(area.coordinates as CorridorPosition[][]);
      } else {
        parts.push(...(area.coordinates as CorridorPosition[][][]));
      }
    }
    geometry = { type: "MultiPolygon", coordinates: parts };
    notices.push(
      `This file contains ${areas.length} separate areas; all of them were combined into one study boundary.`
    );
  }

  if (nonAreaCount > 0) {
    notices.push(
      `${nonAreaCount} ${nonAreaCount === 1 ? "shape" : "shapes"} in this file ${
        nonAreaCount === 1 ? "is a point or line" : "are points or lines"
      } and cannot form a boundary, so ${nonAreaCount === 1 ? "it was" : "they were"} not used.`
    );
  }
  if (imported.droppedFeatureCount > 0) {
    notices.push(
      `${imported.droppedFeatureCount} ${imported.droppedFeatureCount === 1 ? "shape" : "shapes"} in this file ` +
        "could not be read and " +
        `${imported.droppedFeatureCount === 1 ? "was" : "were"} not used.`
    );
  }

  const validation = validateCorridorGeometry(geometry);
  if (!validation.ok) {
    return { ok: false, message: validation.issues[0] ?? "The boundary in this file failed validation." };
  }

  return { ok: true, geometry, notices };
}

type CorridorUploadProps = {
  onUpload: (geojson: CorridorGeometry) => void;
  /**
   * Whether the last uploaded file is still the study area.
   *
   * The upload is no longer the only way to set one — a place picked from
   * search, an area drawn on the map, or a reloaded run all write the same
   * boundary. When one of those replaces (or clears) the upload, this card must
   * stop reporting the file as the loaded boundary; the file is then history.
   * Defaults to true, which is the truth for a caller where upload is the only
   * input.
   */
  isCurrentBoundary?: boolean;
};

export function CorridorUpload({ onUpload, isCurrentBoundary = true }: CorridorUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [notices, setNotices] = useState<string[]>([]);

  const handleFile = async (file: File) => {
    setError("");
    setNotices([]);

    if (file.size > MAX_FILE_BYTES) {
      setError("File must be 10MB or smaller.");
      return;
    }

    let read: CorridorBoundaryRead;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      read = await readCorridorBoundaryFile(file.name, bytes);
    } catch {
      setError("This file could not be read. Try re-exporting it from your GIS and uploading it again.");
      return;
    }

    if (!read.ok) {
      setError(read.message);
      return;
    }

    setFileName(file.name);
    setNotices(read.notices);
    onUpload(read.geometry);
  };

  return (
    <section className="analysis-studio-surface">
      <div className="analysis-studio-header">
        <div className="analysis-studio-heading">
          <p className="analysis-studio-label">Corridor geometry</p>
          <h3 className="analysis-studio-title">Upload a boundary file</h3>
          <p className="analysis-studio-description">Have the corridor boundary as a GIS file already? Upload it — GeoJSON, KML, KMZ, or a zipped shapefile — and its area becomes the study area, replacing whatever is currently set.</p>
        </div>
        <StatusBadge tone={fileName && isCurrentBoundary ? "success" : "neutral"}>
          {!fileName ? "Optional" : isCurrentBoundary ? "Boundary loaded" : "Not the current study area"}
        </StatusBadge>
      </div>

      <div className="analysis-studio-body">
        <Input
          ref={inputRef}
          type="file"
          accept=".geojson,.json,.kml,.kmz,.zip,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
            // Clear the input so re-selecting the SAME file fires change again.
            // Without this, a planner who picked a place after uploading could
            // not get back to their file by choosing it a second time.
            event.target.value = "";
          }}
        />
        <div className="analysis-studio-toolbar">
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
            Select boundary file
          </Button>
          <p className="analysis-studio-note">GeoJSON (.geojson/.json), KML, KMZ, or zipped shapefile with an area boundary, up to 10 MB.</p>
        </div>
        {fileName ? (
          <div className="analysis-studio-inline-meta">
            <p className="analysis-studio-inline-meta-label">
              {isCurrentBoundary ? "Loaded file" : "Last uploaded file"}
            </p>
            <p className="analysis-studio-inline-meta-value">{fileName}</p>
            {isCurrentBoundary
              ? notices.map((notice) => (
                  <p key={notice} className="analysis-studio-note">
                    {notice}
                  </p>
                ))
              : (
                  <p className="analysis-studio-note">
                    The study area now comes from somewhere else. Upload again to go back to this file.
                  </p>
                )}
          </div>
        ) : null}
        {error ? <ErrorState compact title="Upload issue" description={error} /> : null}
      </div>
    </section>
  );
}
