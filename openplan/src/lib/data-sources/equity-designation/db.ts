/**
 * Optional DB-backed equity designations.
 *
 * The bundled CEJST asset (`cejst-national.ts`) is the zero-setup default. This
 * module is the ADDITIVE path that makes the designation layer persistable and
 * extensible: an operator ingests a source into `equity_tract_designations`
 * (migration 20260724000001) via `upsertDesignations`, and a DB-backed adapter
 * built by `createDbDesignationAdapter` serves it through the SAME
 * `EquityDesignationAdapter` contract the registry already resolves — so adding
 * California SB 535 / CalEnviroScreen is: widen the CHECK domain (migration),
 * ingest the rows, and pass the adapter to `resolveJustice40ForTracts`. No call
 * site changes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import {
  DesignationSourceUnavailableError,
  type EquityDesignationAdapter,
  type EquityDesignationLookup,
} from "./types";

/**
 * The source ids `equity_tract_designations.source_id` accepts — the closed CHECK
 * domain from migration 20260724000001. Kept here so a parity test can assert the
 * migration and this constant never drift; widening one requires widening the
 * other in the same change. Adding a new designation source starts here.
 */
export const EQUITY_DESIGNATION_DB_SOURCE_IDS = ["cejst-national", "calenviroscreen-ca"] as const;

/** Postgres `in (...)` list guard, so a study area's tract set stays one query. */
const GEOID_QUERY_CHUNK = 1000;
/** Rows per upsert RPC call — a national source ingests in a few round-trips. */
const UPSERT_BATCH_SIZE = 5000;

/**
 * Read designations for a set of tract GEOIDs from the DB. A GEOID absent from
 * the result is NOT disadvantaged-false — it is undetermined (no record), so it
 * is simply left out of `byGeoid`, exactly as the bundled adapter does. Throws
 * `DesignationSourceUnavailableError` on a query error rather than returning an
 * empty (i.e. "nothing disadvantaged") result.
 */
export async function loadDesignationsFromDb(
  client: SupabaseClient,
  params: { sourceId: string; version: string; geoids: string[] }
): Promise<EquityDesignationLookup> {
  const byGeoid = new Map<string, boolean>();
  const unique = Array.from(new Set(params.geoids.map((g) => String(g).trim()).filter(Boolean)));

  for (let i = 0; i < unique.length; i += GEOID_QUERY_CHUNK) {
    const chunk = unique.slice(i, i + GEOID_QUERY_CHUNK);
    const { data, error } = await client
      .from("equity_tract_designations")
      .select("geoid, is_disadvantaged")
      .eq("source_id", params.sourceId)
      .eq("version", params.version)
      .in("geoid", chunk);

    if (error) {
      throw new DesignationSourceUnavailableError(
        params.sourceId,
        `equity_tract_designations query failed: ${error.message ?? "unknown error"}`
      );
    }

    for (const row of (data ?? []) as Array<{ geoid?: unknown; is_disadvantaged?: unknown }>) {
      const geoid = typeof row.geoid === "string" ? row.geoid : null;
      if (!geoid) continue;
      byGeoid.set(geoid, row.is_disadvantaged === true);
    }
  }

  let disadvantagedTotal = 0;
  for (const isDisadvantaged of byGeoid.values()) {
    if (isDisadvantaged) disadvantagedTotal += 1;
  }
  return { byGeoid, determinedTotal: byGeoid.size, disadvantagedTotal };
}

/** Descriptor for a DB-backed designation source — everything but the lookup. */
export type DbDesignationDescriptor = Omit<EquityDesignationAdapter, "lookup"> & {
  /** The `version` value ingested for this source, used in the DB query. */
  version: string;
};

/**
 * Build an `EquityDesignationAdapter` that resolves against the DB table. The
 * client is closed over so the adapter satisfies the registry's client-free
 * `lookup(geoids)` contract; a caller that has a Supabase client constructs the
 * adapter and passes it to `resolveJustice40ForTracts` as an extra adapter.
 */
export function createDbDesignationAdapter(
  descriptor: DbDesignationDescriptor,
  client: SupabaseClient
): EquityDesignationAdapter {
  return {
    ...descriptor,
    lookup: (geoids: string[]) =>
      loadDesignationsFromDb(client, {
        sourceId: descriptor.id,
        version: descriptor.version,
        geoids,
      }),
  };
}

/**
 * Ingest designations for a source. Uses the service-role batch RPC, which is
 * the only write path the table's RLS allows. Returns how many rows the RPC
 * reported affected, plus the first error if a batch failed.
 */
export async function upsertDesignations(
  serviceClient: SupabaseClient,
  params: {
    sourceId: string;
    version: string;
    attribution: string;
    retrievedAt: string | null;
    rows: Array<{ geoid: string; isDisadvantaged: boolean }>;
  }
): Promise<{ affected: number; error: string | null }> {
  let affected = 0;

  for (let i = 0; i < params.rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = params.rows.slice(i, i + UPSERT_BATCH_SIZE).map((row) => ({
      geoid: row.geoid,
      is_disadvantaged: row.isDisadvantaged,
    }));

    const { data, error } = await serviceClient.rpc("upsert_equity_designations", {
      p_source_id: params.sourceId,
      p_version: params.version,
      p_attribution: params.attribution,
      p_retrieved_at: params.retrievedAt,
      p_rows: batch,
    });

    if (error) {
      return { affected, error: error.message ?? "upsert_equity_designations failed" };
    }
    affected += typeof data === "number" ? data : batch.length;
  }

  return { affected, error: null };
}

// Re-exported for callers that build a descriptor inline.
export type { StudyAreaBbox };
