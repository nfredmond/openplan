import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExploreLayerVisibilityControls } from "@/app/(app)/explore/_components/explore-layer-visibility-controls";

function renderControls(overrides: Partial<Parameters<typeof ExploreLayerVisibilityControls>[0]> = {}) {
  const props = {
    mapReady: true,
    showPolygonFill: true,
    onTogglePolygonFill: vi.fn(),
    showTracts: true,
    onToggleTracts: vi.fn(),
    showCrashes: false,
    onToggleCrashes: vi.fn(),
    switrsPointLayerAvailable: true,
    tractMetric: "minority" as const,
    onChangeTractMetric: vi.fn(),
    ...overrides,
  };

  render(<ExploreLayerVisibilityControls {...props} />);

  return props;
}

describe("ExploreLayerVisibilityControls", () => {
  it("renders map readiness and layer visibility states", () => {
    renderControls();

    expect(screen.getByText("Layer visibility")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Corridor fill/ })).toHaveClass("is-active");
    expect(screen.getByRole("button", { name: /Census tracts/ })).toHaveClass("is-active");
    expect(screen.getByRole("button", { name: /Crash data/ })).toHaveClass("is-muted");
    expect(screen.getAllByText("Visible")).toHaveLength(2);
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("surfaces initialization and unavailable crash layer states", () => {
    renderControls({
      mapReady: false,
      showPolygonFill: false,
      showTracts: false,
      showCrashes: true,
      switrsPointLayerAvailable: false,
    });

    expect(screen.getByText("Init")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Corridor fill/ })).toHaveClass("is-muted");
    expect(screen.getByRole("button", { name: /Census tracts/ })).toHaveClass("is-muted");
    expect(screen.getByRole("button", { name: /Crash data/ })).toHaveClass("is-muted");
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("dispatches layer toggles and tract theme changes", () => {
    const props = renderControls({
      tractMetric: "income",
    });

    fireEvent.click(screen.getByRole("button", { name: /Corridor fill/ }));
    fireEvent.click(screen.getByRole("button", { name: /Census tracts/ }));
    fireEvent.click(screen.getByRole("button", { name: /Crash data/ }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "poverty" } });

    expect(props.onTogglePolygonFill).toHaveBeenCalledTimes(1);
    expect(props.onToggleTracts).toHaveBeenCalledTimes(1);
    expect(props.onToggleCrashes).toHaveBeenCalledTimes(1);
    expect(props.onChangeTractMetric).toHaveBeenCalledWith("poverty");
  });
});
