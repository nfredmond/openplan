import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartographicLayersPanel } from "@/components/cartographic/cartographic-layers-panel";
import { CartographicProvider } from "@/components/cartographic/cartographic-context";

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
    expect(screen.getByText("Aerial missions")).toBeInTheDocument();
    expect(screen.getByText("Study corridors")).toBeInTheDocument();
    expect(screen.getByText("RTP cycles")).toBeInTheDocument();
    expect(screen.getByText("Engagement pins")).toBeInTheDocument();
    expect(screen.getByText("Equity priority")).toBeInTheDocument();
    // No chips while the fetch is in flight.
    expect(document.querySelectorAll(".op-cart-layer-item__chip")).toHaveLength(0);
  });

  it("renders live counts on the six data-driven layer chips after fetch resolves", async () => {
    mockFetchJson({ projects: 1, aerial: 3, corridors: 2, rtp: 1, equity: 4, engagement: 5 });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBeGreaterThan(0);
    });

    const chips = Array.from(document.querySelectorAll(".op-cart-layer-item__chip")).map(
      (node) => node.textContent
    );
    expect(chips).toContain("1");
    expect(chips).toContain("3");
    expect(chips).toContain("2");
    expect(chips).toContain("4");
    expect(chips).toContain("5");
    // Two "1" chips (projects + rtp) + one "3" + one "2" + one "4" + one "5" = 6 total.
    // transit / crashes still have no data source; no chips.
    expect(chips).toHaveLength(6);
  });

  it("shows a 0 chip when the workspace has the layer but no rows", async () => {
    mockFetchJson({ projects: 0, aerial: 0, corridors: 0, rtp: 0, equity: 0, engagement: 0 });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(6);
    });

    const chips = Array.from(document.querySelectorAll(".op-cart-layer-item__chip")).map(
      (node) => node.textContent
    );
    expect(chips).toEqual(["0", "0", "0", "0", "0", "0"]);
  });

  it("hides the chip for a layer whose count came back null (partial failure)", async () => {
    mockFetchJson({ projects: 1, aerial: null, corridors: 2, rtp: 1, equity: 4, engagement: 5 });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(5);
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
    mockFetchJson({ projects: 3800, aerial: 1, corridors: 1, rtp: 1, equity: 1, engagement: 1 });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(6);
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
   * The equity chip renders for every row regardless of the checkbox, and the
   * equity layer is OFF by default — so a number without its explanation is
   * exactly the unexplained figure this disclosure exists to prevent. The note
   * must therefore NOT be gated on the layer being toggled on.
   */
  describe("equity coverage notes", () => {
    function mockByUrl(counts: unknown, tracts: unknown) {
      global.fetch = vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => (String(url).includes("census-tracts") ? tracts : counts),
        })
      ) as unknown as typeof fetch;
    }

    it("shows why the equity layer is empty when no home geography is set", async () => {
      mockByUrl(
        { projects: 1, aerial: 0, corridors: 0, rtp: 0, equity: null, engagement: 0 },
        {
          scopeState: "geography_not_set",
          coverageNotes: [
            "Equity tracts are not shown because this workspace has not set a home geography, so there is nothing to scope them to.",
          ],
        }
      );

      renderPanel();

      await waitFor(() => {
        expect(screen.getByText(/has not set a home geography/)).toBeInTheDocument();
      });
      // The equity layer is off by default; the note appears anyway.
      const equityCheckbox = screen.getByText("Equity priority").closest("label")?.querySelector("input");
      expect((equityCheckbox as HTMLInputElement).checked).toBe(false);
    });

    it("shows the truncation note when the county has more tracts than the map draws", async () => {
      mockByUrl(
        { projects: 0, aerial: 0, corridors: 0, rtp: 0, equity: 2498, engagement: 0 },
        {
          scopeState: "home_geography",
          coverageNotes: ["Showing 500 of 2,498 census tracts in Los Angeles County, CA — the first 500 by tract ID."],
        }
      );

      renderPanel();

      await waitFor(() => {
        expect(screen.getByText(/Showing 500 of 2,498 census tracts/)).toBeInTheDocument();
      });
    });

    it("renders no note block when the layer response carries none", async () => {
      mockByUrl(
        { projects: 0, aerial: 0, corridors: 0, rtp: 0, equity: 0, engagement: 0 },
        { scopeState: "home_geography", coverageNotes: [] }
      );

      renderPanel();

      await waitFor(() => {
        expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBeGreaterThan(0);
      });
      expect(document.querySelector(".op-cart-layers__notes")).toBeNull();
    });
  });
});
