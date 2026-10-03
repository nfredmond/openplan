import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartShareBar } from "@/components/ui/chart-share-bar";

/**
 * The one bar the engagement panels share. Its job is to keep three readings
 * apart that a hand-drawn bar blurred: none, some, and not known.
 */
function fillOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector("[data-chart-share-bar] span[aria-hidden] > span");
}

describe("ChartShareBar", () => {
  it("draws a share as that share of the track, in the palette colour", () => {
    const { container } = render(<ChartShareBar label="Approved" valueText="3 · 30%" fraction={0.3} />);
    const fill = fillOf(container);
    expect(fill?.style.width).toBe("30%");
    expect(fill?.style.background).toBe("var(--chart-1)");
    expect(container.textContent).toContain("3 · 30%");
  });

  it("draws a zero as no fill at all, not a sliver", () => {
    const { container } = render(<ChartShareBar label="Rejected" valueText="0 · 0%" fraction={0} />);
    expect(fillOf(container)).toBeNull();
    expect(container.querySelector("[data-chart-share-bar]")?.getAttribute("data-chart-share-bar")).toBe("known");
  });

  it("marks an unknown value as unknown and draws nothing", () => {
    const { container } = render(<ChartShareBar label="Area baseline" valueText="—" fraction={null} layout="inline" />);
    expect(fillOf(container)).toBeNull();
    expect(container.querySelector("[data-chart-share-bar]")?.getAttribute("data-chart-share-bar")).toBe("unknown");
  });

  it("uses a category's own colour only when it is a real hex colour", () => {
    const valid = render(<ChartShareBar label="Safety" valueText="4" fraction={0.5} colorHex=" #1f9d55 " />);
    expect(fillOf(valid.container)?.style.background).toBe("rgb(31, 157, 85)");
    valid.unmount();

    const invalid = render(<ChartShareBar label="Safety" valueText="4" fraction={0.5} colorHex="red; inject" />);
    expect(fillOf(invalid.container)?.style.background).toBe("var(--chart-1)");
  });

  it("keeps a share over the whole inside the track", () => {
    const { container } = render(<ChartShareBar label="Pool" valueText="120%" fraction={1.2} />);
    expect(fillOf(container)?.style.width).toBe("100%");
  });
});
