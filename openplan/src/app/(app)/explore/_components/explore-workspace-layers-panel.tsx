"use client";

import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspaceMapLayers } from "@/components/cartographic/cartographic-context";

/**
 * The agency's own uploaded layers, on the page a planner opens to read a map.
 *
 * ═══ WHY THIS IS NOT THE SHELL'S LAYERS PANEL ═══
 *
 * The shell's map dock is CSS-hidden on this route (`body[data-map-owner]`),
 * because Corridor Analysis owns its Mapbox instance and the dock's checkboxes
 * would drive a map that is not on screen. Unhiding it here would put a second
 * floating panel over Explore's map stage, in the shell's visual vocabulary, and
 * leave two panels claiming to control one map.
 *
 * So the controls come to Explore's own right rail, in Explore's own
 * `analysis-studio-surface` idiom, beside the built-in layer toggles they belong
 * with. The STATE is shared — the same `useWorkspaceMapLayers` the shell uses,
 * so a layer a planner switched on from Safety is on when they get here — and
 * only the chrome differs.
 *
 * ═══ THE COVERAGE NOTES ARE NOT OPTIONAL ═══
 *
 * A layer can be empty in this window for three reasons that look identical on a
 * map: it is too dense to draw, it has no finished upload, or the area genuinely
 * has none of it. A planner who reads "nothing here" off a blank map when the
 * truth was "214,391 shapes, zoom in" has been actively misled by software. Those
 * sentences come from the route that knows which case it is, and they render
 * here or this page reproduces the exact defect they exist to prevent.
 */
export function ExploreWorkspaceLayersPanel({
  onEmphasize,
}: {
  /**
   * A layer is being pointed at, or null. Purely transient — pointer in, pointer
   * out, focus in, focus out — and never persisted anywhere.
   */
  onEmphasize?: (layerId: string | null) => void;
}) {
  const {
    workspaceLayers,
    workspaceCatalogError,
    workspaceLayerVisibility,
    toggleWorkspaceLayer,
    workspaceLayerStatus,
  } = useWorkspaceMapLayers();

  /**
   * Every caveat that applies right now, in catalog order.
   *
   * A note whose status belongs to a layer that has since been removed from the
   * catalog is dropped: the status map is keyed by layer id and outlives the
   * layer, and a caveat about a deleted layer is a sentence about nothing.
   */
  const coverageNotes = workspaceLayers.flatMap(
    (listing) => workspaceLayerStatus[listing.layer.id]?.notes ?? [],
  );

  const visibleCount = workspaceLayers.filter(
    (listing) => workspaceLayerVisibility[listing.layer.id] === true,
  ).length;

  return (
    <section className="analysis-studio-surface">
      <div className="analysis-studio-header">
        <div className="analysis-studio-heading">
          <p className="analysis-studio-label">Map layers</p>
          <h3 className="analysis-studio-title">Your agency&rsquo;s layers</h3>
          <p className="analysis-studio-description">
            Anything your agency has uploaded to the layer library draws underneath the analysis on
            this map, so the corridor and the crashes stay on top of it.
          </p>
        </div>
        <StatusBadge tone={visibleCount > 0 ? "success" : "neutral"}>
          {workspaceLayers.length === 0
            ? "None yet"
            : `${visibleCount} of ${workspaceLayers.length} on`}
        </StatusBadge>
      </div>

      <div className="analysis-studio-body">
        {/*
          A FAILED READ SAYS SO, rather than rendering as an empty list. These
          two states produce the same empty array and mean opposite things:
          "this agency has uploaded nothing" and "OpenPlan could not find out".
          Shown ABOVE the list and as an alert, because whatever follows it has
          to be read in its light.
        */}
        {workspaceCatalogError ? (
          <p className="analysis-studio-note" role="alert">
            {workspaceCatalogError}
          </p>
        ) : null}

        {workspaceLayers.length === 0 && !workspaceCatalogError ? (
          <p className="analysis-studio-note">
            No layers uploaded yet. Add a shapefile, GeoJSON or KML in the{" "}
            <Link href="/data-hub" className="analysis-studio-inline-link">
              data hub
            </Link>{" "}
            and it will draw here.
          </p>
        ) : null}

        {workspaceLayers.length > 0 ? (
          <ul className="analysis-workspace-layers" role="list">
            {workspaceLayers.map((listing) => {
              const layer = listing.layer;
              const version = layer.currentVersion;
              const checked = workspaceLayerVisibility[layer.id] === true;
              return (
                <li key={layer.id}>
                  {/*
                    A REAL CHECKBOX INSIDE A REAL LABEL. The built-in toggles
                    above are buttons because they carry no third state, but a
                    list of an agency's own layers is exactly the case a
                    checkbox group is for — and it is what makes the row
                    tabbable, announced with its checked state, and operable
                    with Space without a line of JavaScript.

                    Emphasis is bound to focus as well as hover, so a planner
                    tabbing through the list gets the same "which one is this?"
                    answer a planner with a mouse gets.
                  */}
                  <label
                    className="analysis-workspace-layer"
                    onMouseEnter={() => onEmphasize?.(layer.id)}
                    onMouseLeave={() => onEmphasize?.(null)}
                    onFocus={() => onEmphasize?.(layer.id)}
                    onBlur={() => onEmphasize?.(null)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleWorkspaceLayer(layer.id)}
                    />
                    <span
                      className="analysis-workspace-layer__swatch"
                      style={{ backgroundColor: layer.style.color }}
                      aria-hidden
                    />
                    <span className="analysis-workspace-layer__label">{layer.name}</span>
                  </label>
                  {/*
                    No chip where the shell shows one. A layer with no finished
                    upload says so in words instead, because a "0" would read as
                    an empty file rather than as an upload that never landed.
                  */}
                  {!version ? (
                    <p className="analysis-workspace-layer__note" role="note">
                      No finished upload yet — nothing is drawn for this layer.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {coverageNotes.length > 0 ? (
          /*
            COLLAPSED BY DEFAULT, BUT PRESENT AND COUNTED — the shell's shape,
            for the shell's reason. These paragraphs are the honest disclosures,
            and several of them would otherwise be the tallest thing in this
            rail. The summary states HOW MANY there are, so the existence of a
            caveat is never hidden; only its wording is one click away.
          */
          <details className="analysis-workspace-layers__notes" aria-label="Map layer coverage">
            <summary className="analysis-workspace-layers__notes-summary">
              {coverageNotes.length === 1
                ? "1 coverage note"
                : `${coverageNotes.length} coverage notes`}
            </summary>
            <div role="note">
              {coverageNotes.map((note) => (
                <p key={note} className="analysis-workspace-layer__note">
                  {note}
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
