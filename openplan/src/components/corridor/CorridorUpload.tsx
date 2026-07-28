"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import {
  type CorridorGeometry,
  validateCorridorGeometry,
} from "@/lib/geo/corridor-geometry";

type Feature = {
  type: "Feature";
  geometry: CorridorGeometry | null;
  properties?: Record<string, unknown>;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

type GeoJsonInput = CorridorGeometry | Feature | FeatureCollection;

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

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function isCorridorGeometry(value: unknown): value is CorridorGeometry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const geometry = value as { type?: string; coordinates?: unknown };
  const isSupportedType = geometry.type === "Polygon" || geometry.type === "MultiPolygon";

  return isSupportedType && Array.isArray(geometry.coordinates);
}

function extractCorridorGeometry(input: GeoJsonInput): CorridorGeometry | null {
  if (isCorridorGeometry(input)) {
    return input;
  }

  if (input.type === "Feature" && input.geometry && isCorridorGeometry(input.geometry)) {
    return input.geometry;
  }

  if (input.type === "FeatureCollection") {
    const firstGeometry = input.features
      .map((feature) => feature.geometry)
      .find((geometry) => geometry && isCorridorGeometry(geometry));

    if (firstGeometry && isCorridorGeometry(firstGeometry)) {
      return firstGeometry;
    }
  }

  return null;
}

export function CorridorUpload({ onUpload, isCurrentBoundary = true }: CorridorUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");

  const handleFile = async (file: File) => {
    setError("");

    if (file.size > MAX_FILE_BYTES) {
      setError("File must be 10MB or smaller.");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".geojson")) {
      setError("File must have a .geojson extension.");
      return;
    }

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as GeoJsonInput;
      const geometry = extractCorridorGeometry(parsed);

      if (!geometry) {
        setError("GeoJSON must contain a Polygon or MultiPolygon geometry.");
        return;
      }

      const validation = validateCorridorGeometry(geometry);
      if (!validation.ok) {
        setError(validation.issues[0] ?? "GeoJSON geometry failed validation.");
        return;
      }

      setFileName(file.name);
      onUpload(geometry);
    } catch {
      setError("Unable to parse the selected GeoJSON file.");
    }
  };

  return (
    <section className="analysis-studio-surface">
      <div className="analysis-studio-header">
        <div className="analysis-studio-heading">
          <p className="analysis-studio-label">Corridor geometry</p>
          <h3 className="analysis-studio-title">Upload a boundary file</h3>
          <p className="analysis-studio-description">Have the corridor as a Polygon or MultiPolygon GeoJSON already? Upload it and it becomes the study area, replacing whatever is currently set.</p>
        </div>
        <StatusBadge tone={fileName && isCurrentBoundary ? "success" : "neutral"}>
          {!fileName ? "Optional" : isCurrentBoundary ? "Boundary loaded" : "Not the current study area"}
        </StatusBadge>
      </div>

      <div className="analysis-studio-body">
        <Input
          ref={inputRef}
          type="file"
          accept=".geojson,application/geo+json,application/json"
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
            Select GeoJSON file
          </Button>
          <p className="analysis-studio-note">Polygon or MultiPolygon only, up to 10 MB.</p>
        </div>
        {fileName ? (
          <div className="analysis-studio-inline-meta">
            <p className="analysis-studio-inline-meta-label">
              {isCurrentBoundary ? "Loaded file" : "Last uploaded file"}
            </p>
            <p className="analysis-studio-inline-meta-value">{fileName}</p>
            {isCurrentBoundary ? null : (
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
