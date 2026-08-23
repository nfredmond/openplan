import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AerialOrthoLayerProvider,
  readStoredAerialOrthoSelection,
  useAerialOrthoLayers,
} from "@/components/cartographic/aerial-ortho-layer-context";
import { AerialOrthoLayersPanel } from "@/components/cartographic/aerial-ortho-layers-panel";
import type { AerialOrthoCatalog } from "@/lib/aerial/ortho-map-layers";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const CUSTODY_ID = "44444444-4444-4444-8444-444444444444";
const ORIGINAL_FETCH = global.fetch;

function catalog(): AerialOrthoCatalog {
  return {
    state: "verified",
    layers: [
      {
        custodyId: CUSTODY_ID,
        missionId: "33333333-3333-4333-8333-333333333333",
        projectId: null,
        missionTitle: "River crossing survey",
        projectName: "Bridge access study",
        collectedAt: "2026-08-22T10:00:00Z",
        heldAt: "2026-08-23T12:00:00Z",
        checksumSha256: "a".repeat(64),
        byteSize: 4096,
        bounds: [7.1, 45.1, 7.2, 45.2],
        nativeCrs: "EPSG:32632",
        pixelSizeM: 0.04,
      },
    ],
    notes: ["Orientation preview only."],
  };
}

function mockCatalog(payload: AerialOrthoCatalog = catalog()) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

function FailureControl() {
  const { setLayerFailure } = useAerialOrthoLayers();
  return (
    <button type="button" onClick={() => setLayerFailure(CUSTODY_ID, "signed link expired") }>
      Report failure
    </button>
  );
}

describe("aerial orthophoto layer selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockCatalog();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("starts every new preview off and saves only the planner's explicit choice", async () => {
    render(
      <AerialOrthoLayerProvider workspaceId={WORKSPACE_ID}>
        <AerialOrthoLayersPanel compact />
      </AerialOrthoLayerProvider>,
    );

    const checkbox = await screen.findByRole("checkbox", { name: /River crossing survey/ });
    expect(checkbox).not.toBeChecked();
    expect(readStoredAerialOrthoSelection(WORKSPACE_ID)).toEqual({});

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(readStoredAerialOrthoSelection(WORKSPACE_ID)).toEqual({ [CUSTODY_ID]: true });
    fireEvent.click(screen.getByText("Custody and placement"));
    expect(screen.getByText(/SHA-256 aaaaaaaaaaaa/)).toBeInTheDocument();
    expect(screen.getByText("Collected 2026-08-22")).toBeInTheDocument();
    expect(screen.getByText("Ground sample distance 0.04 m")).toBeInTheDocument();
    expect(screen.getByText("Native CRS EPSG:32632")).toBeInTheDocument();
  });

  it("clears a saved selection when the verified artifact leaves the catalog", async () => {
    window.localStorage.setItem(
      `openplan.cartographic.aerialOrthos.${WORKSPACE_ID}`,
      JSON.stringify({ [CUSTODY_ID]: true }),
    );
    mockCatalog({ state: "absent", layers: [], notes: ["No preview."] });

    render(
      <AerialOrthoLayerProvider workspaceId={WORKSPACE_ID}>
        <AerialOrthoLayersPanel compact />
      </AerialOrthoLayerProvider>,
    );

    await screen.findByText(/No map-ready aerial preview yet/);
    await waitFor(() => expect(readStoredAerialOrthoSelection(WORKSPACE_ID)).toEqual({}));
  });

  it("shows a failed catalog read as unreadable instead of no imagery", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({
        state: "unreadable",
        layers: [],
        notes: ["This is not a finding that no imagery exists."],
      }),
    })) as unknown as typeof fetch;

    render(
      <AerialOrthoLayerProvider workspaceId={WORKSPACE_ID}>
        <AerialOrthoLayersPanel compact />
      </AerialOrthoLayerProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/not a finding that no imagery exists/);
  });

  it("discloses a selected preview that cannot be resolved", async () => {
    render(
      <AerialOrthoLayerProvider workspaceId={WORKSPACE_ID}>
        <AerialOrthoLayersPanel compact />
        <FailureControl />
      </AerialOrthoLayerProvider>,
    );

    await screen.findByRole("checkbox", { name: /River crossing survey/ });
    fireEvent.click(screen.getByRole("button", { name: "Report failure" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load this preview: signed link expired/);
  });
});
