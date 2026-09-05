"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  buildCrashExportCsv,
  buildCrashExportGeoJson,
  crashExportFilename,
  type CrashExportFormat,
} from "@/lib/safety/crash-export";
import { crashFilterSearchParams, type CrashFilterSelection } from "@/lib/safety/crash-filters";
import {
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_LIVE_READ_CAVEAT,
  SAFETY_SCREENING_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT,
} from "@/lib/safety/caveats";
import type { SafetyCrashFeature } from "@/lib/safety/client-types";

/**
 * Download the collisions on screen — CSV for a spreadsheet, GeoJSON for GIS.
 *
 * TWO LANES, ONE FILE FORMAT, and the split is the whole reason this component
 * is not just a link.
 *
 *   STORED collisions live in Postgres, and the map draws at most a couple of
 *   thousand of them. Exporting what is drawn would be a truncated slice with
 *   nothing saying so, so this hands the query to `/api/safety/crashes/export`,
 *   which pages the whole matching set and writes matched-versus-exported into
 *   the file's header.
 *
 *   A LIVE READ never touched Postgres — it is held in this browser tab for this
 *   visit only — so no server route can page it. Those features are written to a
 *   file here, in the browser, through the SAME builder the route uses. That is
 *   the point of `crash-export.ts` being pure: the two lanes cannot end up with
 *   different columns, a different header, or a different escaping.
 *
 * The live file carries `SAFETY_LIVE_READ_CAVEAT`, because a file outlives the
 * tab it came from and nothing in it would otherwise say that the records were
 * never saved and cannot be reproduced from OpenPlan later.
 */
export function CrashExportButton({
  workspaceId,
  projectId,
  ingestId,
  bbox,
  filters,
  studyAreaLabel,
  liveFeatures,
  liveSourceLabel,
  liveAttribution,
  disabledReason,
}: {
  workspaceId: string;
  /** Narrow the export to one project's acquisitions, when the workbench is scoped to one. */
  projectId: string | null;
  ingestId?: string | null;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  filters: CrashFilterSelection;
  studyAreaLabel: string | null;
  /**
   * The live-read features currently on screen, or null when the workbench is
   * showing stored collisions. Non-null switches this control to the in-browser
   * lane described above.
   */
  liveFeatures: readonly SafetyCrashFeature[] | null;
  liveSourceLabel: string | null;
  liveAttribution: string | null;
  /** Why the control is unavailable, stated rather than left as a greyed-out mystery. */
  disabledReason: string | null;
}) {
  const [downloading, setDownloading] = useState<CrashExportFormat | null>(null);

  function downloadLive(format: CrashExportFormat) {
    if (!liveFeatures) return;
    const generatedAt = new Date().toISOString();
    const input = {
      features: liveFeatures,
      selection: filters,
      provenance: {
        lane: "live" as const,
        sourceLabel: liveSourceLabel,
        attribution: liveAttribution,
        ingestId: null,
        // The live lane exports exactly the features it holds, so matched and
        // exported are the same number and the header says nothing misleading
        // about a remainder that does not exist.
        matchedCount: liveFeatures.length,
        studyAreaLabel,
        boundingBox: bbox,
      },
      caveats: [
        SAFETY_CRASH_DATA_CAVEAT,
        SAFETY_LIVE_READ_CAVEAT,
        ...(liveFeatures.some((feature) => feature.properties.severity === "unknown")
          ? [SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT]
          : []),
        SAFETY_SCREENING_CAVEAT,
      ],
      generatedAt,
    };

    const body = format === "csv" ? buildCrashExportCsv(input) : buildCrashExportGeoJson(input);
    const blob = new Blob([body], {
      type: format === "csv" ? "text/csv;charset=utf-8" : "application/geo+json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = crashExportFilename(format, generatedAt);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadStored(format: CrashExportFormat) {
    if (!bbox) return;
    const params = new URLSearchParams({
      workspaceId,
      minLon: String(bbox.minLon),
      minLat: String(bbox.minLat),
      maxLon: String(bbox.maxLon),
      maxLat: String(bbox.maxLat),
      format,
    });
    if (projectId) params.set("projectId", projectId);
    if (ingestId) params.set("ingestId", ingestId);
    if (studyAreaLabel) params.set("studyArea", studyAreaLabel);
    // Serialized from the same declaration the route parses back, so the file's
    // stated filters and the query that produced it cannot diverge.
    for (const [key, value] of crashFilterSearchParams(filters)) params.set(key, value);
    window.location.href = `/api/safety/crashes/export?${params.toString()}`;
  }

  function download(format: CrashExportFormat) {
    setDownloading(format);
    try {
      if (liveFeatures) downloadLive(format);
      else downloadStored(format);
    } finally {
      setDownloading(null);
    }
  }

  const unavailable = disabledReason ?? (bbox ? null : "Set a study area first.");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["csv", "geojson"] as const).map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => download(format)}
          disabled={Boolean(unavailable)}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50"
        >
          {downloading === format ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Download {format === "csv" ? "CSV" : "GeoJSON"}
        </button>
      ))}
      <p className="text-xs text-muted-foreground">
        {unavailable ??
          (liveFeatures
            ? "Exports the collisions on screen from this live read. The file states your filters and says the records were never saved into this workspace."
            : "Exports every collision matching your filters in this extent — not just the ones drawn. The file states your filters, its source, and what it does not cover.")}
      </p>
    </div>
  );
}
