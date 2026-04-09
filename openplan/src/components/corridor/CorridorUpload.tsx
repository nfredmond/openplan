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

export function CorridorUpload({ onUpload }: CorridorUploadProps) {
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
          <h3 className="analysis-studio-title">Load the analysis boundary</h3>
          <p className="analysis-studio-description">Upload a Polygon or MultiPolygon GeoJSON file to define the corridor footprint for this run.</p>
        </div>
        <StatusBadge tone={fileName ? "success" : "neutral"}>{fileName ? "Boundary loaded" : "Awaiting file"}</StatusBadge>
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
            <p className="analysis-studio-inline-meta-label">Loaded file</p>
            <p className="analysis-studio-inline-meta-value">{fileName}</p>
          </div>
        ) : null}
        {error ? <ErrorState compact title="Upload issue" description={error} /> : null}
      </div>
    </section>
  );
}
