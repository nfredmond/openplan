"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CorridorUpload } from "@/components/corridor/CorridorUpload";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { StatusBadge } from "@/components/ui/status-badge";
import { parseCorridorText, type StudyAreaPrefill } from "@/lib/models/study-area";
import type { CorridorGeometry, HomeGeographyLoadState } from "./_types";

/**
 * The study area for an Analysis Studio run — two ways in, one boundary out.
 *
 * WHY THIS EXISTS. Until now the only way to define a study area here was to
 * upload a `.geojson` file from disk. An agency that had just signed up had no
 * such file and no way to make one, so the app's most-linked working surface was
 * a dead end for exactly the planner it is meant to serve. Meanwhile the rest of
 * the app already had a TIGERweb-backed any-place picker. This panel mounts that
 * SAME picker — CLAUDE.md non-negotiable #1 forbids a second geography front
 * door — and keeps the file upload beside it, because a planner who really does
 * have a corridor shapefile export must not lose the path they already use.
 *
 * ONE SOURCE OF TRUTH. The page owns `corridorGeojson`; every input writes to it
 * and the run gate reads it, so a run behaves identically whichever way the area
 * was set. The picker is controlled around GeoJSON *text*, and that text is
 * DERIVED from the page's geometry rather than mirrored in local state — so an
 * area arriving from somewhere else entirely (a home-geography prefill, a
 * reloaded run) shows up in the picker with nothing to keep in step and nothing
 * to fall out of step.
 *
 * WHAT IT MUST NOT SAY. Setting an area is not an analysis. The copy here says
 * what a selection does — defines the boundary — and leaves the claims about
 * results to the run that follows.
 */

type ExploreStudyAreaPanelProps = {
  /** The page's study area. `null` until something sets one. */
  corridorGeojson: CorridorGeometry | null;
  /** Publishes a new study area, or `null` when it is cleared. */
  onCorridorChange: (geometry: CorridorGeometry | null) => void;
  /**
   * The workspace's home geography as a study-area selection, from
   * `studyAreaPrefillFromHomeGeography`. Applying it is the page's job; this
   * panel only needs to recognize it so it can say where the area came from.
   */
  prefill: StudyAreaPrefill;
  homeGeographyLoadState: HomeGeographyLoadState;
};

export function ExploreStudyAreaPanel({
  corridorGeojson,
  onCorridorChange,
  prefill,
  homeGeographyLoadState,
}: ExploreStudyAreaPanelProps) {
  // What the picker shows is the study area itself, serialized — not a copy of
  // it that has to be kept honest.
  const corridorText = useMemo(
    () => (corridorGeojson ? JSON.stringify(corridorGeojson) : ""),
    [corridorGeojson]
  );

  // The geometry the last uploaded file produced, so the upload card can stop
  // claiming a file that another input has since replaced.
  const [uploadedGeometry, setUploadedGeometry] = useState<CorridorGeometry | null>(null);

  function handlePickerChange(text: string) {
    // A searched place and a drawn area take the same road: both are just a
    // boundary, and the run cannot tell them apart.
    onCorridorChange(parseCorridorText(text));
  }

  function handleUpload(geometry: CorridorGeometry) {
    setUploadedGeometry(geometry);
    onCorridorChange(geometry);
  }

  const hasStudyArea = corridorGeojson !== null;
  const prefillIsCurrent = prefill.geometry !== null && corridorGeojson === prefill.geometry;
  const uploadIsCurrent = uploadedGeometry !== null && corridorGeojson === uploadedGeometry;

  return (
    <>
      <section className="analysis-studio-surface">
        <div className="analysis-studio-header">
          <div className="analysis-studio-heading">
            <p className="analysis-studio-label">Study area</p>
            <h3 className="analysis-studio-title">Pick the area to analyze</h3>
            <p className="analysis-studio-description">
              Search for any US county, city, town, CDP, or metro area — or draw the area on the map. No
              file needed. This sets the boundary for the run; it does not analyze anything on its own.
            </p>
          </div>
          <StatusBadge tone={hasStudyArea ? "success" : "neutral"}>
            {hasStudyArea ? "Study area set" : "No study area yet"}
          </StatusBadge>
        </div>

        <div className="analysis-studio-body">
          {prefillIsCurrent ? (
            <p className="analysis-studio-note">
              {prefill.label
                ? `Prefilled from this workspace's home geography (${prefill.label}).`
                : "Prefilled from this workspace's home geography."}{" "}
              Change or clear it here — the workspace setting itself is not affected.
            </p>
          ) : null}

          {homeGeographyLoadState === "loaded" && prefill.geometry === null && !hasStudyArea ? (
            <p className="analysis-studio-note">
              No home geography is set for this workspace, so nothing is preselected. A workspace owner
              or admin can set one on the{" "}
              <Link className="underline underline-offset-2" href="/dashboard">
                dashboard
              </Link>
              , and it will open here next time.
            </p>
          ) : null}

          {homeGeographyLoadState === "unavailable" ? (
            <p className="analysis-studio-note">
              This workspace&apos;s home geography could not be checked, so nothing is preselected.
              Search for the place below.
            </p>
          ) : null}

          <StudyAreaPicker
            corridorText={corridorText}
            onCorridorChange={handlePickerChange}
            // The prefill and an uploaded file are areas the picker did not
            // choose; only the prefill has a name the panel can vouch for.
            externalLabel={prefillIsCurrent ? prefill.label : null}
          />
        </div>
      </section>

      <div className="analysis-studio-surface-slot">
        <CorridorUpload onUpload={handleUpload} isCurrentBoundary={uploadIsCurrent} />
      </div>
    </>
  );
}
