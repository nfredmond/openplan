import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import {
  TITLE_VI_POLICY_COLUMNS,
  toTitleViPolicy,
  type TitleViPolicyRow,
} from "@/lib/title-vi/policy";
import {
  compareServiceEquity,
  type TractServiceRow,
} from "@/lib/title-vi/service-equity";

/**
 * TITLE VI SERVICE EQUITY for a workspace's current transit feed.
 *
 * ================================================== WHY THE SERVICE ROLE
 *
 * `census_tracts` is a SHARED, national, anon-readable reference table with no
 * workspace column, and `gtfs_tract_service` is workspace-scoped. Reading them
 * together needs one client that can see both, and the tenant boundary is then
 * enforced HERE — by `checkWorkspaceMembership` above and by an explicit
 * `.eq("workspace_id", …)` on every workspace-scoped read below. There is no
 * RLS net under a service-role read, so the `.eq()` chain IS the access control
 * and is asserted as such by this route's tests.
 *
 * ============================================= WHAT IT REFUSES, AND WHY
 *
 * Four different absences, each with its own answer, because the one thing a
 * civil-rights finding must never do is present a gap in the data as a finding
 * about the world:
 *
 *   - no feed             → nothing to analyse
 *   - join never computed → REFUSE; an empty table is not "no service anywhere"
 *   - no tracts loaded    → name the load step
 *   - no adopted policy   → name the adoption step; supply no threshold
 *
 * The last three are decided by `compareServiceEquity`, which is pure and
 * tested; this route's job is to hand it honest inputs and to distinguish a
 * READ FAILURE from an empty result. A failed read rendered as zero tracts
 * would produce exactly the false finding above.
 */

export const runtime = "nodejs";

const SERVICE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const querySchema = z
  .object({
    workspaceId: z.string().uuid(),
    serviceDay: z.enum(SERVICE_DAYS).default("monday"),
  })
  .strict();

/** Every column the comparison reads. Asserted by this route's projection test. */
const TRACT_SERVICE_COLUMNS =
  "tract_geoid, service_day, stops_in_tract, stop_events_per_day, " +
  "best_peak_headway_seconds, best_span_seconds, routes_serving";

/**
 * The two universe columns are NOT optional here and there is no narrower
 * fallback projection.
 *
 * `poverty_universe` and `race_universe` (migration 20260805000010) are the
 * denominators the low-income and minority shares are computed against. A
 * deployment that has not applied that migration answers 42703 on this read,
 * and the honest answer is to name the migration — not to quietly read the old
 * columns and divide by `pop_total`, which is the defect the migration exists
 * to remove. See `looksLikePendingUniverseColumns` below.
 */
const CENSUS_TRACT_COLUMNS =
  "geoid, pop_total, pop_white, pop_below_poverty, poverty_universe, race_universe";

const TRACT_UNIVERSE_MIGRATION = "20260805000010_census_tract_universes";

/**
 * Does this read error mean the deployment predates the universe columns?
 *
 * Narrow on purpose, and local on purpose, in the shape this repo already uses
 * for `looksLikePendingFinalizerSchema` (`lib/grants/application.ts`) and
 * `looksLikePendingAuthorshipColumns` (`lib/observability/action-audit.ts`): it
 * matches only when the message NAMES one of the two columns, so a permission
 * failure, a dropped connection or a genuine query fault can never be dressed
 * up as a friendly setup step. The shared `looksLikePendingSchema` is wider than
 * this and would also match a typo in any other column of the projection.
 */
function looksLikePendingUniverseColumns(message: string | null | undefined): boolean {
  const text = message ?? "";
  return /poverty_universe|race_universe/.test(text) && /column|schema cache|does not exist/i.test(text);
}

/**
 * `tract_service_computed_at` is the one that matters most here: NULL means the
 * join never ran, which the comparison must refuse on rather than read as an
 * absence of service. Dropping it from this projection would make every feed
 * look computed.
 */
const FEED_VERSION_COLUMNS =
  "id, feed_id, tract_service_rows, tract_service_computed_at, service_start_date, service_end_date";

/**
 * PostgREST caps a response at `max_rows` (1,000) however large a `.limit()` is
 * handed, silently. A large agency's envelope covers well over a thousand
 * tracts, and a truncated read here would drop whole neighbourhoods out of the
 * comparison — with the result still rendering as a complete finding. So both
 * reads page until dry, exactly as the transit map layer does.
 */
const PAGE_SIZE = 1000;

async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let page = 0; page < 50; page += 1) {
    const from = page * PAGE_SIZE;
    const result = await fetchPage(from, from + PAGE_SIZE - 1);
    if (result.error) return { rows, error: result.error.message };
    const batch = (result.data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, error: null };
}

function membershipResponse(kind: "schema_pending" | "not_member" | "error"): NextResponse {
  if (kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Title VI schema is not available yet",
        hint: "Apply the latest Supabase migrations, then try again.",
      },
      { status: 503 }
    );
  }
  if (kind === "error") {
    return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
  }
  return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("titleVi.serviceEquity.read", request);

  try {
    const query = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid service equity parameters" }, { status: 400 });
    }
    const { workspaceId, serviceDay } = query.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, workspaceId);
    if (!membership.ok) {
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
      }
      return membershipResponse(membership.kind);
    }

    const policyResult = await supabase
      .from("title_vi_policies")
      .select(TITLE_VI_POLICY_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("superseded_at", null)
      .maybeSingle();

    const policyFailure = classifyRouteReadFailure("Title VI policy", policyResult, {
      pendingError: "Title VI schema is not available yet",
      pendingHint: "Apply the latest Supabase migrations, then try again.",
    });
    if (policyFailure) {
      audit.error("policy_read_failed", { message: policyFailure.message });
      return NextResponse.json(policyFailure.body, { status: policyFailure.status });
    }
    const policyRow = policyResult.data as unknown as TitleViPolicyRow | null;

    // The one expression of "the feed this workspace analyses with" — both
    // halves, for the reasons filterToCurrentReadyVersion documents.
    // The query is widened to a loose shape BEFORE `filterToCurrentReadyVersion`
    // sees it. Handing it the fully-inferred PostgREST builder for a projection
    // this wide makes tsc report TS2589 (instantiation depth) — a recurring cost
    // of this repo's deliberately untyped Supabase clients, not a defect in the
    // query. The projection string is still asserted by this route's test.
    const versionQuery = supabase
      .from("gtfs_feed_versions")
      .select(FEED_VERSION_COLUMNS)
      .eq("workspace_id", workspaceId) as unknown as Parameters<
      typeof filterToCurrentReadyVersion
    >[0] & { limit: (count: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

    const versionResult = await filterToCurrentReadyVersion(versionQuery).limit(1);

    const versionFailure = classifyRouteReadFailure("transit feed version", versionResult, {
      pendingError: "Transit feed schema is not available yet",
      pendingHint: "Apply the latest Supabase migrations, then try again.",
    });
    if (versionFailure) {
      audit.error("version_read_failed", { message: versionFailure.message });
      return NextResponse.json(versionFailure.body, { status: versionFailure.status });
    }

    const versionRows = (versionResult.data ?? []) as unknown as Array<{
      id: string;
      tract_service_computed_at: string | null;
      tract_service_rows: number | null;
    }>;
    const version = versionRows[0];

    if (!version) {
      return NextResponse.json({
        serviceDay,
        result: {
          ok: false,
          refusal: {
            code: "no_feed",
            message:
              "This workspace has no transit feed ingested, so there is no service to compare. " +
              "Add your operator's GTFS feed from the Data Hub, then run this again.",
          },
        },
      });
    }

    const service = createServiceRoleClient();

    const tractService = await readAllPages<Record<string, unknown>>((from, to) =>
      service
        .from("gtfs_tract_service")
        .select(TRACT_SERVICE_COLUMNS)
        // ALL THREE FILTERS ARE ACCESS CONTROL OR CORRECTNESS, and under a
        // service-role client there is no RLS net beneath any of them: the
        // workspace is the tenant boundary, the version scopes the read to the
        // feed the planner is looking at, and the day keeps service days from
        // being silently merged.
        .eq("workspace_id", workspaceId)
        .eq("feed_version_id", version.id)
        .eq("service_day", serviceDay)
        .range(from, to)
    );

    if (tractService.error) {
      // A FAILED READ IS NOT AN EMPTY RESULT. Falling through with zero rows
      // would render "no tract in this area has any transit service", which is
      // the exact false finding this module is built to refuse.
      audit.error("tract_service_read_failed", { message: tractService.error });
      return NextResponse.json(
        {
          error: "Could not read tract-level service for this feed",
          hint: "This is a read failure, not a finding that tracts have no service.",
        },
        { status: 503 }
      );
    }

    const geoids = tractService.rows.map((row) => String(row.tract_geoid));
    const demographics = new Map<string, Record<string, unknown>>();

    for (let offset = 0; offset < geoids.length; offset += PAGE_SIZE) {
      const slice = geoids.slice(offset, offset + PAGE_SIZE);
      const result = await service
        .from("census_tracts")
        .select(CENSUS_TRACT_COLUMNS)
        .in("geoid", slice);
      if (result.error) {
        if (looksLikePendingUniverseColumns(result.error.message)) {
          audit.error("census_tract_universe_columns_missing", { message: result.error.message });
          return NextResponse.json(
            {
              error: "This deployment's database predates the census tract universe columns",
              hint:
                `Apply migration ${TRACT_UNIVERSE_MIGRATION}, then load tract coverage again so ` +
                "each tract carries the ACS universes its minority and poverty shares are divided " +
                "by. Until then this analysis will not run: the older columns can only produce a " +
                "poverty rate divided by total population, which understates it.",
            },
            { status: 503 }
          );
        }
        audit.error("census_tract_read_failed", { message: result.error.message });
        return NextResponse.json(
          {
            error: "Could not read census tract demographics",
            hint: "This is a read failure, not a finding about the population of these tracts.",
          },
          { status: 503 }
        );
      }
      for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
        demographics.set(String(row.geoid), row);
      }
    }

    const tracts: TractServiceRow[] = tractService.rows.map((row) => {
      const geoid = String(row.tract_geoid);
      const demo = demographics.get(geoid);
      return {
        geoid,
        // A tract with service but no demographic row is left unmeasured rather
        // than zeroed — `compareServiceEquity` counts and discloses it.
        populationTotal: (demo?.pop_total as number | null) ?? null,
        populationWhiteNonHispanic: (demo?.pop_white as number | null) ?? null,
        // The universes travel with the counts they belong to. A tract loaded
        // before 20260805000010 has them NULL, and the comparison drops it and
        // says so rather than reaching for `pop_total`.
        raceUniverse: (demo?.race_universe as number | null) ?? null,
        povertyUniverse: (demo?.poverty_universe as number | null) ?? null,
        populationBelowPoverty: (demo?.pop_below_poverty as number | null) ?? null,
        stopsInTract: Number(row.stops_in_tract ?? 0),
        stopEventsPerDay: Number(row.stop_events_per_day ?? 0),
        bestPeakHeadwaySeconds:
          row.best_peak_headway_seconds === null || row.best_peak_headway_seconds === undefined
            ? null
            : Number(row.best_peak_headway_seconds),
        bestSpanSeconds:
          row.best_span_seconds === null || row.best_span_seconds === undefined
            ? null
            : Number(row.best_span_seconds),
        routesServing: Number(row.routes_serving ?? 0),
      };
    });

    const result = compareServiceEquity({
      serviceDay,
      tracts,
      policy: policyRow ? toTitleViPolicy(policyRow) : (null as never),
      tractServiceComputed: version.tract_service_computed_at !== null,
    });

    return NextResponse.json({
      serviceDay,
      availableServiceDays: SERVICE_DAYS,
      feedVersionId: version.id,
      tractServiceComputedAt: version.tract_service_computed_at,
      result,
    });
  } catch (error) {
    audit.error("unexpected", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Failed to compare service equity" }, { status: 500 });
  }
}
