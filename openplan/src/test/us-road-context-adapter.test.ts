import { describe, expect, it, vi } from "vitest";

import {
  loadUsTigerRoadContext,
  roadContextForFrozenPacket,
} from "@/lib/safety/us-road-context-adapter";

function response(body: unknown, ok = true) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 503 }));
}

describe("US TIGER/Line road-context adapter", () => {
  it("keeps source, published vintage, name, and geometry together", async () => {
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("?f=pjson")) return response({ description: "Local roads; January 1, 2025" });
      return response({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { NAME: "Broadway", OID: "road-1" },
          geometry: { type: "LineString", coordinates: [[-121.5, 38.5], [-121.49, 38.51]] },
        }],
      });
    });

    const result = await loadUsTigerRoadContext([{ longitude: -121.5, latitude: 38.5 }], fetcher);
    expect(result.sourceVintage).toBe("2025-01-01");
    expect(result.roads[0]).toMatchObject({
      name: "Broadway",
      sourceId: "us-census-tiger-line-cache",
      sourceLabel: "U.S. Census TIGER/Line roads",
      vintage: "2025-01-01",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("fails closed when the source has no readable vintage", async () => {
    const fetcher = vi.fn(() => response({ description: "Current roads" }));
    const result = await loadUsTigerRoadContext([{ longitude: -121.5, latitude: 38.5 }], fetcher);
    expect(result.roads).toEqual([]);
    expect(result.sourceVintage).toBeNull();
    expect(result.coverageLimit).toContain("could not be read");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not request a source when no valid concentration exists", async () => {
    const fetcher = vi.fn();
    const result = await loadUsTigerRoadContext([{ longitude: Number.NaN, latitude: 38.5 }], fetcher);
    expect(result.roads).toEqual([]);
    expect(result.coverageLimit).toContain("No KSI concentration coordinates");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps road geometry out of a packet when its project cache write fails", () => {
    const road = {
      id: "road-1",
      name: "Broadway",
      geometry: {
        type: "LineString" as const,
        coordinates: [[-121.5, 38.5], [-121.49, 38.51]] as [number, number][],
      },
      sourceId: "us-census-tiger-line-cache" as const,
      sourceLabel: "U.S. Census TIGER/Line roads",
      vintage: "2025-01-01",
    };

    expect(roadContextForFrozenPacket([road], null)).toEqual([road]);
    expect(roadContextForFrozenPacket([road], { message: "cache unavailable" })).toEqual([]);
  });
});
