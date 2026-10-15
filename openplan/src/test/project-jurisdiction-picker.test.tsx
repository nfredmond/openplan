import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
it("reuses the search front door without emitting study geometry in search-only mode", async () => {
  const onCorridorChange = vi.fn(); const onPlaceResolved = vi.fn();
  const identity = { kind: "county", geoid: "06045", label: "Search fixture", geojson: { type: "Polygon", coordinates: [] }, bbox: { minLon: -124, minLat: 39, maxLon: -123, maxLat: 40 } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("place-boundary") ? identity : { items: [{ kind: "county", geoid: "06045", label: "Search fixture", description: "County" }] }))));
  render(<StudyAreaPicker corridorText="" onCorridorChange={onCorridorChange} onPlaceResolved={onPlaceResolved} searchOnly />);
  expect(screen.queryByText("Draw an area")).toBeNull();
  fireEvent.change(screen.getByLabelText("Search for a place"), { target: { value: "Search" } });
  fireEvent.click(await screen.findByText("Search fixture"));
  await waitFor(() => expect(onPlaceResolved).toHaveBeenCalledWith(identity));
  expect(onCorridorChange).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith("/api/geographies/place-boundary?kind=county&geoid=06045");
});
