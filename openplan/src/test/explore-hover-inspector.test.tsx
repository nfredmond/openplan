import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExploreHoverInspector } from "@/app/(app)/explore/_components/explore-hover-inspector";

describe("ExploreHoverInspector", () => {
  it("renders nothing when tract and crash layers are unavailable", () => {
    const { container } = render(
      <ExploreHoverInspector
        showTracts={false}
        switrsPointLayerAvailable={false}
        tractMetric="minority"
        hoveredTract={null}
        hoveredCrash={null}
        crashSeverityFilter="all"
        crashUserFilter="all"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders tract legend and hovered tract attributes", () => {
    render(
      <ExploreHoverInspector
        showTracts
        switrsPointLayerAvailable={false}
        tractMetric="poverty"
        hoveredTract={{
          name: "Nevada City Tract",
          geoid: "06057000100",
          population: 12345,
          medianIncome: 56000,
          pctMinority: 22,
          pctBelowPoverty: 18,
          zeroVehiclePct: 7,
          transitCommutePct: 3,
          isDisadvantaged: true,
        }}
        hoveredCrash={null}
        crashSeverityFilter="all"
        crashUserFilter="all"
      />
    );

    expect(screen.getByText("Live hover inspector")).toBeInTheDocument();
    expect(screen.getAllByText("Poverty share").length).toBeGreaterThan(0);
    expect(screen.getByText("Nevada City Tract")).toBeInTheDocument();
    expect(screen.getByText("GEOID 06057000100")).toBeInTheDocument();
    expect(screen.getByText("12,345")).toBeInTheDocument();
    expect(screen.getByText("$56,000")).toBeInTheDocument();
    expect(screen.getAllByText("18%").length).toBeGreaterThan(0);
  });

  it("renders hovered crash attributes when SWITRS points are available", () => {
    render(
      <ExploreHoverInspector
        showTracts={false}
        switrsPointLayerAvailable
        tractMetric="minority"
        hoveredTract={null}
        hoveredCrash={{
          severityLabel: "Fatal crash",
          collisionYear: 2024,
          fatalCount: 1,
          injuryCount: 2,
          pedestrianInvolved: true,
          bicyclistInvolved: false,
        }}
        crashSeverityFilter="fatal"
        crashUserFilter="pedestrian"
      />
    );

    expect(screen.getByText("Crash inspector")).toBeInTheDocument();
    expect(screen.getAllByText("Fatal crash").length).toBeGreaterThan(0);
    expect(screen.getByText("Fatal / Ped only")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(screen.getByText("Ped")).toBeInTheDocument();
  });
});
