import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AerialOrthoMapTarget } from "@/lib/cartographic/aerial-ortho-map-layers";

const mocks = vi.hoisted(() => ({
  custodyId: "44444444-4444-4444-8444-444444444444",
  layers: [] as Array<{ custodyId: string }>,
  selected: {} as Record<string, boolean>,
  setLayerFailure: vi.fn(),
  resolveAerialOrthoLayer: vi.fn(),
}));

vi.mock("@/components/cartographic/aerial-ortho-layer-context", () => ({
  useAerialOrthoLayers: () => ({
    layers: mocks.layers,
    selected: mocks.selected,
    setLayerFailure: mocks.setLayerFailure,
  }),
  resolveAerialOrthoLayer: mocks.resolveAerialOrthoLayer,
}));

import { useAerialOrthoMapBinding } from "@/components/cartographic/use-aerial-ortho-map-binding";

function Harness({ mapRef = { current: null }, ready = false }: {
  mapRef?: { current: AerialOrthoMapTarget | null };
  ready?: boolean;
}) {
  useAerialOrthoMapBinding({
    mapRef,
    ready,
    enabled: true,
    resolveAnchorLayerId: () => undefined,
  });
  return null;
}

describe("useAerialOrthoMapBinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.layers = [{ custodyId: mocks.custodyId }];
    mocks.selected = { [mocks.custodyId]: true };
    mocks.resolveAerialOrthoLayer.mockRejectedValue(new Error("signed link expired"));
  });

  it("reports a selected preview whose signed image cannot be resolved", async () => {
    render(<Harness />);

    await waitFor(() =>
      expect(mocks.setLayerFailure).toHaveBeenCalledWith(mocks.custodyId, "signed link expired"),
    );
  });

  it("removes a painted preview when its custody row leaves the verified catalog", async () => {
    const sources = new Map<string, unknown>();
    const mapLayers = new Map<string, unknown>();
    const map: AerialOrthoMapTarget = {
      getSource: (id) => sources.get(id),
      addSource: (id, source) => sources.set(id, source),
      removeSource: (id) => sources.delete(id),
      getLayer: (id) => mapLayers.get(id),
      addLayer: (layer) => mapLayers.set(layer.id, layer),
      removeLayer: (id) => mapLayers.delete(id),
      moveLayer: () => undefined,
    };
    mocks.resolveAerialOrthoLayer.mockResolvedValue({
      custodyId: mocks.custodyId,
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
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    const mapRef = { current: map };
    const view = render(<Harness mapRef={mapRef} ready />);

    await waitFor(() => expect(sources.size).toBe(1));
    mocks.layers = [];
    mocks.selected = {};
    view.rerender(<Harness mapRef={mapRef} ready />);

    await waitFor(() => {
      expect(sources.size).toBe(0);
      expect(mapLayers.size).toBe(0);
    });
  });
});
