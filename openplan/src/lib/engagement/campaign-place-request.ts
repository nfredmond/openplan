import type { PlaceBoundaryResponse, PlaceKind } from "@/lib/api/place-geographies";
import { parseCorridorText } from "@/lib/models/study-area";
import type { CorridorGeojson } from "@/lib/models/run-launch";

/**
 * The `place` value PATCH /api/engagement/campaigns/{id} accepts.
 *
 * A searched place travels as a REFERENCE (kind and GEOID) so the route
 * re-resolves the boundary itself; a drawn area travels as geometry, because
 * there is nothing to look it up by. The route's schema is the authority; this
 * type mirrors it so the two places that set a campaign's area (the publish
 * checklist and the campaign settings) send the same shape.
 */
export type CampaignPlaceBody =
  | { mode: "place"; kind: PlaceKind; geoid: string; label?: string }
  | { mode: "drawn"; geometry: CorridorGeojson };

/**
 * What the shared `StudyAreaPicker` holds, turned into the body above.
 *
 * A picked place wins over the text, because picking a place also fills the
 * text with its boundary and the reference is the stronger fact. Returns null
 * when neither a place nor a usable drawn area is there, so the caller can say
 * so instead of sending an empty save.
 */
export function campaignPlaceFromPicker(
  pickedPlace: PlaceBoundaryResponse | null,
  areaText: string
): CampaignPlaceBody | null {
  if (pickedPlace) {
    return { mode: "place", kind: pickedPlace.kind, geoid: pickedPlace.geoid };
  }
  const drawn = parseCorridorText(areaText);
  return drawn ? { mode: "drawn", geometry: drawn } : null;
}
