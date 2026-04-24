import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CartographicMapLegend } from "@/components/cartographic/cartographic-map-legend";
import {
  CartographicProvider,
  useCartographicLayers,
  type LayerKey,
} from "@/components/cartographic/cartographic-context";

function LayerToggles({
  toggleOffKeys,
  toggleOnKeys,
}: {
  toggleOffKeys: LayerKey[];
  toggleOnKeys: LayerKey[];
}) {
  const { setLayer } = useCartographicLayers();
  return (
    <div>
      {toggleOffKeys.map((key) => (
        <button
          key={`off-${key}`}
          type="button"
          data-testid={`toggle-off-${key}`}
          onClick={() => setLayer(key, false)}
        >
          off-{key}
        </button>
      ))}
      {toggleOnKeys.map((key) => (
        <button
          key={`on-${key}`}
          type="button"
          data-testid={`toggle-on-${key}`}
          onClick={() => setLayer(key, true)}
        >
          on-{key}
        </button>
      ))}
    </div>
  );
}

function renderLegend(
  toggleOff: LayerKey[] = [],
  toggleOn: LayerKey[] = [],
) {
  return render(
    <CartographicProvider>
      <LayerToggles toggleOffKeys={toggleOff} toggleOnKeys={toggleOn} />
      <CartographicMapLegend />
    </CartographicProvider>,
  );
}

describe("CartographicMapLegend", () => {
  it("renders the five default-on data-driven entries — equity stays hidden until toggled on", () => {
    renderLegend();

    expect(screen.getByRole("complementary", { name: "Map legend" })).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Community input")).toBeInTheDocument();
    expect(screen.getByText("Aerial AOIs")).toBeInTheDocument();
    expect(screen.getByText("Corridors by LOS")).toBeInTheDocument();
    expect(screen.getByText("RTP cycles")).toBeInTheDocument();
    expect(screen.queryByText("Zero-vehicle households")).not.toBeInTheDocument();
  });

  it("renders the corridor LOS ramp with four stops labeled A/B, C/D, E, F", () => {
    renderLegend();

    const corridorRampLabels = Array.from(
      document.querySelectorAll(".op-cart-legend__ramp-labels"),
    ).find((node) => node.textContent === "A/BC/DEF");
    expect(corridorRampLabels).toBeDefined();

    const corridorRamp = corridorRampLabels?.previousElementSibling;
    expect(corridorRamp?.classList.contains("op-cart-legend__ramp")).toBe(true);
    expect(corridorRamp?.children).toHaveLength(4);
  });

  it("renders the equity ramp with four stops labeled <5%, 5–10%, 10–15%, >15% when enabled", () => {
    renderLegend([], ["equity"]);

    fireEvent.click(screen.getByTestId("toggle-on-equity"));

    expect(screen.getByText("Zero-vehicle households")).toBeInTheDocument();

    const equityLabels = Array.from(
      document.querySelectorAll(".op-cart-legend__ramp-labels"),
    ).find((node) => node.textContent === "<5%5–10%10–15%>15%");
    expect(equityLabels).toBeDefined();

    const equityRamp = equityLabels?.previousElementSibling;
    expect(equityRamp?.classList.contains("op-cart-legend__ramp")).toBe(true);
    expect(equityRamp?.children).toHaveLength(4);
  });

  it("hides an entry when its layer is toggled off", () => {
    renderLegend(["projects", "corridors"]);

    fireEvent.click(screen.getByTestId("toggle-off-projects"));
    fireEvent.click(screen.getByTestId("toggle-off-corridors"));

    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Corridors by LOS")).not.toBeInTheDocument();
    expect(screen.getByText("Community input")).toBeInTheDocument();
    expect(screen.getByText("Aerial AOIs")).toBeInTheDocument();
    expect(screen.getByText("RTP cycles")).toBeInTheDocument();
  });

  it("returns null when every data-driven layer is toggled off (equity stays off by default)", () => {
    const { container } = renderLegend(["projects", "aerial", "corridors", "rtp", "engagement"]);

    fireEvent.click(screen.getByTestId("toggle-off-projects"));
    fireEvent.click(screen.getByTestId("toggle-off-aerial"));
    fireEvent.click(screen.getByTestId("toggle-off-corridors"));
    fireEvent.click(screen.getByTestId("toggle-off-rtp"));
    fireEvent.click(screen.getByTestId("toggle-off-engagement"));

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
