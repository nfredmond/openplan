import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";

// The map is Mapbox-backed; this suite is about the honesty copy around it.
vi.mock("@/components/safety/safety-crash-map", () => ({
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));

function ingest(over: Partial<SafetyIngestSummary> = {}): SafetyIngestSummary {
  return {
    id: "ingest-1",
    sourceLabel: "California Crash Reporting System (CCRS)",
    attribution: "California Highway Patrol, CCRS (public domain).",
    coverageState: "ccrs_ca_statewide",
    severityCompleteness: "fatal_injury_only",
    status: "ready",
    crashCount: 1180,
    geocodedCount: 1089,
    truncated: false,
    yearsRequested: [2025],
    fetchError: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    ...over,
  };
}

function mockCrashResponse(features: unknown[] = [], matchedCount = features.length) {
  return {
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features,
      returnedCount: features.length,
      matchedCount,
      truncated: features.length < matchedCount,
      limit: 2000,
    }),
  } as Response;
}

describe("SafetyWorkspace coverage disclosure", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => mockCrashResponse()) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows reported AND mappable counts, never just the smaller one", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);

    await waitFor(() => {
      expect(screen.getByText(/1,180 reported/)).toBeInTheDocument();
    });
    expect(screen.getByText(/1,089 mappable/)).toBeInTheDocument();
  });

  it("explains the ungeocoded crashes that are counted but not plotted", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);

    await waitFor(() => {
      // 1180 - 1089 = 91 crashes that exist but cannot be mapped.
      expect(screen.getByText(/91 reported crashes have no coordinates/)).toBeInTheDocument();
    });
    expect(screen.getByText(/do not appear on the map/i)).toBeInTheDocument();
  });

  it("discloses that a KSI total cannot be derived from this source", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);

    await waitFor(() => {
      expect(screen.getByText(/cannot be derived from it/i)).toBeInTheDocument();
    });
  });

  it("states that an empty map is not evidence that no crashes occurred", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);

    await waitFor(() => {
      expect(
        screen.getByText(/not evidence that no crashes occurred/i)
      ).toBeInTheDocument();
    });
  });

  it("explains an out-of-coverage study area rather than showing a bare empty map", async () => {
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest({ coverageState: "out_of_coverage", status: "no_coverage", crashCount: 0, geocodedCount: 0 })}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No registered crash source covers this study area/i)).toBeInTheDocument();
    });
  });

  it("surfaces a source outage instead of silently showing nothing", async () => {
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest({
          status: "failed",
          coverageState: "source_unavailable",
          fetchError: "data.ca.gov unreachable",
          crashCount: 0,
          geocodedCount: 0,
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/data.ca.gov unreachable/)).toBeInTheDocument();
    });
  });

  it("reports how many of the matching crashes are actually in view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockCrashResponse([], 4213)) as unknown as typeof fetch
    );

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);

    await waitFor(() => {
      expect(screen.getByText(/Showing 0 of 4,213 crashes/)).toBeInTheDocument();
    });
  });
});
