"use client";

import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import type { SafetyCrashFeature } from "@/lib/safety/client-types";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { renderSafetyStreetContextSvg, SAFETY_STREET_CONTEXT_PROJECTION_NOTE } from "@/lib/safety/street-context-svg";

export function SafetyPrintableStreetContext({
  projectName,
  place,
  crashes,
  roads,
  coverageLimit,
}: {
  projectName: string | null;
  place: PlaceBoundaryResponse | null;
  crashes: readonly SafetyCrashFeature[];
  roads: readonly SafetyRoadContextFeature[] | null;
  coverageLimit: string;
}) {
  const svg = renderSafetyStreetContextSvg({
    roads: roads ?? [],
    crashLocations: crashes.map((crash) => crash.geometry.coordinates as [number, number]),
    projectGeometry: place?.geojson ?? null,
  });
  if (!svg) return null;
  const sources = Array.from(
    new Set((roads ?? []).map((road) =>
      `${road.sourceLabel} ${road.vintage}${road.cachedAt ? `, cached ${new Date(road.cachedAt).toLocaleDateString()}` : ""}`
    ))
  );

  return (
    <section className="safety-print-sheet rounded-lg border border-border/70 bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Printable street context</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Local vector drawing from frozen project, crash, and registered road lines. No tile service is used.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" />
          Print context
        </Button>
      </div>
      <div
        className="mt-3"
        aria-label={`Street context for ${projectName ?? place?.label ?? "the selected Safety area"}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <p><strong className="text-foreground">Project:</strong> {projectName ?? place?.label ?? "No project label available"}</p>
        <p><strong className="text-foreground">Crash locations:</strong> {crashes.length.toLocaleString()} mapped crashes in this view.</p>
        <p><strong className="text-foreground">Road source:</strong> {sources.length > 0 ? sources.join("; ") : "Road identity unavailable"}</p>
        <p><strong className="text-foreground">Coverage limit:</strong> {coverageLimit}</p>
        <p>{SAFETY_STREET_CONTEXT_PROJECTION_NOTE}</p>
      </div>
    </section>
  );
}
