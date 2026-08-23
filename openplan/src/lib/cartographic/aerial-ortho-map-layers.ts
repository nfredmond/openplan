import type { AnyLayer } from "mapbox-gl";

import type { ResolvedAerialOrthoLayer } from "@/lib/aerial/ortho-map-layers";

export type AerialOrthoMapTarget = {
  getSource(id: string): unknown;
  addSource(
    id: string,
    source: {
      type: "image";
      url: string;
      coordinates: [[number, number], [number, number], [number, number], [number, number]];
    },
  ): unknown;
  removeSource(id: string): unknown;
  getLayer(id: string): unknown;
  addLayer(layer: AnyLayer, before?: string): unknown;
  removeLayer(id: string): unknown;
  moveLayer(id: string, before?: string): unknown;
  fitBounds?(
    bounds: [[number, number], [number, number]],
    options?: { padding?: number; maxZoom?: number },
  ): unknown;
};

export const aerialOrthoSourceId = (custodyId: string) => `cartographic-aerial-ortho-${custodyId}`;
export const aerialOrthoLayerId = (custodyId: string) => `${aerialOrthoSourceId(custodyId)}-raster`;

function coordinates(
  bounds: [number, number, number, number],
): [[number, number], [number, number], [number, number], [number, number]] {
  const [west, south, east, north] = bounds;
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

/** Draw selected previews below the map's analytical layers. */
export function paintAerialOrthoLayers(
  map: AerialOrthoMapTarget,
  input: {
    catalogCustodyIds: string[];
    layers: ResolvedAerialOrthoLayer[];
    anchorLayerId?: string;
  },
): void {
  const active = new Set(input.layers.map((layer) => layer.custodyId));

  for (const custodyId of input.catalogCustodyIds) {
    if (active.has(custodyId)) continue;
    const layerId = aerialOrthoLayerId(custodyId);
    const sourceId = aerialOrthoSourceId(custodyId);
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }

  for (const layer of input.layers) {
    const sourceId = aerialOrthoSourceId(layer.custodyId);
    const layerId = aerialOrthoLayerId(layer.custodyId);
    const nextCoordinates = coordinates(layer.bounds);
    const existing = map.getSource(sourceId) as
      | { updateImage?: (input: { url: string; coordinates: typeof nextCoordinates }) => void }
      | undefined;

    if (!existing) {
      map.addSource(sourceId, { type: "image", url: layer.url, coordinates: nextCoordinates });
    } else if (typeof existing.updateImage === "function") {
      existing.updateImage({ url: layer.url, coordinates: nextCoordinates });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer(
        {
          id: layerId,
          type: "raster",
          source: sourceId,
          paint: { "raster-opacity": 0.82, "raster-fade-duration": 0 },
        },
        input.anchorLayerId,
      );
    } else if (input.anchorLayerId) {
      map.moveLayer(layerId, input.anchorLayerId);
    }
  }
}
