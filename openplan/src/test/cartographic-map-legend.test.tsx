import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CartographicMapLegend } from "@/components/cartographic/cartographic-map-legend";
import {
  CartographicProvider,
  useCartographicLayers,
  type LayerKey,
} from "@/components/cartographic/cartographic-context";

function LayerToggles({ toggleKeys }: { toggleKeys: LayerKey[] }) {
  const { setLayer } = useCartographicLayers();
  return (
    <div>
      {toggleKeys.map((key) => (
        <button
          key={key}
          type="button"
          data-testid={`toggle-off-${key}`}
          onClick={() => setLayer(key, false)}
        >
          off-{key}
        </button>
      ))}
    </div>
  );
}

function renderLegend(toggleOff: LayerKey[] = []) {
  return render(
    <CartographicProvider>
      <LayerToggles toggleKeys={toggleOff} />
      <CartographicMapLegend />
    </CartographicProvider>,
  );
}

describe("CartographicMapLegend", () => {
  it("renders the four data-driven entries when all layers are on (default)", () => {
    renderLegend();

    expect(screen.getByRole("complementary", { name: "Map legend" })).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Aerial AOIs")).toBeInTheDocument();
    expect(screen.getByText("Corridors by LOS")).toBeInTheDocument();
    expect(screen.getByText("RTP cycles")).toBeInTheDocument();
  });

  it("renders the LOS ramp with four stops labeled A/B, C/D, E, F", () => {
    renderLegend();

    const ramp = document.querySelector(".op-cart-legend__ramp");
    expect(ramp).not.toBeNull();
    expect(ramp?.children).toHaveLength(4);

    const labelRow = document.querySelector(".op-cart-legend__ramp-labels");
    expect(labelRow?.textContent).toBe("A/BC/DEF");
  });

  it("hides an entry when its layer is toggled off", () => {
    renderLegend(["projects", "corridors"]);

    fireEvent.click(screen.getByTestId("toggle-off-projects"));
    fireEvent.click(screen.getByTestId("toggle-off-corridors"));

    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Corridors by LOS")).not.toBeInTheDocument();
    expect(screen.getByText("Aerial AOIs")).toBeInTheDocument();
    expect(screen.getByText("RTP cycles")).toBeInTheDocument();
  });

  it("returns null when every data-driven layer is toggled off", () => {
    const { container } = renderLegend(["projects", "aerial", "corridors", "rtp"]);

    fireEvent.click(screen.getByTestId("toggle-off-projects"));
    fireEvent.click(screen.getByTestId("toggle-off-aerial"));
    fireEvent.click(screen.getByTestId("toggle-off-corridors"));
    fireEvent.click(screen.getByTestId("toggle-off-rtp"));

    expect(container.querySelector(".op-cart-legend")).toBeNull();
  });

  it("collapses the entry list when the header is clicked and restores on a second click", () => {
    renderLegend();

    const header = screen.getByRole("button", { name: /legend/i });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Projects")).toBeInTheDocument();

    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Corridors by LOS")).not.toBeInTheDocument();

    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });
});
