import { describe, expect, it, vi } from "vitest";

import {
  aerialOrthoLayerId,
  aerialOrthoSourceId,
  paintAerialOrthoLayers,
  type AerialOrthoMapTarget,
} from "@/lib/cartographic/aerial-ortho-map-layers";
import type { ResolvedAerialOrthoLayer } from "@/lib/aerial/ortho-map-layers";

const CUSTODY_ID = "44444444-4444-4444-8444-444444444444";

function layer(): ResolvedAerialOrthoLayer {
  return {
    custodyId: CUSTODY_ID,
    missionId: "33333333-3333-4333-8333-333333333333",
    projectId: null,
    missionTitle: "River crossing survey",
    projectName: null,
    collectedAt: null,
    heldAt: "2026-08-23T12:00:00Z",
    checksumSha256: "a".repeat(64),
    byteSize: 4096,
    bounds: [7.1, 45.1, 7.2, 45.2],
    nativeCrs: "EPSG:32632",
    pixelSizeM: 0.04,
    url: "https://storage.example/preview.png?token=secret",
    expiresAt: "2026-08-23T12:15:00Z",
  };
}

function fakeMap() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();
  const calls: Array<{ kind: string; id: string; before?: string }> = [];
  const map: AerialOrthoMapTarget = {
    getSource: (id) => sources.get(id),
    addSource: (id, source) => {
      sources.set(id, source);
    },
    removeSource: (id) => {
      sources.delete(id);
    },
    getLayer: (id) => layers.get(id),
    addLayer: (spec, before) => {
      layers.set(spec.id, spec);
      calls.push({ kind: "add", id: spec.id, before });
    },
    removeLayer: (id) => {
      layers.delete(id);
    },
    moveLayer: (id, before) => calls.push({ kind: "move", id, before }),
  };
  return { map, sources, layers, calls };
}

describe("paintAerialOrthoLayers", () => {
  it("uses Mapbox corner order and places imagery below the analytical anchor", () => {
    const target = fakeMap();
    paintAerialOrthoLayers(target.map, {
      catalogCustodyIds: [CUSTODY_ID],
      layers: [layer()],
      anchorLayerId: "crash-points",
    });

    expect(target.sources.get(aerialOrthoSourceId(CUSTODY_ID))).toMatchObject({
      type: "image",
      coordinates: [
        [7.1, 45.2],
        [7.2, 45.2],
        [7.2, 45.1],
        [7.1, 45.1],
      ],
    });
    expect(target.calls).toContainEqual({
      kind: "add",
      id: aerialOrthoLayerId(CUSTODY_ID),
      before: "crash-points",
    });
  });

  it("removes a catalog layer as soon as it is no longer selected", () => {
    const target = fakeMap();
    paintAerialOrthoLayers(target.map, {
      catalogCustodyIds: [CUSTODY_ID],
      layers: [layer()],
    });
    paintAerialOrthoLayers(target.map, {
      catalogCustodyIds: [CUSTODY_ID],
      layers: [],
    });
    expect(target.layers.has(aerialOrthoLayerId(CUSTODY_ID))).toBe(false);
    expect(target.sources.has(aerialOrthoSourceId(CUSTODY_ID))).toBe(false);
  });

  it("refreshes an existing image source with the new signed URL", () => {
    const target = fakeMap();
    const updateImage = vi.fn();
    target.sources.set(aerialOrthoSourceId(CUSTODY_ID), { updateImage });
    target.layers.set(aerialOrthoLayerId(CUSTODY_ID), {});

    paintAerialOrthoLayers(target.map, {
      catalogCustodyIds: [CUSTODY_ID],
      layers: [layer()],
      anchorLayerId: "analysis",
    });

    expect(updateImage).toHaveBeenCalledWith(expect.objectContaining({ url: layer().url }));
    expect(target.calls).toContainEqual({
      kind: "move",
      id: aerialOrthoLayerId(CUSTODY_ID),
      before: "analysis",
    });
  });
});
