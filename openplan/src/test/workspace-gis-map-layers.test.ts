import { describe, expect, it } from "vitest";

import {
  applyWorkspaceGisEmphasis,
  applyWorkspaceGisVisibility,
  paintWorkspaceGisLayers,
  workspaceGisCasingLayerId,
  workspaceGisDrawingLayerIds,
  workspaceGisLineLayerId,
  type WorkspaceGisMapTarget,
} from "@/lib/cartographic/workspace-gis-map-layers";
import { WORKSPACE_GIS_CASING_COLOR } from "@/lib/cartographic/workspace-gis-default-style";
import type {
  WorkspaceGisFeatureCollection,
  WorkspaceGisLayerListing,
} from "@/lib/workspace-gis/types";

/**
 * THE SHARED PAINTER DRAWS A LAYER A PLANNER CAN ACTUALLY SEE, AND DRAWS IT
 * UNDERNEATH THE WORK.
 *
 * This module exists because Corridor Analysis became the second map that has
 * to draw a workspace's uploaded layers, and this repository's recorded rule is
 * that the second caller of a capability living inside the first reimplements it
 * wrongly. The three things a second implementation would most plausibly get
 * wrong are exactly the three asserted here:
 *
 *   1. the ANCHOR — a viewport-filling parcel polygon drawn on top eats every
 *      click and hover on the map, silently;
 *   2. the CASING — without it a 2.5px coloured line over a busy basemap is not
 *      reliably visible in either theme, which is the whole complaint this work
 *      answers;
 *   3. the DRAWING-LAYER LIST — a layer missing from it is an orphan the toggle
 *      cannot switch off.
 *
 * The subject is a plain object satisfying `WorkspaceGisMapTarget`, not a
 * `mapboxgl.Map` cast through `as unknown`. That is deliberate: the module's
 * published type IS those calls, so the stub is a real subject rather than a
 * lie, and a change to the calls it makes breaks compilation here.
 */

type AddedLayer = { spec: Record<string, unknown>; before: string | undefined };

function makeMap(existingLayerIds: string[] = []) {
  const layerIds = new Set(existingLayerIds);
  const sources = new Set<string>();
  const added: AddedLayer[] = [];
  const paint: Array<{ layer: string; property: string; value: unknown }> = [];
  const layout: Array<{ layer: string; property: string; value: unknown }> = [];
  const moved: Array<{ layer: string; before: string | undefined }> = [];
  const removed: string[] = [];

  const map: WorkspaceGisMapTarget = {
    getSource: (id) => (sources.has(id) ? { setData: () => {} } : undefined),
    addSource: (id) => {
      sources.add(id);
      return undefined;
    },
    getLayer: (id) => (layerIds.has(id) ? { id } : undefined),
    addLayer: (spec, before) => {
      const record = spec as unknown as Record<string, unknown>;
      layerIds.add(String(record.id));
      added.push({ spec: record, before });
      return undefined;
    },
    removeLayer: (id) => {
      layerIds.delete(id);
      removed.push(id);
      return undefined;
    },
    moveLayer: (layer, before) => {
      moved.push({ layer, before });
      return undefined;
    },
    setPaintProperty: (layer, property, value) => {
      paint.push({ layer, property, value });
      return undefined;
    },
    setLayoutProperty: (layer, property, value) => {
      layout.push({ layer, property, value });
      return undefined;
    },
  };

  return { map, added, paint, layout, moved, removed, layerIds };
}

function listing(overrides: Partial<{ id: string; color: string; lineWidth: number; sortOrder: number; opacity: number; labelField: string | null }> = {}): WorkspaceGisLayerListing {
  const id = overrides.id ?? "layer-1";
  return {
    layer: {
      id,
      workspaceId: "ws-1",
      projectId: null,
      name: "Bike network",
      description: null,
      style: {
        color: overrides.color ?? "#d55e00",
        opacity: overrides.opacity ?? 0.8,
        lineWidth: overrides.lineWidth ?? 2.5,
        labelField: overrides.labelField ?? null,
      },
      defaultVisible: true,
      sortOrder: overrides.sortOrder ?? 0,
      archivedAt: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      currentVersion: null,
    },
    notes: [],
  };
}

function collection(layerId: string): WorkspaceGisFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: `${layerId}-0`,
        geometry: { type: "LineString", coordinates: [[-121, 39], [-120.9, 39.1]] },
        properties: {
          kind: "workspace_gis_feature",
          layerId,
          versionId: "version-1",
          featureIndex: 0,
          attributes: { NAME: "Class II" },
        },
      },
    ] as WorkspaceGisFeatureCollection["features"],
    returnedCount: 1,
    matchedCount: 1,
    droppedCount: 0,
    truncated: false,
    limit: 5000,
    tooDenseToDraw: false,
    coverageNotes: [],
  };
}

describe("the shared workspace-GIS painter", () => {
  it("puts every drawing layer beneath the anchor it was given", () => {
    const { map, added } = makeMap(["tract-fill", "analysis-fill"]);

    paintWorkspaceGisLayers(map, {
      layers: [listing()],
      collections: { "layer-1": collection("layer-1") },
      anchorLayerId: "tract-fill",
      theme: "dark",
    });

    expect(added.length).toBeGreaterThan(0);
    for (const entry of added) {
      // EVERY layer, not just the first. A casing inserted with no anchor while
      // the fill got one is the z-order defect in its quietest form.
      expect(entry.before).toBe("tract-fill");
    }
  });

  it("draws a casing UNDER the line, in the theme's ink, at the line's width plus two", () => {
    const { map, added } = makeMap(["tract-fill"]);

    paintWorkspaceGisLayers(map, {
      layers: [listing({ color: "#0072b2", lineWidth: 2.5 })],
      collections: { "layer-1": collection("layer-1") },
      anchorLayerId: "tract-fill",
      theme: "light",
    });

    const ids = added.map((entry) => String(entry.spec.id));
    const casingIndex = ids.indexOf(workspaceGisCasingLayerId("layer-1"));
    const lineIndex = ids.indexOf(workspaceGisLineLayerId("layer-1"));

    expect(casingIndex).toBeGreaterThanOrEqual(0);
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    // Both are inserted before the same anchor, so INSERTION ORDER is z-order:
    // whatever went in first is lower. The casing must be the lower one.
    expect(casingIndex).toBeLessThan(lineIndex);

    const casing = added[casingIndex].spec.paint as Record<string, unknown>;
    const line = added[lineIndex].spec.paint as Record<string, unknown>;

    expect(casing["line-color"]).toBe(WORKSPACE_GIS_CASING_COLOR.light);
    expect(casing["line-width"]).toBe(4.5);
    // The LINE keeps the planner's colour untouched — the casing separates it
    // from the basemap without changing it, which is what lets the swatch in the
    // panel and the ink on the map be the same colour.
    expect(line["line-color"]).toBe("#0072b2");
    expect(line["line-width"]).toBe(2.5);
  });

  it("switches the casing off with the rest of the layer", () => {
    const { map, layout } = makeMap(workspaceGisDrawingLayerIds("layer-1"));

    applyWorkspaceGisVisibility(map, [listing()], { "layer-1": false });

    const hidden = layout
      .filter((entry) => entry.property === "visibility" && entry.value === "none")
      .map((entry) => entry.layer);

    // A casing left visible under a hidden line renders as a white ghost of a
    // layer the planner believes they switched off.
    expect(hidden).toContain(workspaceGisCasingLayerId("layer-1"));
    expect(hidden).toEqual(expect.arrayContaining(workspaceGisDrawingLayerIds("layer-1")));
  });

  it("dims the other layers while one is being pointed at, and restores them after", () => {
    const layers = [listing({ id: "layer-1" }), listing({ id: "layer-2" })];
    const { map, paint } = makeMap([
      ...workspaceGisDrawingLayerIds("layer-1"),
      ...workspaceGisDrawingLayerIds("layer-2"),
    ]);

    applyWorkspaceGisEmphasis(map, layers, "layer-1");

    const widthOf = (layerId: string) =>
      paint.filter((e) => e.layer === workspaceGisLineLayerId(layerId) && e.property === "line-width").at(-1)?.value;
    const opacityOf = (layerId: string) =>
      paint.filter((e) => e.layer === workspaceGisLineLayerId(layerId) && e.property === "line-opacity").at(-1)?.value;

    expect(widthOf("layer-1")).toBeCloseTo(4);
    expect(opacityOf("layer-1")).toBeCloseTo(0.8);
    expect(opacityOf("layer-2")).toBeCloseTo(0.28);

    paint.length = 0;
    applyWorkspaceGisEmphasis(map, layers, null);

    // Restored from the layer's OWN stored style, not from a remembered
    // "previous" value that a mid-hover colour change would have staled.
    expect(widthOf("layer-1")).toBeCloseTo(2.5);
    expect(opacityOf("layer-2")).toBeCloseTo(0.8);
  });
});
