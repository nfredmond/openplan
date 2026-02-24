"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Position = [number, number] | [number, number, number];

type Polygon = {
  type: "Polygon";
  coordinates: Position[][];
};

type MultiPolygon = {
  type: "MultiPolygon";
  coordinates: Position[][][];
};

type CorridorGeometry = Polygon | MultiPolygon;

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

      setFileName(file.name);
      onUpload(geometry);
    } catch {
      setError("Unable to parse the selected GeoJSON file.");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Corridor Upload</CardTitle>
        <CardDescription>Upload a Polygon or MultiPolygon `.geojson` corridor file.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
          Upload .geojson
        </Button>
        {fileName ? <p className="text-xs text-muted-foreground">Loaded: {fileName}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
