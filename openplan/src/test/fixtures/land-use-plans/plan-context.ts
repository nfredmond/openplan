import type { SavedPlanContext } from "@/lib/land-use-plans/plan-context";

export function syntheticPlanContext(): SavedPlanContext {
  return {
    schemaVersion: 1,
    place: { source: "uploaded_file", kind: null, ref: null, label: "SYNTHETIC study area",
      countryCode: null, subdivisionCode: null,
      bbox: { minLon: -122, minLat: 38, maxLon: -121, maxLat: 39 },
      geometry: { type: "Polygon", coordinates: [[[-122, 38], [-121, 38], [-121, 39], [-122, 38]]] } },
    assessment: {
      authorities: [{ id: "20000000-0000-4000-8000-000000000010", label: "SYNTHETIC responsible body",
        role: "Responsibility unresolved", kind: "unassessed", jurisdiction: null, sourceUrls: [] }],
      applicability: { status: "unresolved", explanation: "SYNTHETIC fixture with no legal applicability claim" },
    },
    savedBy: "20000000-0000-4000-8000-000000000003", savedAt: "2026-10-07T00:00:00.123456Z",
  };
}
