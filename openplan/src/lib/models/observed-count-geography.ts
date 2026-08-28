import { createHash } from "node:crypto";

import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { stateUspsFromFips } from "@/lib/geographies/state-fips";

export type ObservedCountGeographySnapshot = {
  schema: "openplan.observed-count-geography.v1";
  resolution: "resolved" | "unresolved" | "unsupported";
  countryCode: string | "unknown";
  subdivisions: Array<{ fips: string; code: string }>;
  intersectedTractCount: number;
  geometrySha256: string;
  resolver: "census_tracts_intersection";
  detail: string;
};

type ResolverRow = {
  state?: unknown;
  state_fips_json?: unknown;
  tract_count?: unknown;
  detail?: unknown;
};

function geometrySha256(geometry: unknown): string {
  return createHash("sha256").update(canonicalizeActionPayload(geometry)).digest("hex");
}

/**
 * Freeze every subdivision returned by the shared Census geography resolver.
 * A project place-of-record may establish that a polygon is outside the US;
 * otherwise an empty geography read remains unresolved instead of being
 * guessed from longitude or a hand-maintained state box.
 */
export function buildObservedCountGeographySnapshot(input: {
  geometry: unknown;
  projectCountryCode?: string | null;
  resolverRow?: ResolverRow | null;
  resolverError?: string | null;
}): ObservedCountGeographySnapshot {
  const countryCode = input.projectCountryCode?.trim().toUpperCase() || "unknown";
  const base = {
    schema: "openplan.observed-count-geography.v1" as const,
    countryCode,
    intersectedTractCount: 0,
    geometrySha256: geometrySha256(input.geometry),
    resolver: "census_tracts_intersection" as const,
  };

  if (countryCode !== "unknown" && countryCode !== "US") {
    return {
      ...base,
      resolution: "unsupported",
      subdivisions: [],
      detail: `Observed-count adapters do not support country ${countryCode}.`,
    };
  }

  if (input.resolverError) {
    return {
      ...base,
      resolution: "unresolved",
      subdivisions: [],
      detail: `Subdivision resolution was unavailable: ${input.resolverError}`,
    };
  }

  const row = input.resolverRow ?? {};
  const rawFips = Array.isArray(row.state_fips_json) ? row.state_fips_json : [];
  const subdivisions = Array.from(
    new Map(
      rawFips.flatMap((value) => {
        const fips = typeof value === "string" ? value : "";
        const code = /^\d{2}$/.test(fips) ? stateUspsFromFips(fips) : null;
        return code ? [[fips, { fips, code }] as const] : [];
      }),
    ).values(),
  ).sort((left, right) => left.fips.localeCompare(right.fips));
  const tractCount = Number(row.tract_count);

  if (row.state === "resolved" && subdivisions.length > 0) {
    return {
      ...base,
      countryCode: "US",
      resolution: "resolved",
      subdivisions,
      intersectedTractCount: Number.isSafeInteger(tractCount) && tractCount >= 0 ? tractCount : 0,
      detail:
        typeof row.detail === "string" && row.detail.trim()
          ? row.detail
          : "Every intersected US subdivision was resolved from the exact run polygon.",
    };
  }

  return {
    ...base,
    resolution: "unresolved",
    subdivisions: [],
    intersectedTractCount: Number.isSafeInteger(tractCount) && tractCount >= 0 ? tractCount : 0,
    detail:
      typeof row.detail === "string" && row.detail.trim()
        ? row.detail
        : "The exact run polygon did not resolve to loaded US subdivisions.",
  };
}
