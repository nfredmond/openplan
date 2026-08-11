import { describe, expect, it } from "vitest";

import {
  AERIAL_ARTIFACT_CUSTODY_COLUMNS,
  AERIAL_ORTHO_PREVIEW_KIND,
} from "@/lib/aerial/artifact-custody";
import {
  ORTHO_PREVIEW_SIGNED_URL_TTL_SECONDS,
  loadAerialOrthoPreview,
} from "@/lib/aerial/ortho-preview";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The mission map's preview loader: one artifact may be drawn, and every way it
 * may not be is a DIFFERENT sentence. "No preview", "not held", "held but the
 * worker reported no georeferencing", and "the read failed" are four facts a
 * planner acts on differently, and a blank map flattens all of them.
 *
 * The fakes RECORD what was asked — filters, projection, signing arguments —
 * because on a service-role signing path the .eq() chain and the path handed to
 * createSignedUrl ARE the access control (the service-role-pages lesson: a fake
 * that records nothing proves none of it).
 */

const MISSION_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

function heldPreviewRow(overrides: Row = {}): Row {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind: AERIAL_ORTHO_PREVIEW_KIND,
    ordinal: 0,
    state: "held",
    storage_bucket: "aerial-artifacts",
    storage_path: "ws/mission/job/ortho_preview.png",
    byte_size: 12345,
    checksum_sha256: "a".repeat(64),
    content_type: "image/png",
    declared_size_bytes: 12345,
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
    ...overrides,
  };
}

function fakes(input: {
  rows?: Row[];
  readError?: { message?: string; code?: string } | null;
  signError?: { message?: string } | null;
  signedUrl?: string;
}) {
  const selects: string[] = [];
  const filters: Array<[string, string]> = [];
  const signCalls: Array<{ bucket: string; path: string; ttl: number }> = [];

  const supabase = {
    from: (table: string) => {
      expect(table).toBe("aerial_artifact_custody");
      return {
        select: (columns: string) => {
          selects.push(columns);
          return {
            eq: (column: string, value: string) => {
              filters.push([column, value]);
              return {
                eq: (column2: string, value2: string) => {
                  filters.push([column2, value2]);
                  return {
                    order: () =>
                      Promise.resolve(
                        input.readError
                          ? { data: null, error: input.readError }
                          : { data: input.rows ?? [], error: null }
                      ),
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Pick<SupabaseClient, "from">;

  const signer = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string, ttl: number) => {
          signCalls.push({ bucket, path, ttl });
          return Promise.resolve(
            input.signError
              ? { data: null, error: input.signError }
              : { data: { signedUrl: input.signedUrl ?? "https://signed.example/preview.png?token=t" }, error: null }
          );
        },
      }),
    },
  } as unknown as Pick<SupabaseClient, "storage">;

  return { supabase, signer, selects, filters, signCalls };
}

describe("loadAerialOrthoPreview", () => {
  it("answers ready with the signed URL, the validated bounds, and records exactly what it signed", async () => {
    const f = fakes({ rows: [heldPreviewRow()] });

    const result = await loadAerialOrthoPreview({ supabase: f.supabase, signer: f.signer, missionId: MISSION_ID });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("unreachable");
    expect(result.bounds).toEqual([-120.51, 39.2, -120.49, 39.22]);
    expect(result.url).toContain("https://signed.example/");
    expect(result.crs).toBe("EPSG:32610");

    // The read asked for the shared projection, scoped to THIS mission and to
    // the preview kind — the scoping IS the access control on this path.
    expect(f.selects[0]).toBe(AERIAL_ARTIFACT_CUSTODY_COLUMNS);
    expect(f.filters).toContainEqual(["mission_id", MISSION_ID]);
    expect(f.filters).toContainEqual(["kind", AERIAL_ORTHO_PREVIEW_KIND]);

    // The signature covers the row's own stored path at the shared short TTL.
    expect(f.signCalls).toEqual([
      {
        bucket: "aerial-artifacts",
        path: "ws/mission/job/ortho_preview.png",
        ttl: ORTHO_PREVIEW_SIGNED_URL_TTL_SECONDS,
      },
    ]);
  });

  it("refuses no_preview_artifact when the worker never reported one", async () => {
    const f = fakes({ rows: [] });
    const result = await loadAerialOrthoPreview({ supabase: f.supabase, signer: f.signer, missionId: MISSION_ID });
    expect(result).toMatchObject({ status: "refused", reason: "no_preview_artifact" });
    expect(f.signCalls).toEqual([]);
  });

  it("refuses preview_not_held when the row exists but the bytes are not in custody", async () => {
    const f = fakes({
      rows: [heldPreviewRow({ state: "pending", storage_bucket: null, storage_path: null })],
    });
    const result = await loadAerialOrthoPreview({ supabase: f.supabase, signer: f.signer, missionId: MISSION_ID });
    expect(result).toMatchObject({ status: "refused", reason: "preview_not_held" });
    expect(f.signCalls).toEqual([]);
  });

  it("refuses no_georeference when held bounds are absent — the external-worker case", async () => {
    const f = fakes({
      rows: [
        heldPreviewRow({ bounds_west: null, bounds_south: null, bounds_east: null, bounds_north: null }),
      ],
    });
    const result = await loadAerialOrthoPreview({ supabase: f.supabase, signer: f.signer, missionId: MISSION_ID });
    expect(result).toMatchObject({ status: "refused", reason: "no_georeference" });
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.detail).toMatch(/was not reported by the processing worker/);
    expect(f.signCalls).toEqual([]);
  });

  it("refuses no_georeference for STORED bounds that fail validation — storage is not trust", async () => {
    const f = fakes({
      rows: [
        heldPreviewRow({ bounds_west: -179, bounds_south: -80, bounds_east: 179, bounds_north: 80 }),
      ],
    });
    const result = await loadAerialOrthoPreview({ supabase: f.supabase, signer: f.signer, missionId: MISSION_ID });
    expect(result).toMatchObject({ status: "refused", reason: "no_georeference" });
    expect(f.signCalls).toEqual([]);
  });

  it("will not sign a path outside the custody bucket or a traversal path", async () => {
    for (const overrides of [
      { storage_bucket: "some-other-bucket" },
      { storage_path: "ws/../other-workspace/secret.png" },
    ]) {
      const f = fakes({ rows: [heldPreviewRow(overrides)] });
      const result = await loadAerialOrthoPreview({ supabase: f.supabase, signer: f.signer, missionId: MISSION_ID });
      expect(result.status).toBe("unreadable");
      expect(f.signCalls).toEqual([]);
    }
  });

  it("reports a failed read as unreadable — never as a missing preview", async () => {
    const f = fakes({ readError: { message: "permission denied", code: "42501" } });
    const result = await loadAerialOrthoPreview({ supabase: f.supabase, signer: f.signer, missionId: MISSION_ID });
    expect(result.status).toBe("unreadable");
    if (result.status !== "unreadable") throw new Error("unreachable");
    expect(result.detail).toMatch(/not a finding that no preview exists/);
  });

  it("reports a failed signature as unreadable, with the bytes stated safe", async () => {
    const f = fakes({ rows: [heldPreviewRow()], signError: { message: "storage unavailable" } });
    const result = await loadAerialOrthoPreview({ supabase: f.supabase, signer: f.signer, missionId: MISSION_ID });
    expect(result.status).toBe("unreadable");
    if (result.status !== "unreadable") throw new Error("unreachable");
    expect(result.detail).toMatch(/bytes themselves are safe/);
  });
});
