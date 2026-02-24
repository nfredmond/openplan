"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBoundsLike, Map } from "maplibre-gl";
import { CorridorUpload } from "@/components/corridor/CorridorUpload";
import { RunHistory } from "@/components/runs/RunHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

type AnalysisResult = {
  runId: string;
  metrics: {
    accessibilityScore: number;
    safetyScore: number;
    equityScore: number;
    overallScore?: number;
    confidence?: string;
    totalTransitStops?: number;
    transitAccessTier?: string;
    dataQuality?: {
      censusAvailable?: boolean;
      crashDataAvailable?: boolean;
      lodesSource?: string;
      equitySource?: string;
    };
    [key: string]: unknown;
  };
  geojson: GeoJSON.FeatureCollection;
  summary: string;
  aiInterpretation?: string;
  aiInterpretationSource?: string;
};

function collectPositions(geometry: CorridorGeometry): Position[] {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat();
  }

  return geometry.coordinates.flat(2);
}

function getBoundsFromGeometry(geometry: CorridorGeometry): LngLatBoundsLike | null {
  const positions = collectPositions(geometry);

  if (!positions.length) {
    return null;
  }

  let minLng = positions[0][0];
  let minLat = positions[0][1];
  let maxLng = positions[0][0];
  let maxLat = positions[0][1];

  positions.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  });

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export default function ExplorePage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  const [workspaceId, setWorkspaceId] = useState("");
  const [queryText, setQueryText] = useState("");
  const [corridorGeojson, setCorridorGeojson] = useState<CorridorGeometry | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [-96, 38],
      zoom: 3,
    });

    map.on("load", () => {
      map.addSource("analysis-result", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "analysis-fill",
        type: "fill",
        source: "analysis-result",
        paint: {
          "fill-color": "#0f766e",
          "fill-opacity": 0.3,
        },
        filter: ["==", ["geometry-type"], "Polygon"],
      });

      map.addLayer({
        id: "analysis-outline",
        type: "line",
        source: "analysis-result",
        paint: {
          "line-color": "#115e59",
          "line-width": 2,
        },
      });

      map.addLayer({
        id: "analysis-points",
        type: "circle",
        source: "analysis-result",
        paint: {
          "circle-radius": 6,
          "circle-color": "#be123c",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
        filter: ["==", ["geometry-type"], "Point"],
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!analysisResult || !mapRef.current) {
      return;
    }

    const source = mapRef.current.getSource("analysis-result") as
      | maplibregl.GeoJSONSource
      | undefined;

    if (source) {
      source.setData(analysisResult.geojson);
    }

    if (corridorGeojson) {
      const bounds = getBoundsFromGeometry(corridorGeojson);
      if (bounds) {
        mapRef.current.fitBounds(bounds, { padding: 40, duration: 450 });
      }
    }
  }, [analysisResult, corridorGeojson]);

  const canSubmit = useMemo(() => {
    return Boolean(workspaceId && queryText.trim().length > 0 && corridorGeojson);
  }, [workspaceId, queryText, corridorGeojson]);

  const runAnalysis = async () => {
    if (!corridorGeojson || !workspaceId || !queryText.trim()) {
      setError("Workspace ID, corridor, and query are required.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          queryText: queryText.trim(),
          corridorGeojson,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: unknown };
        throw new Error(payload.error ?? "Analysis request failed.");
      }

      const payload = (await response.json()) as AnalysisResult;
      setAnalysisResult(payload);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Analysis request failed.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateReport = async () => {
    if (!analysisResult?.runId) {
      setError("Run an analysis before generating a report.");
      return;
    }

    setError("");
    setIsGeneratingReport(true);

    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ runId: analysisResult.runId }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Report generation failed.");
      }

      const html = await response.text();
      const reportWindow = window.open("", "_blank");
      if (!reportWindow) {
        throw new Error("Popup blocked. Allow popups to view the report.");
      }
      reportWindow.document.open();
      reportWindow.document.write(html);
      reportWindow.document.close();
    } catch (reportError) {
      const message = reportError instanceof Error ? reportError.message : "Report generation failed.";
      setError(message);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
      <div className="overflow-hidden rounded-lg border border-border">
        <div ref={mapContainerRef} className="h-[560px] w-full" />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Analysis Workspace</CardTitle>
            <CardDescription>Upload a corridor, enter a prompt, and run a grant-ready corridor analysis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder="Workspace UUID"
            />
            <CorridorUpload onUpload={(geojson) => setCorridorGeojson(geojson)} />
            <Textarea
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Example: Evaluate transit accessibility and safety concerns for this corridor."
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void runAnalysis()} disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Running..." : "Run Analysis"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void generateReport()}
                disabled={!analysisResult?.runId || isGeneratingReport}
              >
                {isGeneratingReport ? "Generating..." : "Generate Report"}
              </Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card>

        {analysisResult ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Latest Result</CardTitle>
              <CardDescription>
                {analysisResult.aiInterpretationSource === "ai"
                  ? "AI-enhanced interpretation generated."
                  : "Interpretation generated using deterministic fallback summary."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Accessibility: {analysisResult.metrics.accessibilityScore}</Badge>
                <Badge variant="outline">Safety: {analysisResult.metrics.safetyScore}</Badge>
                <Badge variant="outline">Equity: {analysisResult.metrics.equityScore}</Badge>
                {typeof analysisResult.metrics.overallScore === "number" ? (
                  <Badge variant="outline">Overall: {analysisResult.metrics.overallScore}</Badge>
                ) : null}
                {analysisResult.metrics.transitAccessTier ? (
                  <Badge variant="outline">Transit Access: {String(analysisResult.metrics.transitAccessTier)}</Badge>
                ) : null}
                {analysisResult.metrics.confidence ? (
                  <Badge variant="outline">Confidence: {String(analysisResult.metrics.confidence)}</Badge>
                ) : null}
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</p>
                <p className="text-sm text-foreground">{analysisResult.summary}</p>
              </div>

              {analysisResult.aiInterpretation ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI Interpretation</p>
                  <p className="text-sm text-foreground">{analysisResult.aiInterpretation}</p>
                </div>
              ) : null}

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Data Quality</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    Census: {analysisResult.metrics.dataQuality?.censusAvailable ? "Live" : "Unavailable"}
                  </Badge>
                  <Badge variant="outline">
                    Crashes: {analysisResult.metrics.dataQuality?.crashDataAvailable ? "Live" : "Estimated"}
                  </Badge>
                  <Badge variant="outline">
                    LODES: {String(analysisResult.metrics.dataQuality?.lodesSource ?? "unknown")}
                  </Badge>
                  <Badge variant="outline">
                    Equity: {String(analysisResult.metrics.dataQuality?.equitySource ?? analysisResult.metrics["equitySource"] ?? "unknown")}
                  </Badge>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">Run ID: {analysisResult.runId}</p>
            </CardContent>
          </Card>
        ) : null}

        <RunHistory workspaceId={workspaceId} />
      </div>
    </section>
  );
}
