"use client";

import { useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importSpatialFileAsync } from "@/lib/geo/spatial-file-import";
import { CORRIDOR_MAX_VERTICES } from "@/lib/cartographic/corridor-vocabulary";

/**
 * Taking a line or a single position out of a file the planner already has.
 *
 * FORMAT KNOWLEDGE STAYS IN ONE PLACE. Nothing here parses a file.
 * `src/lib/geo/spatial-file-import.ts` — the same core the engagement context
 * layers, the corridor boundary card and the workspace GIS wizard read through
 * — handles GeoJSON, KML, KMZ and zipped shapefiles, establishes the coordinate
 * system from evidence, and refuses what it cannot prove it understands. What
 * this file adds is only the two project-shaped decisions the importer cannot
 * make for anyone: a study corridor is ONE line, and a map pin is ONE position.
 *
 * WHY NOT `CorridorUpload`. That card is the third caller of the same importer
 * and it is not general: its whole job is the AREA decision ("a study area is
 * one area boundary"), and it refuses, by design and with a good sentence, any
 * file whose shapes are points or lines. Both controls here need exactly what
 * it refuses. Mounting it would have meant loosening a refusal another surface
 * depends on; this is the sibling decision layer, over the same reader.
 *
 * A FILE CONFERS NO PLACE IDENTITY. A line or a pin read from a file is stored
 * by exactly the same request as one drawn by hand, with no extra field, and
 * every sentence below is careful not to suggest the file told OpenPlan where
 * in the world this is. It did not. It gave a shape.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Position = [number, number];

/** What a caller asked the file for. */
export type ProjectShapeKind = "line" | "point";

export type ProjectShapeFromFile =
  | { kind: "line"; coordinates: Position[]; fileName: string; notes: string[] }
  | { kind: "point"; longitude: number; latitude: number; fileName: string; notes: string[] };

type ShapeFileRead = { ok: true; shape: ProjectShapeFromFile } | { ok: false; message: string };

/** Round to ~1 cm, matching what the panel stores, so joins compare honestly. */
function round(value: number): number {
  return Number(value.toFixed(6));
}

function endpointKey(position: Position): string {
  return `${round(position[0])},${round(position[1])}`;
}

function countedShapes(count: number): string {
  return count === 1 ? "1 shape" : `${count} shapes`;
}

type SortedShapes = {
  lines: Position[][];
  points: Position[];
  areaCount: number;
  unusableLineCount: number;
};

function sortShapes(features: readonly { geometry: GeoJSON.Geometry }[]): SortedShapes {
  const lines: Position[][] = [];
  const points: Position[] = [];
  let areaCount = 0;
  let unusableLineCount = 0;

  const takeLine = (coordinates: GeoJSON.Position[]) => {
    // A one-position line is not a line. It is counted, never quietly padded.
    if (coordinates.length < 2) {
      unusableLineCount += 1;
      return;
    }
    lines.push(coordinates.map((position) => [position[0], position[1]] as Position));
  };

  for (const feature of features) {
    const geometry = feature.geometry;
    switch (geometry.type) {
      case "LineString":
        takeLine(geometry.coordinates);
        break;
      case "MultiLineString":
        for (const part of geometry.coordinates) takeLine(part);
        break;
      case "Point":
        points.push([geometry.coordinates[0], geometry.coordinates[1]]);
        break;
      case "MultiPoint":
        for (const part of geometry.coordinates) points.push([part[0], part[1]]);
        break;
      case "Polygon":
      case "MultiPolygon":
        areaCount += 1;
        break;
      default:
        break;
    }
  }

  return { lines, points, areaCount, unusableLineCount };
}

/**
 * Join separate lines into one, ONLY where their ends actually meet.
 *
 * A corridor exported from a GIS is very often a row per block, and refusing
 * every one of those would make this control useless for the commonest real
 * file. But concatenating them in file order draws a zig-zag through the town:
 * the rows are not in travel order and half of them are digitised backwards.
 *
 * So the join is by matching endpoints or not at all. Every end must meet at
 * most one other end, exactly two ends must be free, and the walk from one free
 * end must reach every piece. Anything else — a branching network, a loop, two
 * corridors in one file — is refused and named, because there is no single line
 * in that file and picking one would be OpenPlan deciding what the planner
 * meant.
 */
function joinLines(lines: Position[][]): { ok: true; coordinates: Position[] } | { ok: false; message: string } {
  if (lines.length === 1) return { ok: true, coordinates: lines[0] };

  const endsAt = new Map<string, { line: number; atStart: boolean }[]>();
  for (const [index, line] of lines.entries()) {
    for (const atStart of [true, false]) {
      const key = endpointKey(atStart ? line[0] : line[line.length - 1]);
      const existing = endsAt.get(key) ?? [];
      existing.push({ line: index, atStart });
      endsAt.set(key, existing);
    }
  }

  const disconnected =
    `This file holds ${lines.length} separate lines whose ends do not meet, so there is no single ` +
    "corridor in it to save. One corridor is one continuous line. Join the pieces in your mapping " +
    "software, or upload one line at a time.";

  for (const ends of endsAt.values()) {
    if (ends.length > 2) {
      return {
        ok: false,
        message:
          "The lines in this file branch, so they are a small network rather than one corridor. " +
          "Upload the single route you want to show, or draw it on the map.",
      };
    }
  }

  const freeEnds = [...endsAt.values()].filter((ends) => ends.length === 1);
  if (freeEnds.length !== 2) return { ok: false, message: disconnected };

  const start = freeEnds[0][0];
  const visited = new Set<number>([start.line]);
  const first = lines[start.line];
  const coordinates: Position[] = start.atStart ? [...first] : [...first].reverse();

  for (;;) {
    const key = endpointKey(coordinates[coordinates.length - 1]);
    const next = (endsAt.get(key) ?? []).find((end) => !visited.has(end.line));
    if (!next) break;
    visited.add(next.line);
    const piece = lines[next.line];
    const ordered = next.atStart ? [...piece] : [...piece].reverse();
    // Drop the shared position so the joint is not stored twice.
    coordinates.push(...ordered.slice(1));
  }

  if (visited.size !== lines.length) return { ok: false, message: disconnected };
  return { ok: true, coordinates };
}

/** The middle of the box around a shape — said in those words wherever used. */
function boxCenter(positions: Position[]): Position {
  let minLng = positions[0][0];
  let maxLng = positions[0][0];
  let minLat = positions[0][1];
  let maxLat = positions[0][1];
  for (const [lng, lat] of positions) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [round((minLng + maxLng) / 2), round((minLat + maxLat) / 2)];
}

function flatten(geometry: GeoJSON.Geometry): Position[] {
  const positions: Position[] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      positions.push([value[0] as number, value[1] as number]);
      return;
    }
    for (const child of value) walk(child);
  };
  if ("coordinates" in geometry) walk(geometry.coordinates);
  return positions;
}

async function readShapeFile(
  wants: ProjectShapeKind,
  fileName: string,
  bytes: Uint8Array
): Promise<ShapeFileRead> {
  const imported = await importSpatialFileAsync({ filename: fileName, bytes, featureCap: null });
  if (!imported.ok) return { ok: false, message: imported.message };

  const features = imported.featureCollection.features;
  const sorted = sortShapes(features);
  const notes: string[] = [];
  if (imported.droppedFeatureCount > 0) {
    notes.push(
      `${countedShapes(imported.droppedFeatureCount)} in this file could not be read, so ` +
        `${imported.droppedFeatureCount === 1 ? "it was" : "they were"} left out.`
    );
  }

  if (wants === "line") {
    if (sorted.unusableLineCount > 0) {
      notes.push(
        `${countedShapes(sorted.unusableLineCount)} in this file had only one point, so ` +
          `${sorted.unusableLineCount === 1 ? "it was" : "they were"} left out.`
      );
    }
    if (sorted.lines.length === 0) {
      return {
        ok: false,
        message:
          sorted.areaCount > 0
            ? "This file holds areas, not lines. A corridor is a line along a street or a route, so " +
              "save the route as lines in your mapping software and upload it again."
            : "This file holds no lines, so there is no corridor in it to save. A corridor is a line " +
              "along a street or a route.",
      };
    }

    const joined = joinLines(sorted.lines);
    if (!joined.ok) return { ok: false, message: joined.message };
    if (joined.coordinates.length > CORRIDOR_MAX_VERTICES) {
      return {
        ok: false,
        message:
          `This line has ${joined.coordinates.length} points, and a corridor here can hold ` +
          `${CORRIDOR_MAX_VERTICES}. These lines are for showing on a map, not for running a model, ` +
          "so simplify the line in your mapping software and upload it again.",
      };
    }
    if (sorted.lines.length > 1) {
      notes.push(
        `The ${sorted.lines.length} pieces in this file were joined end to end into one line, in the ` +
          "order their ends meet."
      );
    }
    const leftOver = sorted.points.length + sorted.areaCount;
    if (leftOver > 0) {
      notes.push(
        `${countedShapes(leftOver)} in this file ${leftOver === 1 ? "is" : "are"} not a line, so ` +
          `${leftOver === 1 ? "it was" : "they were"} left out.`
      );
    }
    return { ok: true, shape: { kind: "line", coordinates: joined.coordinates, fileName, notes } };
  }

  if (sorted.points.length > 1) {
    return {
      ok: false,
      message:
        `This file holds ${sorted.points.length} points, and a project sits at one spot on the map. ` +
        "OpenPlan will not choose one of them for you. Upload a file with a single point, or click " +
        "the map.",
    };
  }

  if (sorted.points.length === 1) {
    const leftOver = sorted.lines.length + sorted.areaCount;
    if (leftOver > 0) {
      notes.push(
        `${countedShapes(leftOver)} in this file ${leftOver === 1 ? "is" : "are"} not a point, so ` +
          `${leftOver === 1 ? "it was" : "they were"} left out.`
      );
    }
    const [longitude, latitude] = sorted.points[0];
    return {
      ok: true,
      shape: { kind: "point", longitude: round(longitude), latitude: round(latitude), fileName, notes },
    };
  }

  // No point in the file. One shape can still say where to put the pin — but
  // only if OpenPlan says out loud that it worked the spot out rather than read
  // it, and only for ONE shape. Taking the first of several would be a coin
  // toss dressed up as an answer.
  const drawable = features.filter(
    (feature) => feature.geometry.type !== "GeometryCollection" && flatten(feature.geometry).length > 0
  );
  if (drawable.length !== 1) {
    return {
      ok: false,
      message:
        (drawable.length === 0
          ? "This file holds nothing OpenPlan could read a spot from. "
          : `This file holds ${countedShapes(drawable.length)} and no single point, so OpenPlan cannot ` +
            "tell which spot you mean. ") + "Upload a file with one point in it, or click the map.",
    };
  }

  const positions = flatten(drawable[0].geometry);
  const [longitude, latitude] = boxCenter(positions);
  notes.push(
    "This file holds a shape rather than a point, so the pin was put in the middle of the box " +
      "around that shape. Check it before you save — it may not be where you mean."
  );
  return { ok: true, shape: { kind: "point", longitude, latitude, fileName, notes } };
}

/**
 * The control itself: a button, a hidden file chooser, and whatever the file
 * turned out to say. Unframed on purpose — it sits inside a section that is
 * already a frame, and the interface standard spends its third frame on the
 * item, not on this.
 */
export function ProjectShapeFileInput({
  wants,
  label,
  hint,
  onShape,
  disabled = false,
}: {
  wants: ProjectShapeKind;
  /** What the button says. */
  label: string;
  /** One line under the button, in the caller's own words. */
  hint: string;
  onShape: (shape: ProjectShapeFromFile) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("This file is larger than 10 MB. Save a smaller one and try again.");
      return;
    }

    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const read = await readShapeFile(wants, file.name, bytes);
      if (!read.ok) {
        setError(read.message);
        return;
      }
      onShape(read.shape);
    } catch {
      setError("This file could not be read. Save it again from your mapping software and try once more.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        // Two of these can be on one page. The label a screen reader hears —
        // and the one a test picks by — has to say WHICH of the two it is.
        aria-label={`${label} for ${wants === "line" ? "the corridor" : "the project location"}`}
        accept=".geojson,.json,.kml,.kmz,.zip,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/zip"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          // Clear it so choosing the SAME file again still counts as a change.
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || reading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          {label}
        </Button>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
