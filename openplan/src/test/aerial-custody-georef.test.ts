import { describe, expect, it, vi } from "vitest";

import {
  AERIAL_ORTHO_PREVIEW_KIND,
  MAX_GEOREF_BOUNDS_SPAN_DEGREES,
  extractArtifactGeoref,
  georefBoundsFromCustodyRecord,
  isMissingCustodyGeorefColumnError,
  summarizeAerialArtifactCustody,
  type AerialArtifactCustodyRecord,
} from "@/lib/aerial/artifact-custody";
import {
  runAerialCustodyPass,
  type CustodySupabaseClient,
  type CustodySupabaseLike,
} from "@/lib/aerial/artifact-custody-server";

/**
 * Georeferencing is worker-REPORTED, validated at every door, and never
 * inferred. These tests pin the three doors:
 *
 *   1. the extractor refuses anything that could not place an image truthfully
 *      (the map's bounds validation, applied at intake);
 *   2. the custody engine writes exactly what a validated report said — and
 *      all-null when nothing was reported, which is the honest v1-worker case;
 *   3. the deploy-window fallback retries WITHOUT the georef columns only on
 *      the specific unknown-column failure, never on a real error.
 */

const VALID_BOUNDS = [-120.51, 39.2, -120.49, 39.22];

describe("extractArtifactGeoref — the intake validator", () => {
  it("treats an absent report as absent, not as a refusal", () => {
    expect(extractArtifactGeoref({ kind: "orthomosaic" })).toEqual({
      georef: null,
      refusedReason: null,
    });
    expect(extractArtifactGeoref(null)).toEqual({ georef: null, refusedReason: null });
  });

  it("accepts a plausible report and bounds the strings it stores", () => {
    const { georef, refusedReason } = extractArtifactGeoref({
      boundsWgs84: VALID_BOUNDS,
      crs: `  EPSG:32610${"x".repeat(200)}`,
      pixelSizeM: 0.021,
    });
    expect(refusedReason).toBeNull();
    expect(georef).toMatchObject({
      boundsWest: -120.51,
      boundsSouth: 39.2,
      boundsEast: -120.49,
      boundsNorth: 39.22,
      pixelSizeM: 0.021,
    });
    // Worker-authored string, stored and displayed: bounded hard.
    expect(georef!.crs!.length).toBeLessThanOrEqual(64);
  });

  it.each([
    ["wrong shape", [1, 2, 3], /four-number/],
    ["non-finite", [Number.NaN, 0, 1, 1], /non-finite/],
    ["off the planet", [-500, 39.2, -120.49, 39.22], /outside WGS84/],
    ["inverted rectangle", [-120.49, 39.2, -120.51, 39.22], /west must be < east/],
    ["zero-area", [-120.5, 39.2, -120.5, 39.22], /west must be < east/],
    [
      "continent-wide",
      [-120, 30, -100, 40],
      new RegExp(`${MAX_GEOREF_BOUNDS_SPAN_DEGREES} degrees`),
    ],
  ])("refuses %s bounds with a stated reason", (_label, bounds, reason) => {
    const result = extractArtifactGeoref({ boundsWgs84: bounds });
    expect(result.georef).toBeNull();
    expect(result.refusedReason).toMatch(reason as RegExp);
  });

  it("drops a non-positive pixel size without dropping the bounds", () => {
    const { georef } = extractArtifactGeoref({ boundsWgs84: VALID_BOUNDS, pixelSizeM: -1 });
    expect(georef).not.toBeNull();
    expect(georef!.pixelSizeM).toBeNull();
  });
});

describe("georefBoundsFromCustodyRecord — the read-side door", () => {
  it("returns validated bounds for a placed row and null for an unplaced one", () => {
    expect(
      georefBoundsFromCustodyRecord({
        bounds_west: -120.51,
        bounds_south: 39.2,
        bounds_east: -120.49,
        bounds_north: 39.22,
      })
    ).toEqual([-120.51, 39.2, -120.49, 39.22]);

    expect(
      georefBoundsFromCustodyRecord({
        bounds_west: null,
        bounds_south: null,
        bounds_east: null,
        bounds_north: null,
      })
    ).toBeNull();
  });

  it("refuses a stored rectangle no single flight could produce", () => {
    // The row travelled through a database to get here; validation does not
    // stop because storage happened.
    expect(
      georefBoundsFromCustodyRecord({
        bounds_west: -179,
        bounds_south: -80,
        bounds_east: 179,
        bounds_north: 80,
      })
    ).toBeNull();
  });
});

describe("posture — a map-displayable preview is a derived fact", () => {
  const base: AerialArtifactCustodyRecord = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind: AERIAL_ORTHO_PREVIEW_KIND,
    ordinal: 0,
    state: "held",
    storage_bucket: "aerial-artifacts",
    storage_path: "a/b/c/ortho_preview.png",
    byte_size: 10,
    checksum_sha256: "a".repeat(64),
    content_type: "image/png",
    declared_size_bytes: 10,
    source_host: "worker.example.net",
    source_expires_at: "2099-01-01T00:00:00Z",
    failure_code: null,
    failure_detail: null,
    attempt_count: 1,
    held_at: "2026-08-11T00:00:00Z",
    bounds_west: -120.51,
    bounds_south: 39.2,
    bounds_east: -120.49,
    bounds_north: 39.22,
    crs: "EPSG:32610",
    pixel_size_m: 0.021,
  };

  it("is true only for a HELD ortho_preview with validated bounds", () => {
    expect(summarizeAerialArtifactCustody([base]).hasMapDisplayablePreview).toBe(true);

    // Same georef on a different kind: the map draws previews, not GeoTIFFs.
    expect(
      summarizeAerialArtifactCustody([{ ...base, kind: "orthomosaic" }]).hasMapDisplayablePreview
    ).toBe(false);

    // Held but unplaced — the external-worker case. False is the honest answer.
    expect(
      summarizeAerialArtifactCustody([
        { ...base, bounds_west: null, bounds_south: null, bounds_east: null, bounds_north: null },
      ]).hasMapDisplayablePreview
    ).toBe(false);

    // Placed but not held: there is nothing to draw.
    expect(
      summarizeAerialArtifactCustody([
        { ...base, state: "pending", storage_bucket: null, storage_path: null, byte_size: null, checksum_sha256: null },
      ]).hasMapDisplayablePreview
    ).toBe(false);
  });
});

describe("isMissingCustodyGeorefColumnError — the fallback trigger", () => {
  it("matches only the unknown-column failure naming a georef column", () => {
    expect(
      isMissingCustodyGeorefColumnError({
        code: "PGRST204",
        message: "Could not find the 'bounds_west' column of 'aerial_artifact_custody'",
      })
    ).toBe(true);
    expect(
      isMissingCustodyGeorefColumnError({ code: "42703", message: "column \"pixel_size_m\" does not exist" })
    ).toBe(true);

    // A constraint violation is a REAL error and must surface as itself even
    // when its message happens to name a georef column.
    expect(
      isMissingCustodyGeorefColumnError({
        code: "23514",
        message: "new row violates check constraint involving bounds_west",
      })
    ).toBe(false);
    // An unknown-column failure about some OTHER column is not this seam.
    expect(
      isMissingCustodyGeorefColumnError({ code: "PGRST204", message: "Could not find the 'held_at' column" })
    ).toBe(false);
    expect(isMissingCustodyGeorefColumnError(null)).toBe(false);
  });
});

// ── The engine writes what the report said ───────────────────────────────────

const JOB = {
  processingJobId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  missionId: "22222222-2222-4222-8222-222222222222",
};
const FUTURE = "2099-01-01T00:00:00Z";
const PRIOR_CUSTODY_SELECT = "kind, ordinal, state, attempt_count";

type EngineHarness = {
  supabase: CustodySupabaseLike;
  upserted: Record<string, unknown>[][];
  upsertErrors: Array<{ message?: string; code?: string } | null>;
};

function engineHarness(): EngineHarness {
  const state: EngineHarness = {
    supabase: null as unknown as CustodySupabaseLike,
    upserted: [],
    upsertErrors: [],
  };

  state.supabase = {
    from: () => ({
      upsert: (rows: unknown[]) => {
        state.upserted.push(rows as Record<string, unknown>[]);
        const error = state.upsertErrors.shift() ?? null;
        return Promise.resolve({ error });
      },
      select: (columns: string) => ({
        eq: () =>
          Promise.resolve(
            columns === PRIOR_CUSTODY_SELECT
              ? { data: [], error: null }
              : { data: state.upserted.flat(), error: null }
          ),
      }),
      update: () => ({
        eq: () => ({ select: () => Promise.resolve({ data: [{ id: JOB.processingJobId }], error: null }) }),
      }),
    }),
    storage: {
      from: () => ({ upload: () => Promise.resolve({ error: null }) }),
    },
  } as unknown as CustodySupabaseLike;

  return state;
}

const okFetch = () =>
  vi.fn(async () =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } })
  ) as unknown as typeof fetch;

function previewCandidate(georef: Record<string, unknown> | null) {
  return {
    kind: AERIAL_ORTHO_PREVIEW_KIND,
    ordinal: 0,
    downloadUrl: "https://worker.example.net/preview.png?sig=abc",
    expiresAt: FUTURE,
    sizeBytes: 3,
    contentType: "image/png",
    georef: georef as never,
  };
}

const REPORTED_GEOREF = {
  boundsWest: -120.51,
  boundsSouth: 39.2,
  boundsEast: -120.49,
  boundsNorth: 39.22,
  crs: "EPSG:32610",
  pixelSizeM: 0.021,
};

describe("runAerialCustodyPass — georef columns", () => {
  it("writes the candidate's validated georef onto the held row, and all-null when none was reported", async () => {
    const h = engineHarness();

    await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [
        previewCandidate(REPORTED_GEOREF),
        { ...previewCandidate(null), kind: "orthomosaic" },
      ],
      fetchImpl: okFetch(),
    });

    const rows = h.upserted.flat();
    const placed = rows.find((row) => row.kind === AERIAL_ORTHO_PREVIEW_KIND);
    expect(placed).toMatchObject({
      state: "held",
      bounds_west: -120.51,
      bounds_south: 39.2,
      bounds_east: -120.49,
      bounds_north: 39.22,
      crs: "EPSG:32610",
      pixel_size_m: 0.021,
    });

    const unplaced = rows.find((row) => row.kind === "orthomosaic");
    expect(unplaced).toMatchObject({
      state: "held",
      bounds_west: null,
      bounds_south: null,
      bounds_east: null,
      bounds_north: null,
      crs: null,
      pixel_size_m: null,
    });
  });

  it("keeps the worker's placement report on a row whose fetch failed", async () => {
    const h = engineHarness();
    const failingFetch = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;

    await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [previewCandidate(REPORTED_GEOREF)],
      fetchImpl: failingFetch,
    });

    const row = h.upserted.flat()[0];
    expect(row.state).toBe("failed");
    // Where the artifact BELONGS is known even while the bytes are not held.
    expect(row.bounds_west).toBe(-120.51);
    expect(row.crs).toBe("EPSG:32610");
  });

  it("retries WITHOUT the georef columns when the database predates the migration — and only then", async () => {
    const h = engineHarness();
    h.upsertErrors.push({
      code: "PGRST204",
      message: "Could not find the 'bounds_west' column of 'aerial_artifact_custody' in the schema cache",
    });

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [previewCandidate(REPORTED_GEOREF)],
      fetchImpl: okFetch(),
    });

    // Two upsert attempts: the second carries NO georef keys at all — absent,
    // not null, or PostgREST fails on the same unknown column again.
    expect(h.upserted).toHaveLength(2);
    const retried = h.upserted[1][0];
    for (const column of ["bounds_west", "bounds_south", "bounds_east", "bounds_north", "crs", "pixel_size_m"]) {
      expect(Object.hasOwn(retried, column), `${column} should be stripped`).toBe(false);
    }
    expect(retried.state).toBe("held");
    // The pass as a whole succeeded: custody is recorded, just without placement.
    expect(result.unreadableReason).toBeNull();
  });

  it("does NOT retry on a real write failure, which surfaces as itself", async () => {
    const h = engineHarness();
    h.upsertErrors.push({ code: "23514", message: "violates check constraint (bounds_west)" });

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [previewCandidate(REPORTED_GEOREF)],
      fetchImpl: okFetch(),
    });

    expect(h.upserted).toHaveLength(1);
    expect(result.unreadableReason).toMatch(/could not be recorded/);
  });
});
