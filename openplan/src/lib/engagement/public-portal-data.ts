import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ENGAGEMENT_PHOTO_BUCKET, ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS } from "@/lib/engagement/photo";
import { loadSurveyDefinition } from "@/lib/engagement/survey-responses";
import { loadPublishedCloseLoopEntries } from "@/lib/engagement/close-loop";
import { isEmailTransportConfigured } from "@/lib/notifications/email";
import {
  placeOfRecordFromProject,
  PROJECT_PLACE_SCOPE_COLUMNS,
  type ProjectPlaceRow,
} from "@/lib/projects/project-place";
import {
  clearedHomeGeographyRow,
  deriveHomeMapView,
  HOME_GEOGRAPHY_COLUMN_NAMES,
  parseWorkspaceHomeGeography,
  placeOfRecordFromHomeGeography,
} from "@/lib/workspaces/home-geography";
import {
  loadParticipantContextLayers,
  type ParticipantContextLayerSet,
} from "@/lib/engagement/context-layers";
import { resolveMapPointQuestionView } from "@/lib/engagement/survey";
import { EMPTY_PLACE_OF_RECORD, type PlaceOfRecord } from "@/lib/geographies/place-of-record";
import { geofenceInviteSentence, SUBMISSION_GEOFENCE_COLUMN } from "@/lib/engagement/geofence";
import { resolvePortalLocale, type ResolvedPortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import type { PortalMessageBundle } from "@/lib/engagement/portal-i18n/translator";
import { readAcceptLanguageHeader } from "@/lib/engagement/portal-i18n/request-locale";
import {
  loadPortalTranslationIndex,
  resolveOperatorText,
  resolveOptionalOperatorText,
  type PortalText,
  type PortalTranslationIndex,
} from "@/lib/engagement/portal-i18n/operator-text";
import type { PortalSurveyQuestion } from "@/components/engagement/public-survey-form";
import type { PublicCloseLoopEntry } from "@/components/engagement/public-close-loop";

// Single source of truth for the PUBLIC engagement portal's gate + data. Used by
// both the full public page ((public)/engage/[shareToken]) and the minimal-chrome
// embed page ((embed)/embed/[shareToken]). Service-role, share_token + active
// gated — anon has zero RLS access to these tables. Returns null when there is no
// active campaign for the token, so callers render notFound().

export type PublicPortalCampaign = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  summary: string | null;
  public_description: string | null;
  status: string;
  engagement_type: string;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  demographics_enabled: boolean;
  updated_at: string;
  /**
   * How a resident who cannot use this portal takes part anyway
   * (20260730000001). Agency-authored, every field optional, and NEVER
   * defaulted by OpenPlan — the duty to offer an alternative sits with the body
   * running the consultation, so a default here would put words in a public
   * body's mouth about its own legal obligation.
   */
  accessibility_contact_label: string | null;
  accessibility_contact_email: string | null;
  accessibility_contact_phone: string | null;
  accessibility_alternate_formats: string | null;
};

export type PublicPortalProject = { id: string; name: string; summary: string | null };

/**
 * THE MAP-FRAMING SEAM.
 *
 * A campaign's public map used to be framed only by the pins already on it, so a
 * brand-new campaign opened on the continental United States — for the first
 * resident, on a phone, from a QR code on a flyer. Three areas were already
 * known and none of them was read here. These constants and helpers are how they
 * reach the portal, and this repo's recurring defect is exactly a column missing
 * from one of these select strings, so every name below is derived from a shared
 * list rather than retyped.
 *
 * `engagement_campaigns.place_*` (20260729000003) deliberately uses the SAME
 * column names as `projects.place_*` (20260728000009), because a place of record
 * has one shape regardless of who owns it — see
 * src/lib/geographies/place-of-record.ts. That is why the project-named column
 * list and narrowing below are applied to a campaign row verbatim: they are
 * keyed on column names both tables share on purpose, and a second copy under a
 * campaign-shaped name would be two things to keep in step instead of one.
 *
 * SHIP ORDER, and it is load-bearing: apply 20260729000003 BEFORE deploying
 * code that contains this select. Between a deploy and its migration the
 * `place_*` columns do not exist, so this read errors for every campaign in
 * the deployment and every public portal shows residents a disclosure about a
 * lookup that failed. That disclosure is true — it is deliberately the third
 * state below, not a guess — but it is a paragraph of apology on every
 * resident-facing map until the migration lands. `docs/SELF_HOSTING.md` §2 step
 * 3 is where that order has to reach whoever runs a deployment, since nobody
 * deploying reads this file; do not delete this note on the assumption that the
 * doc already carries it — check.
 */
export const CAMPAIGN_PLACE_SCOPE_COLUMNS = PROJECT_PLACE_SCOPE_COLUMNS;

/**
 * The workspace home-geography columns MINUS the boundary polygon.
 *
 * `HOME_GEOGRAPHY_SCOPE_COLUMNS` cannot be used: it drops the bbox, which is the
 * only part the map camera needs. `HOME_GEOGRAPHY_COLUMNS` cannot be used
 * either: it carries `home_geometry_geojson`, and a TIGERweb county boundary is
 * megabytes dragged out of Postgres on every public page load. Derived by
 * filtering the shared name list so a renamed column cannot leave this pointing
 * at something that no longer exists.
 */
const HOME_GEOGRAPHY_FRAMING_COLUMNS = HOME_GEOGRAPHY_COLUMN_NAMES.filter(
  (column) => column !== "home_geometry_geojson"
).join(", ");

export type PortalMapView = { center: [number, number]; zoom: number };

export type PortalMapBbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

/**
 * One area the portal map could open on, as the server read it.
 *
 * THREE states, not two, because there are three different things that can be
 * true and each gets a different sentence in front of a resident:
 *
 *   `set`        — the read succeeded and an area is on record. Its `bbox` may
 *                  still be missing, which is an operator's problem to fix.
 *   `unset`      — the read succeeded and no area is on record. Ordinary.
 *   `unreadable` — the READ ITSELF failed. Nothing is known: not the label, not
 *                  the extent, and not whether an area exists at all.
 *
 * The third one used to be folded into `set`, and the cost was a false sentence
 * shown to members of the public: a failed read rendered as "the area set for
 * this campaign could not be read as a map extent", which claims an area exists
 * (unknown) and blames its extent (not what failed). Folding it into `unset`
 * instead would have been the mirror-image lie. A failure is its own state.
 *
 * Only the bounding box crosses to the public portal. The boundary polygon
 * frames nothing a bbox cannot, and a TIGERweb county boundary is megabytes on
 * a page that opens from a phone.
 */
export type PortalPlaceCandidate = {
  state: "set" | "unset" | "unreadable";
  label: string | null;
  bbox: PortalMapBbox | null;
};

/**
 * Narrow a successfully read place of record into what the public portal is
 * allowed to know: is there an area at all, what is it called, what does it
 * cover.
 *
 * `set` is taken from the SOURCE rather than from the bbox, so "an operator
 * recorded an area whose extent will not load" stays distinguishable from "no
 * area was ever set". The portal says different things about those two, and
 * collapsing them is how a broken campaign looks like an ordinary one.
 *
 * Only ever called on a read that SUCCEEDED — a failed read never reaches here,
 * because an absent row and an absent answer are not the same fact.
 */
function portalPlaceCandidate(place: PlaceOfRecord): PortalPlaceCandidate {
  return {
    state: place.source ? "set" : "unset",
    label: place.label?.trim() || null,
    bbox: place.bbox,
  };
}

/**
 * What a candidate is when its READ failed.
 *
 * Neither `set` nor `unset`. A query that errored has told us nothing about
 * whether an area exists: reporting "no area set" would state a failure as a
 * fact about the world, and reporting "set but unreadable" — which this
 * constant used to do — states a different fact nobody established. It is
 * reported as unknown, because unknown is what it is.
 */
const UNREADABLE_PORTAL_PLACE: PortalPlaceCandidate = { state: "unreadable", label: null, bbox: null };

export type PortalPlaceCandidates = {
  campaign: PortalPlaceCandidate;
  project: PortalPlaceCandidate;
  workspaceHome: PortalPlaceCandidate;
};

/**
 * The three candidates that are a recorded PLACE, in precedence order.
 *
 * Split out from `PortalFramingOrigin` because only these three can be missing,
 * broken, or unreadable — `approved_pins` is derived from rows already loaded
 * and `none` is the absence of an answer. Typing the disclosure over this
 * narrower set is what stops a sentence about a failed lookup ever being built
 * for a candidate that cannot have one.
 */
export type PortalPlaceOrigin = "campaign_place" | "project_place" | "workspace_home";

/** Which candidate framed the map. `none` means nothing could. */
export type PortalFramingOrigin = PortalPlaceOrigin | "approved_pins" | "none";

/**
 * A candidate that could have framed the map and did not, plus WHY.
 *
 * The reason is carried rather than assumed because the two reasons are
 * different facts with different fixes, and only one of them may say an area
 * exists:
 *
 *   `extent` — an area IS on record and its extent could not be turned into a
 *              camera. The operator can fix it by re-picking the area.
 *   `read`   — the query failed. Whether an area is on record is UNKNOWN, so
 *              nothing about it may be stated; whoever runs the deployment
 *              fixes it, not the operator.
 */
export type PortalFramingGap = {
  origin: PortalPlaceOrigin;
  reason: "extent" | "read";
};

export type PortalMapFraming = {
  /** Null means nothing framed this map, and the surface showing it must say so. */
  view: PortalMapView | null;
  origin: PortalFramingOrigin;
  /** The area's own name, when it has one. Never a name standing in for an explanation. */
  originLabel: string | null;
  /**
   * Candidates that could not frame the map despite being tried, in precedence
   * order, each with its reason. Disclosed rather than swallowed: a campaign
   * whose stated area cannot frame its own map is broken in a way only its
   * operator can fix, and neither "set but unreadable" nor "we could not even
   * look" is the same state as "never set".
   */
  unreadable: PortalFramingGap[];
  /**
   * One sentence naming what frames this map and why.
   *
   * Rendered HERE, once, because two audiences need the same fact and neither
   * can compute it: the resident deciding whether the map shows their town, and
   * the operator checking that the portal they are about to publish opens
   * somewhere useful. Both are client surfaces and this module is server-only,
   * so the sentence travels with the answer instead of being written twice and
   * drifting.
   */
  summary: string;
  /** What was set but could not be used, or null when nothing was. */
  unreadableNote: string | null;
  /**
   * The submission rule in force on the COMMENT map, or null when there is none.
   *
   * Deliberately NOT folded into `summary`, and that separation is load-bearing.
   * `summary` is consumed by more than one map: `resolveMapPointQuestionView`
   * hands it to a survey `map_point` question as that question's framing note.
   * The geofence is enforced by `/api/engage/[shareToken]/submit` and by nothing
   * else — a survey answer is written by a different route that does not check
   * it — so a rule sentence riding inside `summary` would appear above a map
   * where it is not true, and would additionally promise that "a comment sent
   * without a pin is accepted from anywhere" beside a question that may be
   * REQUIRED. A surface that does not enforce the rule must not announce it, so
   * it travels in its own field and only the surface that is governed by it
   * renders it.
   */
  submissionRule: string | null;
};

/**
 * Where the resident-facing map should open, derived from the campaign's OWN
 * approved submissions — the LAST candidate in the precedence below.
 *
 * The zoom ladder here is deliberately coarser than a bbox fit. The extent of
 * existing pins is where people have already spoken, not the area being studied;
 * framing exactly to it would crop out the streets nobody has pinned yet, which
 * are precisely the ones the campaign still needs to hear about. So it opens one
 * step wider than the pins themselves.
 *
 * Returns null when there are no usable pins. That is the honest answer for this
 * candidate alone — it is not the answer for the campaign, because three better
 * candidates are tried before it.
 */
export function derivePortalMapCenter(
  items: Array<{ latitude: number | null; longitude: number | null }>
): PortalMapView | null {
  const points = items.filter(
    (i): i is { latitude: number; longitude: number } =>
      typeof i.latitude === "number" &&
      typeof i.longitude === "number" &&
      Number.isFinite(i.latitude) &&
      Number.isFinite(i.longitude)
  );
  if (points.length === 0) return null;

  const lons = points.map((p) => p.longitude);
  const lats = points.map((p) => p.latitude);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  // Zoom from the spread of existing input, so a citywide campaign and a
  // single-intersection campaign both open at a usable scale.
  const span = Math.max(maxLon - minLon, maxLat - minLat);
  const zoom = span > 2 ? 7 : span > 0.5 ? 9 : span > 0.1 ? 11 : 13;

  return { center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2], zoom };
}

/**
 * Turn a bounding box into a camera using the one fitter this app has.
 *
 * `deriveHomeMapView` lives beside the workspace home geography because that is
 * where the question was first asked, but none of its maths is about a
 * workspace: it handles the antimeridian, the Mercator latitude distortion, the
 * padding and the zoom clamps. A second copy here would drift from it, and the
 * drift would surface as a resident-facing map framing the wrong thing — the
 * exact defect this seam exists to remove. So the bbox is passed through the
 * shape that fitter reads instead of being re-fitted here.
 */
function viewForBbox(bbox: PortalMapBbox): PortalMapView | null {
  return deriveHomeMapView({
    ...clearedHomeGeographyRow(),
    home_min_lon: bbox.minLon,
    home_min_lat: bbox.minLat,
    home_max_lon: bbox.maxLon,
    home_max_lat: bbox.maxLat,
  });
}

/**
 * What each origin IS, for a sentence. Never a place name — that is
 * `originLabel`.
 *
 * Every phrase here ASSERTS that an area exists ("the area set for this
 * campaign"), so it may only be used where that has actually been established:
 * the candidate that framed the map, or one whose `state` is `set`. For a
 * candidate whose read failed, use `PORTAL_FRAMING_ORIGIN_OWNER` — saying "the
 * area set for this campaign could not be read" about a campaign that may never
 * have had one is two false claims in one sentence, shown to the public.
 */
const PORTAL_FRAMING_ORIGIN_ROLE: Record<Exclude<PortalFramingOrigin, "none">, string> = {
  campaign_place: "the area set for this campaign",
  project_place: "the linked project's study area",
  workspace_home: "this workspace's home geography",
  approved_pins: "the places people have already marked on this map",
};

/**
 * WHOSE area a candidate would have been — asserting nothing about whether one
 * exists. This is the vocabulary for a lookup that failed, where the only
 * honest subject of the sentence is the owner, not the area.
 */
const PORTAL_FRAMING_ORIGIN_OWNER: Record<PortalPlaceOrigin, string> = {
  campaign_place: "this campaign",
  project_place: "the linked project",
  workspace_home: "this workspace",
};

/** These phrases are written to sit mid-sentence; some of them start one. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinPhrases(phrases: string[]): string {
  return phrases.length === 1
    ? phrases[0]
    : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

function describeFraming(
  origin: PortalFramingOrigin,
  originLabel: string | null,
  gaps: PortalFramingGap[]
): string {
  if (origin === "none") {
    // "No study area has been set" is a claim about the world, and it is only
    // ours to make when every candidate was actually checked. If any lookup
    // failed we know less than that, and the note built below names which.
    return gaps.length > 0
      ? "This map could not be framed on a study area, so it opens on the whole country."
      : "No study area has been set for this campaign and no locations have been marked yet, so this map opens on the whole country.";
  }

  const role = PORTAL_FRAMING_ORIGIN_ROLE[origin];
  return originLabel ? `This map opens on ${originLabel} — ${role}.` : `This map opens on ${role}.`;
}

/**
 * One paragraph naming everything that could have framed this map and did not.
 *
 * Grouped by reason rather than listed together, because the two reasons are
 * different facts and share no true sentence: an area on record with an
 * unusable extent can be named as an area, while a lookup that failed leaves
 * nobody entitled to say an area was there.
 */
function describeGaps(gaps: PortalFramingGap[]): string | null {
  if (gaps.length === 0) return null;

  const sentences: string[] = [];

  /** "so it did not frame this map" / "so none of them framed this map". */
  const outcome = (count: number) =>
    count === 1 ? "so it did not frame this map" : "so none of them framed this map";

  const unusableExtent = gaps.filter((gap) => gap.reason === "extent");
  if (unusableExtent.length > 0) {
    const listed = joinPhrases(unusableExtent.map((gap) => PORTAL_FRAMING_ORIGIN_ROLE[gap.origin]));
    sentences.push(
      `${sentenceCase(listed)} could not be read as a map extent, ${outcome(unusableExtent.length)}.`
    );
  }

  const failedRead = gaps.filter((gap) => gap.reason === "read");
  if (failedRead.length > 0) {
    const listed = joinPhrases(failedRead.map((gap) => PORTAL_FRAMING_ORIGIN_OWNER[gap.origin]));
    sentences.push(
      `${sentenceCase(listed)} could not be checked for a recorded area, ${outcome(failedRead.length)}.`
    );
  }

  return sentences.join(" ");
}

/**
 * Decide which area frames a campaign's public map, and record why.
 *
 * This is the same shape as `resolveStudyArea` in src/lib/models/study-area.ts —
 * one statement of precedence, plus an `origin`/`originLabel` disclosure — and
 * for the same reason: an inherited geography that does not say where it came
 * from is a silent assumption about what is being asked. Here the assumption is
 * made in front of residents, so it matters more, not less.
 *
 * THE ORDER, most specific first:
 *
 *   1. The campaign's own area (20260729000003). An operator who set one meant
 *      it — a corridor study inside a county-wide agency is about the corridor.
 *   2. The linked project's place of record (20260728000009). The campaign is
 *      public input ON that project, so its area is the right frame.
 *   3. The workspace's home geography (20260723000005). The agency's own patch:
 *      wide, but never somebody else's county.
 *   4. The campaign's approved pins. Circular — it frames on the answers to
 *      infer where the question is — so it is the fallback, not the answer.
 *
 * No branch invents a place. With nothing to inherit it returns a null view and
 * origin `none`, and the caller is expected to SAY that the map is showing the
 * whole country rather than let a continent pass for a study area.
 *
 * WHY THE SUBMISSION GEOFENCE IS SAID HERE, of all places (20260730000002). A
 * campaign that only accepts pins inside its own area must not invite a pin it
 * is going to refuse, and this sentence is the one already rendered directly
 * above the map a resident is about to draw on — and beside the badge on the
 * operator console. Putting the rule anywhere else would mean computing a second
 * answer about the same area, which is exactly the drift this resolver exists to
 * prevent. The name used is the CAMPAIGN's own, because the campaign's own place
 * of record is the only area the check ever runs against.
 */
export function resolvePortalMapFraming(candidates: {
  campaignPlace?: PortalPlaceCandidate | null;
  projectPlace?: PortalPlaceCandidate | null;
  workspaceHome?: PortalPlaceCandidate | null;
  approvedItems?: Array<{ latitude: number | null; longitude: number | null }>;
  /**
   * True when this campaign refuses a submitted pin that falls outside its own
   * area. False for every campaign that has not opted in, which is what keeps
   * this sentence off the portals it is not true of.
   */
  submissionGeofenceEnabled?: boolean;
}): PortalMapFraming {
  const unreadable: PortalFramingGap[] = [];

  const ordered: Array<[PortalPlaceOrigin, PortalPlaceCandidate | null | undefined]> = [
    ["campaign_place", candidates.campaignPlace],
    ["project_place", candidates.projectPlace],
    ["workspace_home", candidates.workspaceHome],
  ];

  const framed = (
    view: PortalMapView | null,
    origin: PortalFramingOrigin,
    originLabel: string | null
  ): PortalMapFraming => {
    // Carried in its own field, never appended to `describeFraming`'s sentence:
    // it is a different KIND of fact — that one says where the camera opens,
    // this one says what will be accepted — and, decisively, `summary` is reused
    // as the framing note of a survey `map_point` question, which this rule does
    // NOT govern. See `submissionRule` on PortalMapFraming.
    //
    // It is set for whichever candidate ended up framing the map: the rule holds
    // even where the campaign's own area is on record and could not be turned
    // into a camera.
    return {
      view,
      origin,
      originLabel,
      unreadable,
      summary: describeFraming(origin, originLabel, unreadable),
      unreadableNote: describeGaps(unreadable),
      submissionRule: candidates.submissionGeofenceEnabled
        ? geofenceInviteSentence(candidates.campaignPlace?.label ?? null)
        : null,
    };
  };

  for (const [origin, candidate] of ordered) {
    if (!candidate) continue;

    if (candidate.state === "unreadable") {
      // The lookup FAILED. Fall through so the map still works, but record it as
      // a failed lookup rather than as an area — the sentence built for this
      // reason is the only one entitled to be silent about whether an area
      // exists, and it is the one a public portal shows during the window
      // between a deploy and its migrations.
      unreadable.push({ origin, reason: "read" });
      continue;
    }

    if (candidate.state === "unset") continue;

    const view = candidate.bbox ? viewForBbox(candidate.bbox) : null;
    if (!view) {
      // Recorded, but it cannot frame anything. Fall through to the next
      // candidate so the map still works, and carry the fact out so it can be
      // shown — a silent fall-through here is how "set" and "unset" become
      // indistinguishable.
      unreadable.push({ origin, reason: "extent" });
      continue;
    }

    return framed(view, origin, candidate.label?.trim() || null);
  }

  const pinView = derivePortalMapCenter(candidates.approvedItems ?? []);
  if (pinView) return framed(pinView, "approved_pins", null);

  return framed(null, "none", null);
}

/** Only `from` is used, so any Supabase client — caller-RLS or service-role — fits. */
type QueryClient = Pick<SupabaseClient, "from">;

/**
 * Read the three areas that can frame a campaign's public map.
 *
 * ONE reader, two very different callers, deliberately: the public portal calls
 * it with the service-role client behind a share token, and the campaign console
 * calls it with the operator's own RLS client. That is what makes the operator's
 * "your portal opens here" statement the SAME fact residents are shown, rather
 * than a second implementation that can quietly disagree with the first.
 *
 * Every read is answered as one of the three states in `PortalPlaceCandidate` —
 * `set`, `unset`, or `unreadable`. A failed query is never allowed to arrive as
 * either of the other two: not as "not set", which would state a failure as a
 * fact, and not as "set", which would state a different fact nobody checked.
 */
export async function loadPortalPlaceCandidates(
  supabase: QueryClient,
  campaign: { id: string; workspace_id: string; project_id: string | null }
): Promise<PortalPlaceCandidates> {
  const [campaignPlace, projectPlace, workspaceRow] = await Promise.all([
    supabase
      .from("engagement_campaigns")
      .select(CAMPAIGN_PLACE_SCOPE_COLUMNS)
      .eq("id", campaign.id)
      .maybeSingle(),
    campaign.project_id
      ? supabase
          .from("projects")
          .select(PROJECT_PLACE_SCOPE_COLUMNS)
          .eq("id", campaign.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("workspaces")
      .select(HOME_GEOGRAPHY_FRAMING_COLUMNS)
      .eq("id", campaign.workspace_id)
      .maybeSingle(),
  ]);

  return {
    campaign: campaignPlace.error
      ? UNREADABLE_PORTAL_PLACE
      : portalPlaceCandidate(placeOfRecordFromProject(campaignPlace.data as Partial<ProjectPlaceRow> | null)),
    project: projectPlace.error
      ? UNREADABLE_PORTAL_PLACE
      : portalPlaceCandidate(placeOfRecordFromProject(projectPlace.data as Partial<ProjectPlaceRow> | null)),
    workspaceHome: workspaceRow.error
      ? UNREADABLE_PORTAL_PLACE
      : portalPlaceCandidate(
          workspaceRow.data
            ? placeOfRecordFromHomeGeography(parseWorkspaceHomeGeography(workspaceRow.data))
            : EMPTY_PLACE_OF_RECORD
        ),
  };
}

type CategoryRow = { id: string; label: string; slug: string | null; description: string | null; sort_order: number | null; color: string | null };
type ApprovedItemRow = {
  id: string;
  category_id: string | null;
  title: string | null;
  body: string;
  submitted_by: string | null;
  latitude: number | null;
  longitude: number | null;
  geometry: unknown;
  photo_path: string | null;
  votes_count: number | null;
  parent_item_id: string | null;
  created_at: string;
};

/**
 * A category as a participant reads it — the operator's own words, in the
 * participant's language, WITH the provenance that decides how they must be
 * labelled.
 *
 * `label` and `description` are kept as plain strings and kept in the SOURCE
 * language, unchanged. They are not the translated answer and must not be
 * rendered as one: `labelText.text` is. The plain fields survive only so the
 * portal component keeps compiling while its strings are migrated, and the
 * split is deliberate — swapping `label` to the translated string silently
 * would have published machine output with no caveat on any surface that had
 * not yet been taught to render one.
 */
export type PortalCategoryView = {
  id: string;
  label: string;
  description: string | null;
  color: string | null;
  labelText: PortalText;
  descriptionText: PortalText | null;
};

/**
 * A survey question with its operator-authored text resolved. Structurally a
 * `PortalSurveyQuestion`, so it can be passed anywhere one is expected while
 * carrying more.
 */
export type PortalSurveyQuestionView = Omit<PortalSurveyQuestion, "options"> & {
  promptText: PortalText;
  helpTextText: PortalText | null;
  options: Array<PortalSurveyQuestion["options"][number] & { labelText: PortalText }>;
};

/** A close-the-loop entry with its operator-authored text resolved. */
export type PortalCloseLoopEntryView = PublicCloseLoopEntry & {
  themeTitleText: PortalText;
  youSaidText: PortalText;
  weDidText: PortalText;
  categoryLabelText: PortalText | null;
};

/** The campaign's own operator-authored text, resolved. */
export type PortalCampaignText = {
  title: PortalText;
  summary: PortalText | null;
  publicDescription: PortalText | null;
  accessibilityContactLabel: PortalText | null;
  accessibilityAlternateFormats: PortalText | null;
};

// The prop object PublicEngagementPortal consumes (kept structural so both pages
// pass it through with a spread).
export type PublicPortalProps = {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: PortalCategoryView[];
  approvedItems: {
    id: string;
    categoryId: string | null;
    title: string | null;
    body: string;
    submittedBy: string | null;
    latitude: number | null;
    longitude: number | null;
    geometry: unknown;
    votesCount: number;
    parentItemId: string | null;
    photoUrl: string | null;
    createdAt: string;
  }[];
  /**
   * The reads that failed while building this portal, so the page can stop
   * presenting their gaps as answers.
   *
   * Same rule `contextLayers.readFailure` already follows, applied to the two
   * reads that had been collapsing errors into `[]`: the approved comments and
   * the categories. An empty comment list is the single most consequential
   * sentence this portal can say — it is the public record of who took part —
   * and a failed query said it just as confidently as an unused campaign did.
   *
   * Labels are resident-facing and read inside a sentence; messages are NOT
   * carried here, because the reader is a member of the public and the database's
   * own words are operator detail.
   */
  readFailures: { comments: boolean; categories: boolean };
  engagementType: string;
  demographicsEnabled: boolean;
  projectContext: { name: string; summary: string | null } | null;
  surveyQuestions: PortalSurveyQuestionView[];
  closeLoopEntries: PortalCloseLoopEntryView[];
  // Only true when an email transport is actually configured — the "notify me"
  // affordance is hidden otherwise so the UI never promises email it can't send.
  emailUpdatesAvailable: boolean;
  /**
   * Where the resident-facing map opens and why — resolved here rather than in
   * the browser, because the operator console has to be shown the same answer
   * and neither surface can compute it (this module is server-only).
   */
  mapFraming: PortalMapFraming;
  /**
   * The operator's published map layers, resolved server-side for the same
   * reason `mapFraming` is: the query that decides what an anonymous reader may
   * see must not be one the browser gets to ask.
   *
   * Carries `readFailure` rather than collapsing to an empty set. An absent
   * layer and an unreadable one look identical on a map, and only the first is
   * a fact about this campaign.
   */
  contextLayers: ParticipantContextLayerSet;
  /**
   * WHICH LANGUAGE THIS PAGE IS IN, and how that was decided.
   *
   * Resolved here, once, for the same reason `mapFraming` is: two participant
   * surfaces render this portal and a language they compute separately is a
   * language they can disagree about. A page whose heading is Spanish and whose
   * form is English does not look partly translated — it looks like the agency
   * answered in English on purpose.
   *
   * Carries `direction`, so `dir="rtl"` for Arabic and Farsi is a value that
   * travels rather than a derivation each component has to remember. Two of the
   * eleven languages render visibly broken without it.
   */
  locale: ResolvedPortalLocale;
  /**
   * OpenPlan's OWN participant-facing copy in that language, already resolved:
   * this locale's strings plus the list of keys that fell back to English.
   *
   * A plain object rather than a lookup function, because functions do not
   * cross the server/client boundary — the client component rebuilds the
   * translator from this with `createPortalTranslator`. It also means a
   * participant downloads their own language and not the other ten.
   */
  messages: PortalMessageBundle;
};

export type PublicPortalBundle = {
  campaign: PublicPortalCampaign;
  project: PublicPortalProject | null;
  acceptingSubmissions: boolean;
  /**
   * The campaign's own operator-authored text in the participant's language,
   * with provenance. The raw `campaign.title` / `.summary` /
   * `.public_description` above are the SOURCE strings and stay untranslated —
   * a surface that renders them is rendering the original, which is sometimes
   * right (an operator console) and never right on a participant page.
   */
  campaignText: PortalCampaignText;
  locale: ResolvedPortalLocale;
  messages: PortalMessageBundle;
  portalProps: PublicPortalProps;
};

/**
 * What the CALLER knows about the participant's language that this loader
 * cannot work out for itself: the explicit choice in the URL.
 *
 * `Accept-Language` is read here rather than passed, so a surface that forgets
 * this argument still honours the resident's device — the degradation is to
 * "no explicit choice", never to "English regardless".
 */
export type PublicPortalLocaleRequest = {
  /** The raw `?lang=` value. An unsupported one falls back and is disclosed. */
  requestedLocale?: string | null;
  /**
   * Overrides the request header. Tests pass it; production does not need to.
   */
  acceptLanguage?: string | null;
};

export async function loadPublicPortalBundle(
  shareToken: string,
  localeRequest?: PublicPortalLocaleRequest
): Promise<PublicPortalBundle | null> {
  if (!shareToken || shareToken.length < 8) return null;

  const supabase = createServiceRoleClient();

  const acceptLanguage =
    localeRequest?.acceptLanguage !== undefined
      ? localeRequest.acceptLanguage
      : await readAcceptLanguageHeader();

  const locale = resolvePortalLocale({
    requested: localeRequest?.requestedLocale ?? null,
    acceptLanguage,
  });
  const messages = buildPortalMessageBundle(locale);

  const { data: campaignData } = await supabase
    .from("engagement_campaigns")
    .select("id, workspace_id, project_id, title, summary, public_description, status, engagement_type, allow_public_submissions, submissions_closed_at, demographics_enabled, updated_at, accessibility_contact_label, accessibility_contact_email, accessibility_contact_phone, accessibility_alternate_formats")
    .eq("share_token", shareToken)
    .eq("status", "active")
    .maybeSingle();

  if (!campaignData) return null;

  const campaign = campaignData as PublicPortalCampaign;

  const [
    { data: projectData },
    placeCandidates,
    { data: geofenceRow },
    categoriesResult,
    approvedItemsResult,
    surveyDefinition,
    closeLoopRows,
    translationIndex,
  ] = await Promise.all([
    campaign.project_id
      ? supabase.from("projects").select("id, name, summary").eq("id", campaign.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Where this map opens, and why. See `loadPortalPlaceCandidates`.
    loadPortalPlaceCandidates(supabase, campaign),
    /**
     * Whether this campaign refuses pins outside its own area (20260730000002),
     * so the portal does not invite one it will refuse.
     *
     * Read on its own rather than added to the campaign select above, for the
     * reason that select's own header gives about ship order — except that here
     * the consequence is worse, not milder. A column that does not exist yet
     * would make `campaignData` null and the WHOLE public portal 404 for every
     * campaign in the deployment until the migration lands. Keyed by id, it
     * costs one indexed lookup and cannot take the page down.
     *
     * A failed read leaves the sentence off. That is silence, not a claim:
     * enforcement lives in the submit route, which reads the flag itself, so the
     * rule still holds and a refused participant is still told why in words. The
     * portal simply does not assert a rule it could not confirm.
     */
    supabase
      .from("engagement_campaigns")
      .select(SUBMISSION_GEOFENCE_COLUMN)
      .eq("id", campaign.id)
      .maybeSingle(),
    supabase
      .from("engagement_categories")
      .select("id, label, slug, description, sort_order, color")
      .eq("campaign_id", campaign.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("engagement_items")
      .select("id, category_id, title, body, submitted_by, latitude, longitude, geometry, photo_path, votes_count, parent_item_id, created_at")
      .eq("campaign_id", campaign.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(200),
    // Definition tables only; response tables stay confined to survey-responses.ts.
    loadSurveyDefinition(supabase, campaign.id),
    // Published entries only — drafts never leave the operator.
    loadPublishedCloseLoopEntries(supabase, campaign.id),
    // ONE read for every operator translation this campaign has in the
    // participant's language. Not one per string: a portal resolves the
    // campaign, its categories, its questions, its options and its close-loop
    // entries, which is easily a hundred lookups on a page that opens from a
    // phone. A failed read here becomes `unreadable` on every string it would
    // have answered, never `untranslated` — a lookup that broke and an agency
    // that chose not to translate are different facts, and only one of them is
    // about this campaign.
    loadPortalTranslationIndex(supabase, { campaignId: campaign.id, locale: locale.locale }),
  ]);

  const project = (projectData ?? null) as PublicPortalProject | null;
  // A failed read is not an empty campaign. Both of these used to discard their
  // error, so a dropped column or a policy change rendered as "no categories"
  // and "no comments" — the second of which tells the public that nobody
  // participated.
  const categoriesReadFailed = Boolean(categoriesResult.error);
  const approvedItemsReadFailed = Boolean(approvedItemsResult.error);
  const categories = (categoriesResult.data ?? []) as CategoryRow[];
  const approvedItems = (approvedItemsResult.data ?? []) as ApprovedItemRow[];
  const acceptingSubmissions = campaign.allow_public_submissions && !campaign.submissions_closed_at;

  const mapFraming = resolvePortalMapFraming({
    campaignPlace: placeCandidates.campaign,
    projectPlace: placeCandidates.project,
    workspaceHome: placeCandidates.workspaceHome,
    approvedItems,
    submissionGeofenceEnabled:
      (geofenceRow as Record<string, unknown> | null)?.[SUBMISSION_GEOFENCE_COLUMN] === true,
  });

  const surveyQuestions: PortalSurveyQuestionView[] = surveyDefinition.questions.map((question) => {
    // A `map_point` question that names no camera of its own inherits the
    // campaign's framing instead of opening on the continent, and carries the
    // sentence saying which. The question's own camera always wins — see
    // `resolveMapPointQuestionView`. Nothing else has a map, so nothing else
    // has a note.
    const mapPoint =
      question.question_type === "map_point"
        ? resolveMapPointQuestionView(question.config_json, mapFraming)
        : null;

    return {
      id: question.id,
      questionType: question.question_type,
      prompt: question.prompt,
      helpText: question.help_text,
      required: question.required,
      config: mapPoint ? mapPoint.config : question.config_json,
      mapFramingNote: mapPoint ? mapPoint.framingNote : null,
      promptText: resolveOperatorText(
        translationIndex,
        { entity: "survey_question", id: question.id, field: "prompt" },
        question.prompt
      ),
      helpTextText: resolveOptionalOperatorText(
        translationIndex,
        { entity: "survey_question", id: question.id, field: "help_text" },
        question.help_text
      ),
      options: (surveyDefinition.optionsByQuestion.get(question.id) ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        value: option.value,
        // An option label is as participant-facing as the prompt above it: a
        // Spanish survey whose answers are in English cannot be answered.
        labelText: resolveOperatorText(
          translationIndex,
          { entity: "survey_question_option", id: option.id, field: "label" },
          option.label
        ),
      })),
    };
  });

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const closeLoopEntries: PortalCloseLoopEntryView[] = closeLoopRows.map((entry) => {
    const category = entry.category_id ? categoryById.get(entry.category_id) ?? null : null;

    return {
      id: entry.id,
      themeTitle: entry.theme_title,
      youSaid: entry.you_said,
      weDid: entry.we_did,
      categoryLabel: category?.label ?? null,
      themeTitleText: resolveOperatorText(
        translationIndex,
        { entity: "close_loop_entry", id: entry.id, field: "theme_title" },
        entry.theme_title
      ),
      youSaidText: resolveOperatorText(
        translationIndex,
        { entity: "close_loop_entry", id: entry.id, field: "you_said" },
        entry.you_said
      ),
      weDidText: resolveOperatorText(
        translationIndex,
        { entity: "close_loop_entry", id: entry.id, field: "we_did" },
        entry.we_did
      ),
      // The category's OWN translation, not a second one keyed to the entry —
      // one category label translated once, wherever it appears.
      categoryLabelText: category
        ? resolveOperatorText(
            translationIndex,
            { entity: "category", id: category.id, field: "label" },
            category.label
          )
        : null,
    };
  });

  // Photos live in a PRIVATE service-role-only bucket. Short-TTL signed URLs are
  // minted here for APPROVED items only (the query filters status) — pending or
  // rejected photos are never reachable from the public portal or an embed.
  const photoUrlByItemId = new Map<string, string>();
  const photoPaths = approvedItems
    .filter((item) => typeof item.photo_path === "string" && item.photo_path.length > 0)
    .map((item) => item.photo_path as string);

  if (photoPaths.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from(ENGAGEMENT_PHOTO_BUCKET)
      .createSignedUrls(photoPaths, ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS);

    for (const item of approvedItems) {
      if (!item.photo_path) continue;
      const signed = (signedUrls ?? []).find((entry) => entry.path === item.photo_path);
      if (signed?.signedUrl) photoUrlByItemId.set(item.id, signed.signedUrl);
    }
  }

  const portalProps: PublicPortalProps = {
    shareToken,
    acceptingSubmissions,
    categories: categories.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      color: c.color,
      labelText: resolveOperatorText(translationIndex, { entity: "category", id: c.id, field: "label" }, c.label),
      descriptionText: resolveOptionalOperatorText(
        translationIndex,
        { entity: "category", id: c.id, field: "description" },
        c.description
      ),
    })),
    approvedItems: approvedItems.map((item) => ({
      id: item.id,
      categoryId: item.category_id,
      title: item.title,
      body: item.body,
      submittedBy: item.submitted_by,
      latitude: item.latitude,
      longitude: item.longitude,
      geometry: item.geometry ?? null,
      votesCount: item.votes_count ?? 0,
      parentItemId: item.parent_item_id,
      photoUrl: photoUrlByItemId.get(item.id) ?? null,
      createdAt: item.created_at,
    })),
    readFailures: { comments: approvedItemsReadFailed, categories: categoriesReadFailed },
    engagementType: campaign.engagement_type,
    demographicsEnabled: campaign.demographics_enabled,
    projectContext: project ? { name: project.name, summary: project.summary } : null,
    surveyQuestions,
    closeLoopEntries,
    emailUpdatesAvailable: isEmailTransportConfigured(),
    mapFraming,
    // The operator's published context layers — the alignment, the parcels, the
    // existing bike network — on the map a resident draws on. The portal
    // component and both participant maps already accept and paint these; this
    // loader was the missing caller, which is the only reason the capability
    // could ship complete and be reachable by nobody.
    //
    // `loadParticipantContextLayers` filters on `visible_to_participants`, so
    // an unpublished layer never crosses to an anonymous reader, and it reports
    // a failed read rather than returning an empty set — an absent layer and an
    // unreadable one look identical on a map, and only one of them is a fact
    // about this campaign.
    contextLayers: await loadParticipantContextLayers(supabase, campaign.id),
    locale,
    messages,
  };

  const campaignText: PortalCampaignText = {
    title: resolveOperatorText(
      translationIndex,
      { entity: "campaign", id: campaign.id, field: "title" },
      campaign.title
    ),
    summary: resolveOptionalOperatorText(
      translationIndex,
      { entity: "campaign", id: campaign.id, field: "summary" },
      campaign.summary
    ),
    publicDescription: resolveOptionalOperatorText(
      translationIndex,
      { entity: "campaign", id: campaign.id, field: "public_description" },
      campaign.public_description
    ),
    /*
      TRANSLATED, because this is the sentence that matters most to the resident
      least able to read the rest of the page. A person who cannot use the map
      AND cannot read English needs "here is how else to take part" in their own
      language, or it is not an offer they can act on.

      The email and phone are NOT resolved: an address is not prose, and running
      it through a translation path would invite a machine-translated contact
      that reaches nobody.
    */
    accessibilityContactLabel: resolveOptionalOperatorText(
      translationIndex,
      { entity: "campaign", id: campaign.id, field: "accessibility_contact_label" },
      campaign.accessibility_contact_label
    ),
    accessibilityAlternateFormats: resolveOptionalOperatorText(
      translationIndex,
      { entity: "campaign", id: campaign.id, field: "accessibility_alternate_formats" },
      campaign.accessibility_alternate_formats
    ),
  };

  return { campaign, project, acceptingSubmissions, campaignText, locale, messages, portalProps };
}

/**
 * Exported so a test can build a resolver index without a database. Re-exported
 * rather than re-implemented, so a test can never assert against a second copy
 * of the resolution rules.
 */
export type { PortalText, PortalTranslationIndex };
