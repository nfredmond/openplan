/**
 * A LAYER A PLANNER JUST UPLOADED IS SWITCHED ON, AND IS DRAWN IN A COLOUR THEY
 * CAN FIND ON A MAP.
 *
 * ═══ THE DEFECT THIS CATCHES ═══
 *
 * The upload wizard called `createWorkspaceGisLayer({ name })` and nothing else,
 * so every layer this product has ever created took the column defaults:
 * `default_visible = FALSE`, `display_color = '#94a3b8'`, `display_line_width =
 * 1.5`. A planner finished the wizard, was told their layer was stored, went to
 * the map — and found it switched off. Switching it on drew a slate-grey
 * hairline over a grey basemap. That is the single largest contributor to
 * "uploaded layers are not visible", and it is one line of code.
 *
 * The column defaults are RIGHT and are not changed: a row created by anything
 * other than a person clicking "yes, add this layer" should not switch itself
 * on. What changed is that the wizard now states its intent instead of
 * inheriting a default meant for a different situation.
 *
 * ═══ WHY THIS DRIVES THE REAL WIZARD ═══
 *
 * Because the defect was never in a helper — it was in the ARGUMENT at one call
 * site. A test that called a factory function directly would have passed on the
 * day this bug shipped. So a real GeoJSON file goes through the real file
 * handler, the real coordinate-system path, the real confirmation step and the
 * real button, and the assertion is on what reached the network client.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  nextWorkspaceGisColor,
  WORKSPACE_GIS_COLOR_CYCLE,
  WORKSPACE_GIS_DEFAULT_STYLE,
} from "@/lib/cartographic/workspace-gis-default-style";
import type { WorkspaceGisLayerListing } from "@/lib/workspace-gis/types";

const createWorkspaceGisLayer = vi.fn();
const fetchWorkspaceGisLayers = vi.fn();
const runWorkspaceGisIngest = vi.fn();

vi.mock("@/lib/workspace-gis/client", () => ({
  createWorkspaceGisLayer: (input: unknown) => createWorkspaceGisLayer(input),
  fetchWorkspaceGisLayers: () => fetchWorkspaceGisLayers(),
  fetchWorkspaceGisLayer: vi.fn(async () => ({ layer: null, versions: [], notes: [] })),
  fetchWorkspaceGisLayerReferences: vi.fn(),
  deleteWorkspaceGisLayer: vi.fn(),
  updateWorkspaceGisLayer: vi.fn(),
  runWorkspaceGisIngest: (input: unknown) => runWorkspaceGisIngest(input),
  WorkspaceGisRequestError: class extends Error {},
}));

import { WorkspaceGisManager } from "@/components/workspace-gis/workspace-gis-manager";

const BIKE_NETWORK = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Idaho Maryland Rd" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-121.06, 39.22],
          [-121.02, 39.24],
        ],
      },
    },
  ],
};

function geojsonFile(name = "bike_network.geojson"): File {
  return new File([JSON.stringify(BIKE_NETWORK)], name, { type: "application/geo+json" });
}

function existingLayer(id: string, color: string): WorkspaceGisLayerListing {
  return {
    layer: {
      id,
      workspaceId: "ws-1",
      projectId: null,
      name: `Layer ${id}`,
      description: null,
      style: { color, opacity: 0.8, lineWidth: 2.5, labelField: null },
      defaultVisible: true,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      currentVersion: null,
    },
    notes: [],
  };
}

/** Runs the whole wizard against a workspace whose catalog is `catalog`. */
async function uploadThroughTheWizard(catalog: WorkspaceGisLayerListing[]) {
  fetchWorkspaceGisLayers.mockResolvedValue(catalog);
  createWorkspaceGisLayer.mockResolvedValue({ id: "new-layer" });
  runWorkspaceGisIngest.mockResolvedValue({ version: { id: "v1" } });

  render(<WorkspaceGisManager homeGeography={[-121.2, 39.1, -120.9, 39.35]} />);

  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("The wizard has no file input.");
  fireEvent.change(input, { target: { files: [geojsonFile()] } });

  // The real confirmation step — nothing is stored before a planner answers it.
  await screen.findByText("Does this look right?");
  fireEvent.click(screen.getByRole("button", { name: "Yes — add this layer" }));

  await waitFor(() => expect(createWorkspaceGisLayer).toHaveBeenCalled());
  return createWorkspaceGisLayer.mock.calls[0][0] as Record<string, unknown>;
}

describe("an uploaded layer starts visible", () => {
  beforeEach(() => {
    createWorkspaceGisLayer.mockReset();
    fetchWorkspaceGisLayers.mockReset();
    runWorkspaceGisIngest.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /** THE BUG, stated as an assertion. */
  it("asks for the layer to be on, rather than inheriting the column default", async () => {
    const sent = await uploadThroughTheWizard([]);

    expect(sent.defaultVisible).toBe(true);
    expect(WORKSPACE_GIS_DEFAULT_STYLE.defaultVisible).toBe(true);
  });

  it("gives the first layer in a workspace a colour from the cycle, not slate grey", async () => {
    const sent = await uploadThroughTheWizard([]);

    expect(sent.color).toBe(WORKSPACE_GIS_COLOR_CYCLE[0]);
    // The database default, which is what every layer used to get.
    expect(sent.color).not.toBe("#94a3b8");
  });

  it("draws it wide enough to read over a basemap", async () => {
    const sent = await uploadThroughTheWizard([]);

    expect(sent.lineWidth).toBe(WORKSPACE_GIS_DEFAULT_STYLE.lineWidth);
    expect(sent.lineWidth as number).toBeGreaterThan(1.5);
  });

  /**
   * THE BINDING IS VARIED, which is the only way to tell "reads the workspace's
   * colours" from "hardcodes the first one". Sixty tests in this repo once
   * passed a mutation that replaced a threaded value with a literal, because
   * every one of them used the same fixture.
   */
  it("picks a colour the workspace is not already using", async () => {
    const sent = await uploadThroughTheWizard([
      existingLayer("a", WORKSPACE_GIS_COLOR_CYCLE[0]),
      existingLayer("b", WORKSPACE_GIS_COLOR_CYCLE[1]),
    ]);

    expect(sent.color).toBe(WORKSPACE_GIS_COLOR_CYCLE[2]);
  });

  it("matches on colour regardless of how the hex was cased", async () => {
    const sent = await uploadThroughTheWizard([
      existingLayer("a", WORKSPACE_GIS_COLOR_CYCLE[0].toUpperCase()),
    ]);

    expect(sent.color).toBe(WORKSPACE_GIS_COLOR_CYCLE[1]);
  });

  /**
   * AND THE PLANNER IS TOLD WHERE TO GO AND LOOK.
   *
   * The library used to say a layer "becomes a toggle on the Layers panel on
   * Safety and Aerial" and then left the planner to find that page, that panel
   * and that row themselves. The link is the answer to the actual complaint —
   * "where do I look at my bike network over my city" — so it is asserted here,
   * beside the defaults, because a visible layer nobody can navigate to is the
   * same defect wearing different clothes.
   */
  it("offers a way to go and look at a stored layer", async () => {
    fetchWorkspaceGisLayers.mockResolvedValue([
      {
        ...existingLayer("layer-7", WORKSPACE_GIS_COLOR_CYCLE[0]),
        layer: {
          ...existingLayer("layer-7", WORKSPACE_GIS_COLOR_CYCLE[0]).layer,
          name: "Bike network",
          currentVersion: {
            id: "v1",
            layerId: "layer-7",
            versionNumber: 1,
            sourceFormat: "geojson",
            sourceFilename: "bike.geojson",
            sourceByteSize: 10,
            hasStoredSource: true,
            reprojectionEngine: "none",
            datumShiftNote: null,
            datumAcknowledgedBy: null,
            declaredFeatureCount: 12,
            sourceFeatureCount: 12,
            featureCount: 12,
            geometryKinds: ["LineString"],
            attributeFields: [],
            attributeEncoding: null,
            attributeEncodingIsFallback: false,
            srs: {
              authority: "EPSG",
              code: "4326",
              name: "WGS 84",
              basis: "geojson_rfc7946_default",
              assertedBy: null,
              assertedAt: null,
            },
            droppedFeatureCount: 0,
            truncated: false,
            bbox: [-121.1, 39.1, -120.9, 39.3],
            ingestStatus: "ready",
            ingestFailureReason: null,
            createdAt: "2026-08-12T00:00:00.000Z",
            finalizedAt: "2026-08-12T00:00:00.000Z",
          },
        },
      },
    ]);

    render(<WorkspaceGisManager />);

    const link = await screen.findByRole("link", { name: "Show on the map" });
    // The layer id rides in the URL — that is what the shell reads back to
    // switch this layer, and only this layer, on.
    expect(link.getAttribute("href")).toContain("layer=layer-7");
    expect(link.getAttribute("href")).toMatch(/^\/[a-z-]+\?/);
  });
});

/**
 * The colour cycle on its own. Small, but it is the thing that decides whether
 * two of an agency's layers can be told apart.
 */
describe("the workspace layer colour cycle", () => {
  it("hands out every colour before repeating one", () => {
    const chosen: string[] = [];
    for (let i = 0; i < WORKSPACE_GIS_COLOR_CYCLE.length; i += 1) {
      chosen.push(nextWorkspaceGisColor(chosen));
    }
    expect(new Set(chosen).size).toBe(WORKSPACE_GIS_COLOR_CYCLE.length);
  });

  it("keeps going once the palette is exhausted rather than returning nothing", () => {
    const all = [...WORKSPACE_GIS_COLOR_CYCLE];
    const next = nextWorkspaceGisColor(all);
    expect(WORKSPACE_GIS_COLOR_CYCLE).toContain(next);
  });

  it("carries no place, agency or jurisdiction in it", () => {
    for (const color of WORKSPACE_GIS_COLOR_CYCLE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
