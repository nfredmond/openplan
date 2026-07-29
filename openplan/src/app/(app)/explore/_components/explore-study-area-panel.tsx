"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CorridorUpload } from "@/components/corridor/CorridorUpload";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { StatusBadge } from "@/components/ui/status-badge";
import { parseCorridorText, type ResolvedStudyArea } from "@/lib/models/study-area";
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
 * area arriving from somewhere else entirely (an inherited study area, a
 * reloaded run) shows up in the picker with nothing to keep in step and nothing
 * to fall out of step.
 *
 * WHERE AN INHERITED AREA CAME FROM IS PART OF THE ANSWER. An area can now be
 * inherited from the project this page was opened for as well as from the
 * workspace's home geography, and those are different places. Showing the
 * boundary without saying which one it is would let a county-wide study pass for
 * a corridor-scoped one, so the origin is named here in prose AND handed to the
 * picker as its `externalLabel`.
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
   * What the shared precedence resolved to, from `resolveStudyArea`. Applying it
   * is the page's job; this panel only needs to recognize it so it can say where
   * the area came from.
   */
  studyArea: ResolvedStudyArea;
  homeGeographyLoadState: HomeGeographyLoadState;
  /**
   * The project named in `?projectId=`, when it was read and belongs to this
   * workspace — so an inherited project area can be attributed by name rather
   * than as an anonymous boundary.
   */
  openedForProject: { id: string; name: string | null } | null;
  /**
   * Why the requested project's area is NOT the one on screen, when it isn't.
   * Composed by the loader, which is the only thing that knows whether the row
   * was missing, unreadable, foreign to this workspace, or simply arealess.
   */
  projectAreaNotice: string | null;
};

export function ExploreStudyAreaPanel({
  corridorGeojson,
  onCorridorChange,
  studyArea,
  homeGeographyLoadState,
  openedForProject,
  projectAreaNotice,
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

  /**
   * Whether the area on screen IS the inherited one — compared as text, not by
   * object identity.
   *
   * Identity looks tempting and is wrong here. The resolver runs again the
   * moment its second candidate arrives (the workspace's home geography is
   * fetched after the project's area is already in hand), and re-parsing yields
   * an EQUAL but not IDENTICAL boundary. Comparing references meant the
   * attribution below — and the picker's label — disappeared a few hundred
   * milliseconds after the page opened, leaving an inherited county-wide
   * boundary on screen with nothing saying where it came from. `corridorText` is
   * the resolver's own serialization of the same geometry, so this asks the
   * question that actually matters: is this still that area?
   */
  const inheritedIsCurrent = studyArea.corridorText !== "" && corridorText === studyArea.corridorText;

  // The upload keeps identity: nothing re-derives an uploaded file, so the
  // object the panel handed up is the object it gets back.
  const uploadIsCurrent = uploadedGeometry !== null && corridorGeojson === uploadedGeometry;

  // The place name in parentheses when the inherited area has one. A drawn
  // project area has no name at all, and inventing "Custom study area" for it
  // would hide that it was inherited rather than picked.
  const inheritedPlace = studyArea.label ? ` (${studyArea.label})` : "";
  const inheritedFromCopy =
    studyArea.origin === "project"
      ? `Prefilled from the study area of ${
          openedForProject?.name ?? "the project this page was opened for"
        }${inheritedPlace}. Change or clear it here — the project record itself is not affected.`
      : `Prefilled from this workspace's home geography${inheritedPlace}. Change or clear it here — the workspace setting itself is not affected.`;

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
          {projectAreaNotice ? (
            <div className="analysis-sidepanel-row is-warning">
              <div className="analysis-sidepanel-main">
                <p className="analysis-sidepanel-title">
                  This did not open on the project&apos;s study area
                </p>
                <p className="analysis-sidepanel-body">{projectAreaNotice}</p>
              </div>
              {openedForProject ? (
                <div className="analysis-sidepanel-actions">
                  <Link className="underline underline-offset-2" href={`/projects/${openedForProject.id}`}>
                    Open project record
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          {inheritedIsCurrent ? <p className="analysis-studio-note">{inheritedFromCopy}</p> : null}

          {homeGeographyLoadState === "loaded" && studyArea.origin === "none" && !hasStudyArea ? (
            <p className="analysis-studio-note">
              No home geography is set for this workspace, so nothing is preselected. A workspace owner
              or admin can set one on the{" "}
              <Link className="underline underline-offset-2" href="/dashboard">
                dashboard
              </Link>
              , and it will open here next time.
            </p>
          ) : null}

          {homeGeographyLoadState === "unavailable" && studyArea.origin !== "project" ? (
            <p className="analysis-studio-note">
              This workspace&apos;s home geography could not be checked, so nothing is preselected.
              Search for the place below.
            </p>
          ) : null}

          <StudyAreaPicker
            corridorText={corridorText}
            onCorridorChange={handlePickerChange}
            // `originLabel`, not the bare place name: the resolver documents it
            // as what the planner is TOLD about where the area came from. When
            // the place has a name that name IS the label; when it does not,
            // this says "this project's study area" rather than leaving an
            // inherited boundary anonymous. An uploaded file is an area the
            // panel cannot vouch for at all, so it carries no label.
            externalLabel={inheritedIsCurrent ? studyArea.originLabel : null}
          />
        </div>
      </section>

      <div className="analysis-studio-surface-slot">
        <CorridorUpload onUpload={handleUpload} isCurrentBoundary={uploadIsCurrent} />
      </div>
    </>
  );
}
