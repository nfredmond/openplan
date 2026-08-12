import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CartographicMapLegend } from "@/components/cartographic/cartographic-map-legend";
import {
  CartographicProvider,
  useCartographicLayers,
  type LayerKey,
} from "@/components/cartographic/cartographic-context";
import {
  CRASH_SEVERITY_LEGEND_LABEL,
  CRASH_SEVERITY_LEGEND_ORDER,
} from "@/lib/cartographic/crash-severity-palette";
import {
  TRANSIT_SERVICE_TIER_COLOR,
  TRANSIT_SERVICE_TIER_LEGEND_LABEL,
  TRANSIT_SERVICE_TIER_LEGEND_ORDER,
  TRANSIT_SERVICE_TIER_LEGEND_TITLE,
} from "@/lib/cartographic/transit-service-tier-palette";

/** jsdom normalises an inline `background` hex to `rgb(r, g, b)`. */
function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${r},${g},${b})`;
}

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
   * EVERY severity band is keyed, including the two that are not rungs on the
   * ramp. The serious-injury bucket is kept because the ramp documents what a
   * colour MEANS — a future full-KABCO source would otherwise paint an
   * unlabelled colour — and `unknown` is kept because those points ARE painted:
   * they are collisions the source reported without any casualty count, and a
   * painted dot with no legend entry leaves the reader guessing which rung it
   * belongs to.
   *
   * The expected text is DERIVED from the shared palette rather than typed. It
   * used to be the literal "FatalSeriousInjuryPDO", which meant adding a band
   * made this test fail with "expected undefined to be defined" — a message that
   * says nothing about the real change and invites deleting the band.
   */
  it("keys every crash severity bucket when the crash layer is enabled", () => {
    renderLegend([], ["crashes"]);

    fireEvent.click(screen.getByTestId("toggle-on-crashes"));

    expect(screen.getByText("Crash severity")).toBeInTheDocument();

    const expectedText = CRASH_SEVERITY_LEGEND_ORDER.map(
      (severity) => CRASH_SEVERITY_LEGEND_LABEL[severity],
    ).join("");
    const severityLabels = Array.from(
      document.querySelectorAll(".op-cart-legend__ramp-labels"),
    ).find((node) => node.textContent === expectedText);
    expect(severityLabels, `expected a ramp labelled "${expectedText}"`).toBeDefined();

    const severityRamp = severityLabels?.previousElementSibling;
    expect(severityRamp?.classList.contains("op-cart-legend__ramp")).toBe(true);
    expect(severityRamp?.children).toHaveLength(CRASH_SEVERITY_LEGEND_ORDER.length);

    // A collision the source never classified must not be keyed as a mild one:
    // its swatch is off the red-to-slate ramp entirely.
    expect(CRASH_SEVERITY_LEGEND_ORDER).toContain("unknown");
    expect(CRASH_SEVERITY_LEGEND_LABEL.unknown).toBe("Not classified");
  });

  /**
   * THE LAYER PAINTED THREE MEANING-BEARING COLOURS AND THE LEGEND HAD NO
   * TRANSIT ENTRY AT ALL.
   *
   * Frequent, basic and untiered stops were three different dots with nothing on
   * screen saying which was which. An unkeyed colour that carries a claim is
   * worse than no colour: the reader supplies a meaning, and the one they supply
   * ("darker is better") is not wrong here by luck rather than by design.
   *
   * The labels are asserted against the shared constants, never against "15" and
   * "30" — those thresholds are the transit lane's reporting vocabulary and a
   * jurisdiction with a different statutory test must be able to change one
   * constant. A test that typed the numbers would pass while the legend and the
   * paint expression said different things.
   */
  it("keys the three colours the transit layer paints, from the shared palette", () => {
    renderLegend([], ["transit"]);

    fireEvent.click(screen.getByTestId("toggle-on-transit"));

    expect(screen.getByText(TRANSIT_SERVICE_TIER_LEGEND_TITLE)).toBeInTheDocument();

    const expectedLabels = TRANSIT_SERVICE_TIER_LEGEND_ORDER.map(
      (tier) => TRANSIT_SERVICE_TIER_LEGEND_LABEL[tier],
    );
    const transitLabels = Array.from(
      document.querySelectorAll(".op-cart-legend__ramp-labels"),
    ).find((node) => node.textContent === expectedLabels.join(""));
    expect(transitLabels).toBeDefined();

    const transitRamp = transitLabels?.previousElementSibling;
    expect(transitRamp?.classList.contains("op-cart-legend__ramp")).toBe(true);
    expect(transitRamp?.children).toHaveLength(3);

    // The swatch colours are the ones the map actually paints. A legend built
    // from its own copy of the palette is a legend that can be quietly wrong.
    const swatchColors = Array.from(transitRamp?.children ?? []).map(
      (node) => (node as HTMLElement).style.background,
    );
    expect(swatchColors).toHaveLength(3);
    for (const [index, tier] of TRANSIT_SERVICE_TIER_LEGEND_ORDER.entries()) {
      expect(swatchColors[index].replace(/\s/g, "")).toBe(
        hexToRgb(TRANSIT_SERVICE_TIER_COLOR[tier]),
      );
    }
  });

  it("keeps the transit key hidden until the transit layer is on", () => {
    // The transit layer is off by default — it is another organisation's record
    // rather than the workspace's own work — so the key must not advertise a
    // layer nothing is drawing.
    renderLegend();
    expect(screen.queryByText(TRANSIT_SERVICE_TIER_LEGEND_TITLE)).not.toBeInTheDocument();
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
