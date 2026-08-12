import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  checkWorkspaceMembership,
  type WorkspaceMembershipResult,
} from "@/lib/workspaces/membership";
import {
  applyCrashFiltersToQuery,
  CRASH_FILTER_FACETS,
  CRASH_QUERY_PROJECTION,
  narrowedChoice,
  parseFacetParam,
  type CrashFilterSelection,
} from "@/lib/safety/crash-filters";
import { toStoredCrashProperties } from "@/lib/safety/crash-properties";
import {
  buildCrashExportCsv,
  buildCrashExportGeoJson,
  crashExportFilename,
  type CrashExportFormat,
} from "@/lib/safety/crash-export";
import {
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_GEOCODING_CAVEAT,
  SAFETY_PDO_COMPARABILITY_CAVEAT,
  SAFETY_SCREENING_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT,
} from "@/lib/safety/caveats";
import { getCrashSourceById } from "@/lib/safety/sources/registry";
import type { SafetyCrashFeature } from "@/lib/safety/client-types";

/**
 * Download the collisions the planner is currently looking at.
 *
 * THIS ROUTE EXISTS BECAUSE THE MAP ROUTE MUST NOT BE REUSED FOR IT. Sibling
 * `/api/safety/crashes` caps at a couple of thousand points because that is all
 * a map can usefully draw, and a planner who exported that would get a file that
 * is a truncated slice of their filter with nothing saying so. This route pages
 * through the whole matching set, up to its own explicit ceiling, and the file's
 * header states matched-versus-exported whenever the ceiling bit.
 *
 * PAGING IS NOT OPTIONAL. PostgREST enforces a server-side `max_rows` (1,000 in
 * this deployment), so a single `.limit(20000)` silently returns 1,000 rows and
 * a "complete" export of a county decade would be 5% of it. The loop below
 * advances by the number of rows actually RETURNED and stops only on an empty
 * page, which is correct whether the server's cap is above or below the page
 * size this route asks for.
 *
 * The filters, the columns and the header are all generated from the same
 * declarations the map uses (`crash-filters.ts`, `crash-export.ts`), so the file
 * cannot describe a different query from the one that produced it.
 */

/**
 * The export ceiling.
 *
 * Twenty thousand collisions is a large county-decade extract and roughly twenty
 * sequential page reads. It is a ceiling rather than a promise: the header says
 * when it bit, and the planner narrows the extent or the years to get the rest.
 * Raising it means measuring the request duration first — this runs in a
 * serverless function, and a job that might exceed ~60s belongs in a worker.
 */
const EXPORT_MAX_ROWS = 20_000;
const PAGE_SIZE = 1_000;

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  minLon: z.coerce.number().min(-180).max(180),
  minLat: z.coerce.number().min(-90).max(90),
  maxLon: z.coerce.number().min(-180).max(180),
  maxLat: z.coerce.number().min(-90).max(90),
  yearFrom: z.coerce.number().int().min(1900).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
  format: z.enum(["csv", "geojson"]).default("csv"),
  /**
   * The planner's own label for the area, echoed into the file header so the
   * download is self-describing. Bounded and escaped like every other cell —
   * `src/lib/export/csv.ts` neutralizes a leading `=` before it reaches a
   * spreadsheet.
   */
  studyArea: z.string().max(200).optional(),
});

/**
 * The file a project with no crash acquisitions gets.
 *
 * Zero rows, and a header that says WHY there are zero rows. An empty CSV with
 * no explanation is read as "no collisions here", which is the single claim this
 * module exists to stop the product making.
 */
function emptyProjectExport(
  format: CrashExportFormat,
  selection: CrashFilterSelection,
  studyAreaLabel: string | null,
  boundingBox: { minLon: number; minLat: number; maxLon: number; maxLat: number }
) {
  const generatedAt = new Date().toISOString();
  const input = {
    features: [],
    selection,
    provenance: {
      lane: "stored" as const,
      sourceLabel: null,
      attribution: null,
      ingestId: null,
      matchedCount: 0,
      studyAreaLabel,
      boundingBox,
    },
    caveats: [
      "No crash acquisition is linked to this project, so this file contains no collisions. That is a gap in what has been retrieved, not a finding that no collisions occurred.",
      SAFETY_SCREENING_CAVEAT,
    ],
    generatedAt,
  };
  const body = format === "csv" ? buildCrashExportCsv(input) : buildCrashExportGeoJson(input);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/geo+json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${crashExportFilename(format, generatedAt)}"`,
      "Cache-Control": "no-store",
    },
  });
}

function membershipErrorResponse(result: Extract<WorkspaceMembershipResult, { ok: false }>) {
  if (result.kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Safety schema is not available yet",
        hint: "Apply the latest Supabase migrations before exporting crash data.",
      },
      { status: 503 }
    );
  }
  if (result.kind === "not_member") {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("safety.crashes.export", request);
  const startedAt = Date.now();

  try {
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid crash export parameters" }, { status: 400 });
    }
    const query = parsed.data;
    if (query.minLon >= query.maxLon || query.minLat >= query.maxLat) {
      return NextResponse.json({ error: "Invalid bounding box" }, { status: 400 });
    }

    // Same parse as the map route, from the same registry. A facet value outside
    // the vocabulary is a 400, never a quietly unfiltered export — a file whose
    // header claims a filter the query never applied is the worst artefact this
    // route could produce.
    const facetSelection: CrashFilterSelection = {};
    for (const facet of CRASH_FILTER_FACETS) {
      const values = parseFacetParam(facet, request.nextUrl.searchParams.get(facet.id));
      if (values === null) {
        return NextResponse.json({ error: "Invalid crash export parameters" }, { status: 400 });
      }
      if (values.length > 0) facetSelection[facet.id] = values;
    }
    const selection: CrashFilterSelection = {
      ...facetSelection,
      ...(query.yearFrom === undefined ? {} : { yearFrom: query.yearFrom }),
      ...(query.yearTo === undefined ? {} : { yearTo: query.yearTo }),
    };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const membership = await checkWorkspaceMembership(supabase, user.id, query.workspaceId);
    if (!membership.ok) return membershipErrorResponse(membership);

    let projectIngestIds: string[] | null = null;
    if (query.projectId) {
      const { data: ingestRows, error: ingestError } = await supabase
        .from("safety_crash_ingests")
        .select("id")
        .eq("workspace_id", query.workspaceId)
        .eq("project_id", query.projectId);
      if (ingestError) {
        return NextResponse.json(
          { error: "Failed to resolve the project's crash acquisitions" },
          { status: 500 }
        );
      }
      projectIngestIds = (ingestRows ?? []).map((row) => row.id as string);
      if (projectIngestIds.length === 0) {
        // A project with no acquisitions exports an HONEST EMPTY FILE. Falling
        // through with no project predicate — which is what dropping the empty
        // list to null would do — would hand the planner the whole workspace's
        // collisions in a file headed with that project's study area.
        return emptyProjectExport(query.format, selection, query.studyArea ?? null, {
          minLon: query.minLon,
          minLat: query.minLat,
          maxLon: query.maxLon,
          maxLat: query.maxLat,
        });
      }
    }

    type CrashFilterable = {
      eq: (column: string, value: unknown) => CrashFilterable;
      gte: (column: string, value: unknown) => CrashFilterable;
      lte: (column: string, value: unknown) => CrashFilterable;
      in: (column: string, values: readonly unknown[]) => CrashFilterable;
      or: (filter: string) => CrashFilterable;
    };
    const applyScopeAndFilters = <T>(builder: T): T => {
      let q = builder as unknown as CrashFilterable;
      q = q
        .eq("workspace_id", query.workspaceId)
        .gte("longitude", query.minLon)
        .lte("longitude", query.maxLon)
        .gte("latitude", query.minLat)
        .lte("latitude", query.maxLat);
      if (projectIngestIds) q = q.in("ingest_id", projectIngestIds);
      return applyCrashFiltersToQuery(q, selection) as unknown as T;
    };

    // How many exist, before paging. This is the number the header compares
    // against, and it is what makes a capped export legible rather than
    // deceptively tidy.
    const countResult = await applyScopeAndFilters(
      supabase.from("safety_crashes").select("id", { count: "exact", head: true })
    );

    const features: SafetyCrashFeature[] = [];
    let undrawableCount = 0;
    let offset = 0;
    while (offset < EXPORT_MAX_ROWS) {
      const pageEnd = Math.min(offset + PAGE_SIZE, EXPORT_MAX_ROWS) - 1;
      const page = await applyScopeAndFilters(
        supabase.from("safety_crashes").select(CRASH_QUERY_PROJECTION)
      )
        // A stable total order is required for paging to be correct: without the
        // id tiebreak, rows sharing a collision date can appear on two pages or
        // on none, and the export would duplicate and drop real collisions.
        .order("collision_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(offset, pageEnd);

      if (page.error) {
        audit.warn("safety_crash_export_failed", {
          workspaceId: query.workspaceId,
          error: page.error.message,
        });
        return NextResponse.json({ error: "Failed to export crash data" }, { status: 500 });
      }

      const rows = (page.data ?? []) as unknown as Array<Record<string, unknown>>;
      for (const row of rows) {
        const properties = toStoredCrashProperties(row);
        const longitude = Number(row.longitude);
        const latitude = Number(row.latitude);
        if (!properties || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          undrawableCount += 1;
          continue;
        }
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [longitude, latitude] },
          properties,
        });
      }

      // Advance by WHAT CAME BACK, and stop only on an empty page.
      //
      // The tempting condition — "stop when the page is shorter than the one I
      // asked for" — is wrong here, and wrong in the silent direction. PostgREST
      // caps every response at its own `max_rows`, so on a deployment whose cap
      // is below PAGE_SIZE the first page is already "short" and the export
      // would end after it, having quietly dropped everything else while
      // reporting nothing. Costing one extra empty round-trip at the end buys
      // correctness under any server cap.
      if (rows.length === 0) break;
      offset += rows.length;
    }

    const sourceIds = Array.from(new Set(features.map((feature) => feature.properties.sourceId)));
    const adapters = sourceIds.map((id) => getCrashSourceById(id)).filter((adapter) => adapter !== null);

    const caveats: string[] = [SAFETY_CRASH_DATA_CAVEAT, SAFETY_GEOCODING_CAVEAT];
    if (features.some((feature) => feature.properties.severity === "unknown")) {
      caveats.push(SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT);
    }
    // Only where its own wording is true. The constant says these collisions are
    // "excluded from these figures until you switch them on", which is a
    // statement about an export that does NOT contain them.
    const severityFacet = CRASH_FILTER_FACETS.find((facet) => facet.id === "severity");
    const severityChoice = severityFacet
      ? narrowedChoice(severityFacet, selection.severity)
      : [];
    if (severityChoice.length > 0 && !severityChoice.includes("pdo")) {
      caveats.push(SAFETY_PDO_COMPARABILITY_CAVEAT);
    }
    if (undrawableCount > 0) {
      caveats.push(
        `${undrawableCount.toLocaleString("en-US")} matching ${undrawableCount === 1 ? "collision" : "collisions"} could not be exported because the stored coordinates or severity value were unusable. They are in the record and missing from this file.`
      );
    }
    caveats.push(SAFETY_SCREENING_CAVEAT);

    const generatedAt = new Date().toISOString();
    const input = {
      features,
      selection,
      provenance: {
        lane: "stored" as const,
        sourceLabel: adapters.length > 0 ? adapters.map((adapter) => adapter!.label).join("; ") : null,
        attribution:
          adapters.length > 0 ? adapters.map((adapter) => adapter!.attribution).join(" ") : null,
        ingestId: null,
        matchedCount: countResult.error ? null : countResult.count ?? null,
        studyAreaLabel: query.studyArea ?? null,
        boundingBox: {
          minLon: query.minLon,
          minLat: query.minLat,
          maxLon: query.maxLon,
          maxLat: query.maxLat,
        },
      },
      caveats,
      generatedAt,
    };

    const format: CrashExportFormat = query.format;
    const body = format === "csv" ? buildCrashExportCsv(input) : buildCrashExportGeoJson(input);

    audit.info("safety_crash_export_downloaded", {
      workspaceId: query.workspaceId,
      format,
      exportedCount: features.length,
      matchedCount: input.provenance.matchedCount,
      undrawableCount,
      durationMs: Date.now() - startedAt,
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type":
          format === "csv" ? "text/csv; charset=utf-8" : "application/geo+json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${crashExportFilename(format, generatedAt)}"`,
        // The file is a snapshot of a filtered query against live data; a cached
        // copy served to the next request would be a different planner's filter.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    audit.error("safety_crash_export_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while exporting crash data" }, { status: 500 });
  }
}
