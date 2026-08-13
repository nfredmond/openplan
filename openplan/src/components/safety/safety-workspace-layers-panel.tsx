"use client";

import Link from "next/link";

import { useWorkspaceMapLayers } from "@/components/cartographic/cartographic-context";

/**
 * The agency's own uploaded layers, controlling the map on THIS page.
 *
 * ═══ WHAT THIS REPLACED, AND WHY IT IS NOT THE SHELL'S PANEL ═══
 *
 * Safety used to get the shell's layers panel, docked at the right edge of the
 * window. Measured in a real browser at 1600×900 on 2026-08-13, that panel was
 * 240×458 at x=1344 — and the map it controlled was the shell BACKDROP, a
 * 1600×900 Mapbox instance sitting entirely behind the page panel. The crash
 * map the planner was actually reading was a separate 558×457 instance at
 * (305,350) and carried none of those layers.
 *
 * So a planner who ticked "Parcels" got a checkbox that stayed ticked, a fetch
 * that succeeded, a layer that painted — onto a canvas nobody could see. That is
 * the worst shape a control can take: it reports success and changes nothing.
 * The Data Hub compounded it by promising uploads "become toggles on the Layers
 * panel on Safety".
 *
 * `/safety` now owns its map (`lib/navigation/map-surfaces`), the shell's dock
 * does not mount here, and these toggles drive the crash map directly through
 * `useWorkspaceGisMapBinding`. The STATE is the shell's own — the same
 * `useWorkspaceMapLayers` context Corridor Analysis and the backdrop read — so a
 * layer switched on here is still on when the planner reaches Aerial. Only the
 * chrome is Safety's, which is the same trade `ExploreWorkspaceLayersPanel`
 * documents; a fourth copy of the STATE would be the drift this context exists
 * to prevent.
 *
 * ═══ THE COVERAGE NOTES ARE NOT OPTIONAL ═══
 *
 * A layer can draw nothing for three reasons that look identical on a map: it is
 * too dense to draw at this zoom, it has no finished upload, or the area
 * genuinely contains none of it. Only the route that answered knows which. On a
 * page whose entire subject is "how bad is it here", a planner who reads
 * "nothing here" off a blank layer when the truth was "214,391 shapes, zoom in"
 * has been actively misled.
 */
export function SafetyWorkspaceLayersPanel() {
  const {
    workspaceLayers,
    workspaceCatalogError,
    workspaceLayerVisibility,
    toggleWorkspaceLayer,
    workspaceLayerStatus,
  } = useWorkspaceMapLayers();

  /**
   * Every caveat that applies right now, in catalog order. A note whose layer
   * has since left the catalog is dropped — the status map is keyed by layer id
   * and outlives the layer, and a caveat about a deleted layer is a sentence
   * about nothing.
   */
  const coverageNotes = workspaceLayers.flatMap(
    (listing) => workspaceLayerStatus[listing.layer.id]?.notes ?? []
  );

  const visibleCount = workspaceLayers.filter(
    (listing) => workspaceLayerVisibility[listing.layer.id] === true
  ).length;

  return (
    <section
      className="rounded-lg border p-4 text-sm"
      aria-label="Your agency's map layers"
      data-testid="safety-workspace-layers"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Your agency&rsquo;s layers</h2>
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {workspaceLayers.length === 0
            ? "None yet"
            : `${visibleCount} of ${workspaceLayers.length} on`}
        </span>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Anything uploaded to the layer library draws underneath the collisions on this map, so the
        crashes stay on top of it.
      </p>

      {/*
        A FAILED READ SAYS SO rather than rendering as an empty list. The two
        states produce the same empty array and mean opposite things: "this
        agency has uploaded nothing" and "OpenPlan could not find out". Shown
        ABOVE the list, and as an alert, because whatever follows has to be read
        in its light.
      */}
      {workspaceCatalogError ? (
        <p className="text-xs text-destructive" role="alert">
          {workspaceCatalogError}
        </p>
      ) : null}

      {workspaceLayers.length === 0 && !workspaceCatalogError ? (
        <p className="text-xs text-muted-foreground">
          No layers uploaded yet. Add a shapefile, GeoJSON or KML in the{" "}
          <Link href="/data-hub" className="underline underline-offset-2">
            data hub
          </Link>{" "}
          and it will draw here.
        </p>
      ) : null}

      {workspaceLayers.length > 0 ? (
        <ul className="flex flex-col gap-1.5" role="list">
          {workspaceLayers.map((listing) => {
            const layer = listing.layer;
            const checked = workspaceLayerVisibility[layer.id] === true;
            return (
              <li key={layer.id}>
                {/* A REAL CHECKBOX INSIDE A REAL LABEL — tabbable, announced
                    with its checked state, operable with Space, without a line
                    of JavaScript. */}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleWorkspaceLayer(layer.id)}
                  />
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: layer.style.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                </label>
                {/* Words, not a "0" chip. A zero would read as an empty file
                    rather than as an upload that never landed. */}
                {!layer.currentVersion ? (
                  <p className="ml-6 text-xs italic text-muted-foreground" role="note">
                    No finished upload yet — nothing is drawn for this layer.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {coverageNotes.length > 0 ? (
        /* COLLAPSED BUT COUNTED. Several of these paragraphs would otherwise be
           the tallest thing in this sidebar, and this column also carries the
           crash caveats, which outrank them. The summary states HOW MANY there
           are, so the existence of a caveat is never hidden — only its wording
           is one click away. */
        <details className="mt-3" aria-label="Map layer coverage">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {coverageNotes.length === 1
              ? "1 coverage note"
              : `${coverageNotes.length} coverage notes`}
          </summary>
          <div role="note" className="mt-1 flex flex-col gap-1">
            {coverageNotes.map((note) => (
              <p key={note} className="text-xs text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
