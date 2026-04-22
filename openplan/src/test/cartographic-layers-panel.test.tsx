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
    expect(screen.getByText("Equity priority")).toBeInTheDocument();
    // No chips while the fetch is in flight.
    expect(document.querySelectorAll(".op-cart-layer-item__chip")).toHaveLength(0);
  });

  it("renders live counts on the five data-driven layer chips after fetch resolves", async () => {
    mockFetchJson({ projects: 1, aerial: 3, corridors: 2, rtp: 1, equity: 4 });

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
    // Two "1" chips (projects + rtp) + one "3" + one "2" + one "4" = 5 total.
    // engagement / transit / crashes still have no data source; no chips.
    expect(chips).toHaveLength(5);
  });

  it("shows a 0 chip when the workspace has the layer but no rows", async () => {
    mockFetchJson({ projects: 0, aerial: 0, corridors: 0, rtp: 0, equity: 0 });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(5);
    });

    const chips = Array.from(document.querySelectorAll(".op-cart-layer-item__chip")).map(
      (node) => node.textContent
    );
    expect(chips).toEqual(["0", "0", "0", "0", "0"]);
  });

  it("hides the chip for a layer whose count came back null (partial failure)", async () => {
    mockFetchJson({ projects: 1, aerial: null, corridors: 2, rtp: 1, equity: 4 });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(4);
    });

    const chips = Array.from(document.querySelectorAll(".op-cart-layer-item__chip")).map(
      (node) => node.textContent
    );
    expect(chips).toContain("1");
    expect(chips).toContain("2");
    expect(chips).toContain("4");
    expect(chips).not.toContain("null");
  });

  it("formats counts of 1000 or more using compact notation", async () => {
    mockFetchJson({ projects: 3800, aerial: 1, corridors: 1, rtp: 1, equity: 1 });

    renderPanel();

    await waitFor(() => {
      expect(document.querySelectorAll(".op-cart-layer-item__chip").length).toBe(5);
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

    await waitFor(() => {
      expect((global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    });

    // No chip nodes render on fetch failure.
    expect(document.querySelectorAll(".op-cart-layer-item__chip")).toHaveLength(0);
  });
});
