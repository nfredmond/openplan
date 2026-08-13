import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngagementContextLayersPanel } from "@/components/engagement/engagement-context-layers-panel";
import { WORKSPACE_ROLES, canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { contextLayerPublicationWarning, type ContextLayerSummary } from "@/lib/engagement/context-layers";
import {
  confirmDestructiveAction,
  confirmDialogText,
  declineConfirmation,
} from "./helpers/confirm-dialog";

/**
 * The operator's side of the seam: the control has to render for exactly the
 * roles the route accepts, and the screen has to tell the truth about what it
 * is doing.
 *
 * The role assertions are driven from `role-matrix.ts` rather than from a hand
 * written list, because the failure that matters is the panel and the route
 * DISAGREEING — a button that appears for a viewer and then 403s is a worse
 * experience than no button, and a button that is hidden from a member who is
 * allowed to press it is a capability nobody can reach.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

function layer(overrides: Partial<ContextLayerSummary> = {}): ContextLayerSummary {
  return {
    id: "layer-1",
    campaign_id: CAMPAIGN_ID,
    workspace_id: "22222222-2222-4222-8222-222222222222",
    name: "Proposed alignment",
    description: null,
    source_format: "shapefile_zip",
    source_filename: "alignment.zip",
    source_byte_size: 4096,
    srs_authority: "EPSG",
    srs_code: "4326",
    srs_name: "GCS_WGS_1984",
    srs_basis: "prj_file",
    geometry_kinds: ["LineString"],
    feature_count: 500,
    source_feature_count: 2000,
    dropped_feature_count: 0,
    truncated: true,
    bbox: [-95.4, 29.6, -95.2, 29.9],
    display_color: "#38bdf8",
    sort_order: 0,
    visible_to_participants: false,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("who gets the upload control", () => {
  it("renders it for every role the route's action allows, and for no other", () => {
    for (const role of WORKSPACE_ROLES) {
      const canWrite = canAccessWorkspaceAction("engagement.write", role);
      const { unmount } = render(
        <EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[]} canWrite={canWrite} />
      );

      const uploadButton = screen.queryByRole("button", { name: /add layer/i });
      expect(Boolean(uploadButton), `role ${role} (engagement.write = ${canWrite})`).toBe(canWrite);
      unmount();
    }
  });

  it("still shows a viewer what the campaign is publishing", () => {
    render(
      <EngagementContextLayersPanel
        campaignId={CAMPAIGN_ID}
        layers={[layer({ visible_to_participants: true })]}
        canWrite={false}
      />
    );

    expect(screen.getByText("Proposed alignment")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show to participants/i })).not.toBeInTheDocument();
  });
});

describe("what the panel says about each layer", () => {
  it("shows where the coordinate system came from, in the words that distinguish the cases", () => {
    render(<EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[layer()]} canWrite />);

    // Read from the file — different evidence from "the specification says so",
    // and the operator should be able to tell which they got.
    expect(screen.getByText(/read from the shapefile's \.prj file/i)).toBeInTheDocument();
    expect(screen.getByText(/GCS_WGS_1984/)).toBeInTheDocument();
  });

  it("says a truncated layer is short, rather than drawing fewer shapes quietly", () => {
    render(<EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[layer()]} canWrite />);
    expect(screen.getByText(/showing 500 of 2,000 shapes/)).toBeInTheDocument();
  });

  it("counts in the unit it names, so the denominator cannot exceed what was counted", () => {
    // The noun matters. These counts are counts of DRAWN GEOMETRIES: a GeoJSON
    // Feature carrying a GeometryCollection is expanded into one per member at
    // import, so "showing 500 of 2,000 features" could name more features than
    // the operator's file contained. Both sides of the ratio are shapes, and the
    // sentence has to say so — a wrong number on a disclosure surface is the one
    // place a rounding of the vocabulary is not cosmetic.
    render(<EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[layer()]} canWrite />);
    expect(screen.queryByText(/showing 500 of 2,000 features/)).not.toBeInTheDocument();
    expect(screen.getByText(/500 shapes drawn/)).toBeInTheDocument();
  });

  it("distinguishes a read that failed from a campaign with no layers", () => {
    const { rerender } = render(
      <EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[]} canWrite />
    );
    expect(screen.getByText(/No map layers yet/)).toBeInTheDocument();

    rerender(
      <EngagementContextLayersPanel
        campaignId={CAMPAIGN_ID}
        layers={[]}
        readFailure="connection reset"
        canWrite
      />
    );
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/not a finding/)).toBeInTheDocument();
    expect(screen.queryByText(/No map layers yet/)).not.toBeInTheDocument();
  });
});

describe("controlling the draw order", () => {
  it("renumbers the list so a fill uploaded last stops covering the alignment", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ layer: {} }), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    render(
      <EngagementContextLayersPanel
        campaignId={CAMPAIGN_ID}
        layers={[
          layer({ id: "layer-1", name: "Proposed alignment" }),
          layer({ id: "layer-2", name: "Parcels" }),
        ]}
        canWrite
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Draw Parcels earlier/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    // Both rows start at sort_order 0, so swapping their two values would change
    // nothing at all; the list is renumbered to its array positions instead.
    // Only the rows whose number actually moves are written — Parcels is
    // already 0 and stays there, so one request is the whole change.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("layer-1");
    expect(JSON.parse(String(init.body))).toEqual({ sortOrder: 1 });
  });

  it("does not offer to move the layer that is already at the end", () => {
    render(
      <EngagementContextLayersPanel
        campaignId={CAMPAIGN_ID}
        layers={[layer({ id: "layer-1", name: "Proposed alignment" })]}
        canWrite
      />
    );

    expect(screen.getByRole("button", { name: /Draw Proposed alignment earlier/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Draw Proposed alignment later/i })).toBeDisabled();
  });
});

describe("publishing a layer", () => {
  it("asks first, in words that name the audience", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ layer: {} }), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    render(<EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[layer()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /show to participants/i }));

    // The exact sentence, from the same function the route echoes back, so the
    // warning the operator reads and the one the API states cannot drift. It is
    // now IN the page rather than in a browser dialog, so the assertion reads
    // the text an operator actually sees.
    expect(await confirmDialogText()).toContain(contextLayerPublicationWarning("Proposed alignment"));
    await confirmDestructiveAction("Show it to participants");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/engagement/campaigns/${CAMPAIGN_ID}/context-layers/layer-1`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ visibleToParticipants: true });
  });

  it("does nothing when the operator declines", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    render(<EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[layer()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /show to participants/i }));
    await declineConfirmation();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not re-ask when a layer is being taken back down", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ layer: {} }), { status: 200 })
    ) as unknown as typeof globalThis.fetch;

    render(
      <EngagementContextLayersPanel
        campaignId={CAMPAIGN_ID}
        layers={[layer({ visible_to_participants: true })]}
        canWrite
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /hide from participants/i }));

    // Un-publishing needs no warning; it is the safe direction.
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the route's own refusal rather than a generic failure", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "No such map layer" }), { status: 404 })
    ) as unknown as typeof globalThis.fetch;

    render(<EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[layer()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /show to participants/i }));
    await confirmDestructiveAction("Show it to participants");

    // The API's message already names the real cause; replacing it here with
    // "something went wrong" throws away the only useful thing on screen.
    expect(await screen.findByText("No such map layer")).toBeInTheDocument();
  });
});

describe("removing a layer", () => {
  /**
   * FOUND BY MUTATION: making the panel ignore the answer broke nothing, because
   * removal had only ever been driven with "yes". A layer removed by accident
   * takes its uploaded geometry with it and cannot be undone from here.
   */
  it("names the layer and removes nothing when the operator declines", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    render(<EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[layer()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /remove proposed alignment/i }));

    expect(await confirmDialogText()).toContain("Proposed alignment");
    await declineConfirmation();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("deletes through the layer's own route once the operator agrees", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    render(<EngagementContextLayersPanel campaignId={CAMPAIGN_ID} layers={[layer()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /remove proposed alignment/i }));
    await confirmDestructiveAction("Remove this layer");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/engagement/campaigns/${CAMPAIGN_ID}/context-layers/layer-1`);
    expect(init.method).toBe("DELETE");
  });
});
