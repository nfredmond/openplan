import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartographicLayersPanel } from "@/components/cartographic/cartographic-layers-panel";
import {
  CartographicProvider,
  readStoredWorkspaceLayerVisibility,
  useWorkspaceMapLayers,
} from "@/components/cartographic/cartographic-context";
import type {
  WorkspaceGisLayerListing,
  WorkspaceGisVersion,
} from "@/lib/workspace-gis/types";

/**
 * A WORKSPACE'S OWN UPLOADED LAYERS HAVE TO REACH THE PANEL A PLANNER USES.
 *
 * This lane's whole promise is "upload it once, toggle it on any map". The
 * failure mode it is guarding against is this repository's most-repeated defect
 * class: complete, tested capability that no person can reach. A layer that is
 * stored, served, styled and drawable but never listed in the Layers panel is
 * exactly that — and every unit test of the store would still be green.
 *
 * So this renders the REAL `CartographicLayersPanel` inside the REAL provider
 * and drives it through the REAL registration function the map backdrop calls.
 * Nothing here is a hand-written fixture of the panel's own output.
 */

const ORIGINAL_FETCH = global.fetch;

function version(overrides: Partial<WorkspaceGisVersion> = {}): WorkspaceGisVersion {
  return {
    id: "version-1",
    layerId: "layer-1",
    versionNumber: 2,
    sourceFormat: "shapefile_zip",
    sourceFilename: "parcels.zip",
    sourceByteSize: 1024,
    hasStoredSource: true,
    srs: {
      authority: "EPSG",
      code: "2226",
      name: "NAD83 / California zone 2 (ftUS)",
      basis: "prj_file",
      assertedBy: null,
      assertedAt: null,
    },
    reprojectionEngine: "openplan",
    datumShiftNote: null,
    datumAcknowledgedBy: null,
    geometryKinds: ["Polygon"],
    attributeFields: [{ name: "APN", type: "C" }],
    attributeEncoding: "utf-8",
    attributeEncodingIsFallback: false,
    declaredFeatureCount: 214391,
    featureCount: 214391,
    sourceFeatureCount: 214391,
    droppedFeatureCount: 0,
    truncated: false,
    bbox: [-121.1, 39.1, -120.9, 39.3],
    ingestStatus: "ready",
    ingestFailureReason: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    finalizedAt: "2026-08-12T00:05:00.000Z",
    ...overrides,
  };
}

function listing(
  overrides: {
    id?: string;
    name?: string;
    color?: string;
    defaultVisible?: boolean;
    currentVersion?: WorkspaceGisVersion | null;
    notes?: string[];
  } = {}
): WorkspaceGisLayerListing {
  const id = overrides.id ?? "layer-1";
  return {
    layer: {
      id,
      workspaceId: "ws-1",
      projectId: null,
      name: overrides.name ?? "Parcels",
      description: null,
      style: {
        color: overrides.color ?? "#c1440e",
        opacity: 0.8,
        lineWidth: 1.5,
        labelField: null,
      },
      defaultVisible: overrides.defaultVisible ?? false,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      currentVersion:
        overrides.currentVersion === undefined
          ? version({ layerId: id })
          : overrides.currentVersion,
    },
    notes: overrides.notes ?? [],
  };
}

/** Drives the real registration path the map backdrop uses. */
function Seed({
  listings,
  workspaceId,
  statuses = [],
}: {
  listings: WorkspaceGisLayerListing[];
  workspaceId: string | null;
  statuses?: Array<[string, { workspaceId: string | null; notes: string[]; failed: boolean }]>;
}) {
  const { registerWorkspaceLayers, registerWorkspaceLayerStatus } = useWorkspaceMapLayers();
  useEffect(() => {
    registerWorkspaceLayers(listings, workspaceId);
    for (const [layerId, status] of statuses) registerWorkspaceLayerStatus(layerId, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerWorkspaceLayers, registerWorkspaceLayerStatus]);
  return null;
}

function renderPanel(
  listings: WorkspaceGisLayerListing[],
  workspaceId: string | null = "ws-1",
  statuses: Array<[string, { workspaceId: string | null; notes: string[]; failed: boolean }]> = []
) {
  return render(
    <CartographicProvider>
      <Seed listings={listings} workspaceId={workspaceId} statuses={statuses} />
      <CartographicLayersPanel workspaceId={workspaceId} />
    </CartographicProvider>
  );
}

describe("a workspace's own layers reach the shell backdrop's panel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    // The panel's own counts fetch is left hanging: this file is about the
    // workspace-layer rows, and a resolved counts payload would add chips that
    // have nothing to do with them.
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    window.localStorage.clear();
  });

  it("lists the planner's own layer by the planner's own name", async () => {
    renderPanel([listing({ name: "Bike network" })]);

    await waitFor(() => {
      expect(screen.getByText("Bike network")).toBeInTheDocument();
    });
    // Under its own heading, so a planner can tell a file they uploaded from a
    // record OpenPlan keeps.
    expect(screen.getByText("Your map layers")).toBeInTheDocument();
  });

  it("renders no workspace-layer group at all when the workspace has uploaded none", async () => {
    renderPanel([]);

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeInTheDocument();
    });
    expect(screen.queryByText("Your map layers")).toBeNull();
  });

  it("draws the swatch in the layer's own stored colour", async () => {
    renderPanel([listing({ name: "Zoning", color: "#3366ff" })]);

    await waitFor(() => {
      expect(screen.getByText("Zoning")).toBeInTheDocument();
    });
    const swatch = screen
      .getByText("Zoning")
      .closest("label")
      ?.querySelector(".op-cart-layer-item__swatch") as HTMLElement;
    // Not a generic bullet: with four layers on a map, the swatch is how the
    // list maps onto what is drawn.
    expect(swatch).toBeTruthy();
    expect(swatch.style.backgroundColor).toBe("rgb(51, 102, 255)");
  });

  it("starts a layer where the person who uploaded it put it", async () => {
    renderPanel([
      listing({ id: "on", name: "City limits", defaultVisible: true }),
      listing({ id: "off", name: "Parcels", defaultVisible: false }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("City limits")).toBeInTheDocument();
    });

    const checkboxFor = (label: string) =>
      screen.getByText(label).closest("label")?.querySelector("input") as HTMLInputElement;

    expect(checkboxFor("City limits").checked).toBe(true);
    expect(checkboxFor("Parcels").checked).toBe(false);
  });

  /**
   * A layer with no finished upload draws nothing, and the checkbox above it
   * would otherwise be a control that does nothing with no explanation.
   */
  it("says so when a layer has no finished upload, rather than showing a zero", async () => {
    renderPanel([listing({ name: "Trails", currentVersion: null })]);

    await waitFor(() => {
      expect(screen.getByText("Trails")).toBeInTheDocument();
    });
    expect(screen.getByText(/No finished upload yet/)).toBeInTheDocument();
    // No chip: a "0" here reads as an empty file rather than as no upload.
    const row = screen.getByText("Trails").closest("label");
    expect(row?.querySelector(".op-cart-layer-item__chip")).toBeNull();
  });

  it("puts a workspace layer's coverage note in the same block as the built-in layers'", async () => {
    renderPanel(
      [listing({ name: "Parcels" })],
      "ws-1",
      [["layer-1", { workspaceId: "ws-1", notes: ["Parcels: 214,391 shapes in this view."], failed: false }]]
    );

    await waitFor(() => {
      expect(screen.getByText(/214,391 shapes in this view/)).toBeInTheDocument();
    });
    expect(screen.getByText("1 coverage note")).toBeInTheDocument();
  });

  /**
   * Switching workspace is a soft RSC refresh that does not remount this tree. A
   * note recorded against the previous workspace's layer, rendered under the new
   * workspace's map, would be an affirmatively false claim about the agency the
   * planner is now looking at.
   */
  it("drops a workspace layer's note recorded for a different workspace", async () => {
    renderPanel(
      [listing({ name: "Parcels" })],
      "ws-2",
      [["layer-1", { workspaceId: "ws-1", notes: ["Parcels: 9,999 shapes in the OLD workspace."], failed: false }]]
    );

    await waitFor(() => {
      expect(screen.getByText("Parcels")).toBeInTheDocument();
    });
    expect(screen.queryByText(/OLD workspace/)).toBeNull();
    expect(document.querySelector(".op-cart-layers__notes")).toBeNull();
  });

  /**
   * Each planner's own toggles, remembered per browser and per WORKSPACE. The
   * workspace key is what stops one agency's choices reaching another's layers
   * across a soft refresh.
   */
  it("remembers a planner's toggle against the workspace it was made in", async () => {
    window.localStorage.setItem(
      "openplan.cartographic.workspaceLayers.ws-1",
      JSON.stringify({ "layer-1": true })
    );

    renderPanel([listing({ name: "Parcels", defaultVisible: false })], "ws-1");

    await waitFor(() => {
      expect(screen.getByText("Parcels")).toBeInTheDocument();
    });
    const checkbox = screen
      .getByText("Parcels")
      .closest("label")
      ?.querySelector("input") as HTMLInputElement;
    // The remembered choice beats `defaultVisible`, which is false here.
    expect(checkbox.checked).toBe(true);

    // And a choice stored under a DIFFERENT workspace does not reach this one.
    expect(readStoredWorkspaceLayerVisibility("ws-2")).toEqual({});
  });
});
