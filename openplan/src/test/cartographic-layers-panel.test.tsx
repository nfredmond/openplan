import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartographicLayersPanel } from "@/components/cartographic/cartographic-layers-panel";
import {
  CartographicProvider,
  useCartographicLayerStatus,
  type LayerKey,
} from "@/components/cartographic/cartographic-context";

const ORIGINAL_FETCH = global.fetch;

function mockFetchJson(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  }) as unknown as typeof fetch;
}

function renderPanel() {
  return render(
    <CartographicProvider>
      <CartographicLayersPanel />
    </CartographicProvider>
  );
}

describe("CartographicLayersPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("renders all layer labels before counts resolve", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    renderPanel();

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Project areas")).toBeInTheDocument();
    expect(screen.getByText("Aerial missions")).toBeInTheDocument();
    expect(screen.getByText("Study corridors")).toBeInTheDocument();
    expect(screen.getByText("RTP cycles")).toBeInTheDocument();
    expect(screen.getByText("Engagement pins")).toBeInTheDocument();
    expect(screen.getByText("Equity priority")).toBeInTheDocument();
    // "acquired" is in the label, not just the notes: the crash layer draws what
    // this workspace pulled into its own record, never everything a source knows.
    expect(screen.getByText("Crashes (acquired)")).toBeInTheDocument();
    // No chips while the fetch is in flight.
    expect(document.querySelectorAll(".op-cart-layer-item__chip")).toHaveLength(0);
  });

  it("renders live counts on every data-driven layer chip after fetch resolves", async () => {
    mockFetchJson({
      projects: 1,
      projectAreas: 7,
      aerial: 3,
      corridors: 2,
      rtp: 1,
      equity: 4,
      engagement: 5,
      crashes: 912,
    });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBeGreaterThan(0);
    });

    const chips = Array.from(document.querySelectorAll(".op-cart-layer-item__chip")).map(
      (node) => node.textContent
    );
    expect(chips).toContain("1");
    expect(chips).toContain("7");
    expect(chips).toContain("3");
    expect(chips).toContain("2");
    expect(chips).toContain("4");
    expect(chips).toContain("5");
    expect(chips).toContain("912");
    // Two "1" chips (projects + rtp) plus one each for areas, aerial, corridors,
    // equity, engagement and crashes.
    expect(chips).toHaveLength(8);
  });

  it("shows a 0 chip when the workspace has the layer but no rows", async () => {
    mockFetchJson({
      projects: 0,
      projectAreas: 0,
      aerial: 0,
      corridors: 0,
      rtp: 0,
      equity: 0,
      engagement: 0,
      crashes: 0,
    });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(8);
    });

    const chips = Array.from(document.querySelectorAll(".op-cart-layer-item__chip")).map(
      (node) => node.textContent
    );
    expect(chips).toEqual(["0", "0", "0", "0", "0", "0", "0", "0"]);
  });

  /**
   * A crash count of `null` is the counts route saying "no acquisition has run",
   * which is a different fact from "zero crashes". The chip must disappear
   * rather than render a zero the record cannot support.
   */
  it("renders no crash chip when the crash count came back not-known", async () => {
    mockFetchJson({
      projects: 1,
      projectAreas: 1,
      aerial: 1,
      corridors: 1,
      rtp: 1,
      equity: 1,
      engagement: 1,
      crashes: null,
    });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(7);
    });

    const crashRow = screen.getByText("Crashes (acquired)").closest("label");
    expect(crashRow?.querySelector(".op-cart-layer-item__chip")).toBeNull();
  });

  it("hides the chip for a layer whose count came back null (partial failure)", async () => {
    mockFetchJson({
      projects: 1,
      projectAreas: 1,
      aerial: null,
      corridors: 2,
      rtp: 1,
      equity: 4,
      engagement: 5,
      crashes: 6,
    });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(7);
    });

    const chips = Array.from(document.querySelectorAll(".op-cart-layer-item__chip")).map(
      (node) => node.textContent
    );
    expect(chips).toContain("1");
    expect(chips).toContain("2");
    expect(chips).toContain("4");
    expect(chips).toContain("5");
    expect(chips).not.toContain("null");
  });

  it("formats counts of 1000 or more using compact notation", async () => {
    mockFetchJson({
      projects: 3800,
      projectAreas: 1,
      aerial: 1,
      corridors: 1,
      rtp: 1,
      equity: 1,
      engagement: 1,
      crashes: 1,
    });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(8);
    });

    const chips = Array.from(document.querySelectorAll(".op-cart-layer-item__chip")).map(
      (node) => node.textContent
    );
    expect(chips).toContain("3.8K");
  });

  it("renders no chips when the counts endpoint returns an error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    }) as unknown as typeof fetch;

    renderPanel();

    // The panel fetches counts AND the equity layer's coverage notes; assert the
    // endpoint rather than a call tally, so adding a request cannot fail a test
    // about chips.
    await waitFor(() => {
      const urls = (global.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(
        (call) => call[0]
      );
      expect(urls).toContain("/api/map-features/counts");
    });

    // No chip nodes render on fetch failure.
    expect(document.querySelectorAll(".op-cart-layer-item__chip")).toHaveLength(0);
  });

  /**
   * Coverage notes come from the map backdrop's own fetches via context, not a
   * second request from the panel, and they render for EVERY layer regardless
   * of its toggle — chips render regardless of the toggle, so a number without
   * its explanation is the unexplained figure this disclosure exists to prevent.
   */
  describe("layer coverage notes", () => {
    function renderWithStatus(
      workspaceId: string | null,
      statuses: Array<[LayerKey, { workspaceId: string | null; notes: string[]; failed: boolean }]>
    ) {
      function Seed() {
        const { registerLayerStatus } = useCartographicLayerStatus();
        useEffect(() => {
          for (const [key, status] of statuses) registerLayerStatus(key, status);
        }, [registerLayerStatus]);
        return null;
      }
      return render(
        <CartographicProvider>
          <Seed />
          <CartographicLayersPanel workspaceId={workspaceId} />
        </CartographicProvider>
      );
    }

    it("shows a truncation note for a layer that is toggled OFF", async () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

      // equity defaults to off.
      renderWithStatus("ws-1", [
        ["equity", { workspaceId: "ws-1", notes: ["Showing 500 of 2,498 census tracts."], failed: false }],
      ]);

      await waitFor(() => {
        expect(screen.getByText(/Showing 500 of 2,498 census tracts\./)).toBeInTheDocument();
      });
      const equityCheckbox = screen
        .getByText("Equity priority")
        .closest("label")
        ?.querySelector("input") as HTMLInputElement;
      expect(equityCheckbox.checked).toBe(false);
    });

    it("shows a failed layer as failed, not as empty", async () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

      renderWithStatus("ws-1", [
        ["projects", { workspaceId: "ws-1", notes: ["Projects: this layer could not be loaded."], failed: true }],
      ]);

      await waitFor(() => {
        expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
      });
    });

    it("drops a note recorded for a different workspace", async () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

      renderWithStatus("ws-2", [
        ["equity", { workspaceId: "ws-1", notes: ["Scoped to the OLD workspace's county."], failed: false }],
      ]);

      await waitFor(() => {
        expect(screen.getByText("Equity priority")).toBeInTheDocument();
      });
      // A switch is a soft RSC refresh; a stale sentence would name the wrong
      // jurisdiction under the new workspace's map.
      expect(screen.queryByText(/OLD workspace/)).toBeNull();
      expect(document.querySelector(".op-cart-layers__notes")).toBeNull();
    });

    it("renders no note block when every layer is complete", async () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

      renderWithStatus("ws-1", [["projects", { workspaceId: "ws-1", notes: [], failed: false }]]);

      await waitFor(() => {
        expect(screen.getByText("Projects")).toBeInTheDocument();
      });
      expect(document.querySelector(".op-cart-layers__notes")).toBeNull();
    });
  });
});
