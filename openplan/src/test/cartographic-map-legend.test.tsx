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
  it("renders the six default-on data-driven entries — equity and crashes stay hidden until toggled on", () => {
    renderLegend();

    expect(screen.getByRole("complementary", { name: "Map legend" })).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Project areas")).toBeInTheDocument();
    expect(screen.getByText("Community input")).toBeInTheDocument();
    expect(screen.getByText("Aerial AOIs")).toBeInTheDocument();
    expect(screen.getByText("Corridors by LOS")).toBeInTheDocument();
    expect(screen.getByText("RTP cycles")).toBeInTheDocument();
    expect(screen.queryByText("Zero-vehicle households")).not.toBeInTheDocument();
    expect(screen.queryByText("Crash severity")).not.toBeInTheDocument();
  });

  /**
   * All four KABCO buckets are keyed, including the serious-injury bucket no
   * currently storable source can populate. That is deliberate: the ramp
   * documents what a colour MEANS, while the layers panel's coverage notes say
   * which buckets the acquired sources could actually distinguish. Dropping the
   * bucket would leave a future full-KABCO source painting an unlabelled colour.
   */
  it("keys every crash severity bucket when the crash layer is enabled", () => {
    renderLegend([], ["crashes"]);

    fireEvent.click(screen.getByTestId("toggle-on-crashes"));

    expect(screen.getByText("Crash severity")).toBeInTheDocument();

    const severityLabels = Array.from(
      document.querySelectorAll(".op-cart-legend__ramp-labels"),
    ).find((node) => node.textContent === "FatalSeriousInjuryPDO");
    expect(severityLabels).toBeDefined();

    const severityRamp = severityLabels?.previousElementSibling;
    expect(severityRamp?.classList.contains("op-cart-legend__ramp")).toBe(true);
    expect(severityRamp?.children).toHaveLength(4);
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

  it("returns null when every data-driven layer is toggled off (equity and crashes stay off by default)", () => {
    const { container } = renderLegend([
      "projects",
      "projectAreas",
      "aerial",
      "corridors",
      "rtp",
      "engagement",
    ]);

    fireEvent.click(screen.getByTestId("toggle-off-projects"));
    fireEvent.click(screen.getByTestId("toggle-off-projectAreas"));
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
