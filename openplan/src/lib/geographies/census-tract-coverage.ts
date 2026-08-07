import { DRAWN_PLACE_SOURCE, type PlaceOfRecord } from "@/lib/geographies/place-of-record";
import { MAP_FEATURE_LAYER_LIMIT } from "@/lib/geographies/census-tract-scope";
import { PLACE_KIND_LABELS } from "@/lib/api/place-geographies";
import { tigerwebCountyFipsFromProjectPlace } from "@/lib/projects/project-place";
import type { CountyIngestResult } from "@/lib/data-sources/census-tract-ingest";

/**
 * Whether a place can have census tracts loaded for it, and what to say when it
 * cannot.
 *
 * The equity layer is the one map layer the README advertises that could not be
 * filled from inside the app. `POST /api/geographies/census-tracts/ingest`
 * existed and worked, but had no UI caller anywhere — its only trigger was a
 * fire-and-forget `after()` block on the home-geography PATCH, which swallowed
 * every error, could not be retried, and ran on the default function budget
 * while the dedicated route documents needing sixty seconds. So a workspace
 * whose load was cut off mid-county had a partly-filled layer, no way to tell,
 * and no way to try again.
 *
 * THIS MODULE NEVER RE-DECIDES whether a place is a loadable county.
 * `tigerwebCountyFipsFromProjectPlace` is the single authority on that; this
 * calls it, and only when the answer is null does it work out WHICH guard
 * refused, so the interface can name the real reason. Two independent county
 * derivations is exactly the drift the home-geography route's own comment
 * warns about — "so what gets INGESTED and what gets DRAWN can never disagree".
 *
 * Every refusal below states what was not done, states what it does NOT
 * establish about the place, and names the real next step. An empty layer must
 * never read as "there is nothing here".
 */

export type CensusTractCoverageBlockedReason =
  /** Nothing set at all. */
  | "no_place"
  /** A hand-drawn shape: extent without identity. */
  | "drawn"
  /** A city, CDP, metro or micro area — tracts load county by county. */
  | "kind_unsupported"
  /** Census tracts are a US Census Bureau product. */
  | "not_us"
  /** Some resolver other than the Census boundary service. */
  | "unrecognized_source"
  /** Says county, but the stored ref is not a 5-digit GEOID. */
  | "malformed_ref";

export type CensusTractCoverageTarget =
  | { kind: "county"; stateFips: string; countyFips: string; label: string | null }
  | {
      kind: "blocked";
      reason: CensusTractCoverageBlockedReason;
      label: string | null;
      placeKind: string | null;
      source: string | null;
    };

/** Where this control is mounted. Chooses wording only — never which county. */
export type CensusTractCoverageOrigin = "workspace_home_geography" | "project_study_area";

/** The label, or a neutral stand-in — never empty quotes. */
export function coveragePlaceName(label: string | null): string {
  return label && label.trim().length > 0 ? label.trim() : "this area";
}

const US_COUNTRY_CODE = "US";
const CENSUS_BOUNDARY_SOURCE = "tigerweb";

export function resolveCensusTractCoverageTarget(
  place: PlaceOfRecord | null | undefined
): CensusTractCoverageTarget {
  const label = place?.label?.trim() || null;
  const placeKind = place?.kind ?? null;
  const source = place?.source ?? null;

  const county = tigerwebCountyFipsFromProjectPlace(place ?? null);
  if (county) {
    return { kind: "county", stateFips: county.stateFips, countyFips: county.countyFips, label };
  }

  const blocked = (reason: CensusTractCoverageBlockedReason): CensusTractCoverageTarget => ({
    kind: "blocked",
    reason,
    label,
    placeKind,
    source,
  });

  // Explain the SAME guards the authority applies, in the order it applies them.
  if (!place || (!source && !placeKind && !place.ref)) return blocked("no_place");
  if (source === DRAWN_PLACE_SOURCE) return blocked("drawn");
  if (source !== CENSUS_BOUNDARY_SOURCE) return blocked("unrecognized_source");
  if ((place.countryCode ?? US_COUNTRY_CODE).toUpperCase() !== US_COUNTRY_CODE) return blocked("not_us");
  if (placeKind !== "county") return blocked("kind_unsupported");
  return blocked("malformed_ref");
}

function kindLabel(placeKind: string | null): string {
  if (!placeKind) return "place";
  return (PLACE_KIND_LABELS as Record<string, string>)[placeKind] ?? placeKind;
}

/**
 * Why no tracts can be loaded for this place, and what to do instead.
 *
 * `affectsWorkspaceLayer` is false when the county is not the one this
 * workspace's equity layer draws — which is true for every project mount,
 * because `resolveCensusTractScope` scopes that layer to the workspace's HOME
 * geography and to nothing else.
 */
export function describeBlockedCoverage(
  target: Extract<CensusTractCoverageTarget, { kind: "blocked" }>,
  options: { origin: CensusTractCoverageOrigin }
): string[] {
  const name = coveragePlaceName(target.label);

  switch (target.reason) {
    case "no_place":
      return options.origin === "project_study_area"
        ? ["No study area is set for this project, so there is no county to check tract coverage for."]
        : [
            "No home geography is set for this workspace, so there is no county to check tract " +
              "coverage for.",
          ];

    case "drawn":
      return [
        `${name} was drawn by hand, so it carries no county identity. Census tracts load county by ` +
          "county, and OpenPlan will not guess which county contains a drawn shape. This is not a " +
          "finding that the area has no census tracts — none have been requested for it. Search for " +
          "the county instead, and tract coverage can be loaded for it.",
      ];

    case "kind_unsupported":
      return [
        `Census tracts load county by county, and this place is recorded as a ${kindLabel(target.placeKind)}. ` +
          "OpenPlan will not pick a county for it — a place can sit in more than one, and a metro area " +
          `can cross state lines. This is not a finding that ${name} has no census tracts; none have ` +
          "been requested for it. Choose the county it sits in to load tract coverage.",
      ];

    case "not_us":
      return [
        "Census tracts come from the US Census Bureau, and this place is recorded outside the United " +
          "States, so there is no tract coverage to load for it. That is a limit of the data source, " +
          "not a finding about the place. Coverage outside the United States is not built.",
      ];

    case "unrecognized_source":
      return [
        `This area came from ${target.source ?? "another resolver"} rather than the US Census boundary ` +
          "service tract coverage is keyed to, so no county code can be derived from it. This is not a " +
          "finding that the area has no census tracts. Re-pick the place from search so it carries an " +
          "official Census boundary reference.",
      ];

    case "malformed_ref":
      return [
        "This area is recorded as a county, but its stored reference is not a 5-digit Census county " +
          "code, so no county could be derived from it. This is not a finding about tract coverage for " +
          "the place. Re-pick the county from search to repair the reference.",
      ];
  }
}

/**
 * What is loaded for a resolved county right now.
 *
 * `storedTractCount` is always re-read from the database rather than taken from
 * an ingest response: `ingestCensusTractsForCounty` upserts tract by tract and
 * reports a PARTIAL count when an upsert fails midway, so reporting its number
 * would assert a completed load that did not complete.
 */
export function describeCountyCoverage(options: {
  label: string | null;
  storedTractCount: number;
  affectsWorkspaceLayer: boolean;
  mapLimit?: number;
  /**
   * Tracts stored without the ACS universes their rates are divided by — the
   * ones loaded before migration 20260805000010. `null` means the count could
   * not be read, and says nothing either way.
   */
  staleUniverseTractCount?: number | null;
}): string[] {
  const name = coveragePlaceName(options.label);
  const limit = options.mapLimit ?? MAP_FEATURE_LAYER_LIMIT;
  const notes: string[] = [];

  if (options.storedTractCount === 0) {
    notes.push(
      `No census tracts are loaded for ${name} yet, so the equity layer draws nothing for it. This is ` +
        "not a finding that the county has no census tracts — none have been fetched. Loading pulls " +
        "every tract boundary and its ACS demographics from the US Census Bureau and takes up to a minute."
    );
  } else {
    notes.push(
      `${options.storedTractCount.toLocaleString()} census tracts are loaded for ${name}.`
    );
    if (options.storedTractCount > limit) {
      notes.push(
        `The map draws at most ${limit.toLocaleString()} of them at a time, by tract ID — the rest are ` +
          "stored but not drawn."
      );
    }
  }

  /**
   * THE RELOAD THAT IS NOT OPTIONAL, said before the one that is.
   *
   * A tract stored before OpenPlan recorded the ACS universes has no poverty
   * rate and no minority share — not a stale one, none. It is dropped from the
   * Title VI service-equity comparison and from the choropleth's poverty
   * figure, and both say so where they say it. But a planner reading "—" has no
   * way to know that reloading is the fix, and this control is the only place in
   * the product that can do the reloading. Saying nothing here would leave an
   * honest refusal that nobody can act on.
   */
  const stale = options.staleUniverseTractCount;
  if (typeof stale === "number" && stale > 0) {
    notes.push(
      `${stale.toLocaleString()} of them were loaded before OpenPlan recorded which Census population ` +
        "each rate is measured against, so they report no poverty rate and no minority share at all — " +
        "in the equity layer and in a Title VI service comparison alike. Reloading fixes it. Until then " +
        "those tracts are left out of the figures rather than counted with a rate divided by the wrong " +
        "population, which is what OpenPlan used to do and what understated poverty in tracts holding a " +
        "prison, a university or a barracks."
    );
  }

  if (!options.affectsWorkspaceLayer) {
    notes.push(
      "This county is not this workspace's home geography, so loading it will not change what the " +
        "equity layer on your map draws. Census tract data is public and shared: it is stored once for " +
        "every workspace, and it will already be there if this workspace's home geography is ever set " +
        "to this county."
    );
  }

  return notes;
}

/** What a completed (or partly completed) load actually did. */
export function describeCoverageLoadOutcome(
  result: Pick<CountyIngestResult, "status" | "tractsUpserted" | "unmatched" | "error">,
  options: { label: string | null; storedTractCount: number }
): string[] {
  const name = coveragePlaceName(options.label);
  const stored = `${options.storedTractCount.toLocaleString()} census tracts are stored for this county now.`;
  const censusKeyRemedy =
    "The usual cause is a missing Census API key: add one under Integration keys on the dashboard, or " +
    "ask whoever runs this deployment to set CENSUS_API_KEY.";

  switch (result.status) {
    case "ingested":
      if (result.tractsUpserted === 0 && result.unmatched > 0) {
        return [
          `Nothing was stored for ${name}: all ${result.unmatched.toLocaleString()} tract boundaries came ` +
            "back without matching ACS demographics. This is not a finding that the county has no " +
            "tracts — the boundaries exist, the demographics did not join to them.",
          censusKeyRemedy,
        ];
      }
      if (result.unmatched > 0) {
        return [
          `Loaded ${result.tractsUpserted.toLocaleString()} census tracts for ${name}. ` +
            `${result.unmatched.toLocaleString()} more had a boundary but no matching ACS demographics in ` +
            "this release, so they were not stored — they are missing from the equity layer rather than " +
            `absent from the county. ${stored}`,
        ];
      }
      return [`Loaded ${result.tractsUpserted.toLocaleString()} census tracts for ${name}. ${stored}`];

    case "no_tracts":
      return [
        `The US Census boundary service returned no tracts for ${name}, so nothing was stored. That is ` +
          "an answer from the source, not a measurement of the county. If the county is right, the " +
          "service may be unavailable right now — try again later.",
      ];

    case "no_demographics":
      return [
        `Tract boundaries came back for ${name}, but the Census ACS returned no demographics for it, so ` +
          "nothing was stored. This is not a finding that the county has no published demographics.",
        censusKeyRemedy,
      ];

    case "failed":
      return [
        `The load stopped part way through ${name}: ${result.error ?? "the source did not respond"}. ` +
          `${stored} That is a partial load, not a complete one. Loading again re-fetches from the ` +
          "source and overwrites what is there.",
      ];
  }
}

/** A load that never reported back — timed out, lost its session, or errored. */
export function describeCoverageLoadFailure(options: {
  label: string | null;
  message: string;
  httpStatus: number | null;
  storedTractCount: number;
}): string[] {
  const name = coveragePlaceName(options.label);
  const stored =
    `${options.storedTractCount.toLocaleString()} census tracts are stored for ${name} right now, which ` +
    "may be a partial load.";

  if (options.httpStatus === 401) {
    return [`Your session expired before the load finished, so it did not complete. Sign in again and retry. ${stored}`];
  }
  if (options.httpStatus === 504 || /timeout|abort/i.test(options.message)) {
    return [
      "The load ran past this deployment's 60-second limit and was cut off. " +
        `${stored} Loading again is safe and picks up from what is already stored.`,
    ];
  }
  return [`The load did not complete: ${options.message}. ${stored} Loading is safe to repeat.`];
}
