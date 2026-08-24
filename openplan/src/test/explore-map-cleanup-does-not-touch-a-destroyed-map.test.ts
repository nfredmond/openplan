import { describe, expect, it } from "vitest";

import { isCurrentExploreMap } from "@/app/(app)/explore/_components/use-explore-map-layer-effects";

describe("Explore map cleanup lifecycle", () => {
  it("refuses to touch a map after the owning effect cleared the ref", () => {
    const removedMap = { getLayer: () => { throw new Error("destroyed map was touched"); } };
    const mapRef = { current: null };

    expect(isCurrentExploreMap(mapRef, removedMap as never)).toBe(false);
    if (isCurrentExploreMap(mapRef, removedMap as never)) removedMap.getLayer();
  });

  it("recognises the live instance", () => {
    const liveMap = {};
    expect(isCurrentExploreMap({ current: liveMap as never }, liveMap as never)).toBe(true);
  });
});
