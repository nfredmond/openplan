import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { findGtfsFeedsForArea } from "@/lib/gtfs/catalog";

/**
 * WHAT TRANSIT SERVES THIS AREA — the search, and nothing else.
 *
 * THIS ROUTE CREATES NOTHING. No feed row, no version row, no object. It is a
 * read of a public catalog on the planner's behalf, and keeping it write-free
 * is what lets a surface offer "search again" freely: a search that quietly
 * registered a feed would fill a workspace with rows nobody asked for.
 *
 * ================== THE FOUR-BRANCH OUTCOME IS PASSED THROUGH VERBATIM
 *
 * `findGtfsFeedsForArea` answers with a discriminated union of four statuses,
 * and this route forwards the status untouched. That is the whole point of the
 * union and the reason it was built that way — see `catalog.ts`'s header:
 *
 *   matched              feeds cover this area and here they are, ranked.
 *   covered_but_unusable feeds DO cover this area and every one was withheld
 *                        (withdrawn upstream, behind an API key, or published
 *                        with no download address). The agencies are named.
 *   no_covering_feed     nothing in the catalog covers this area. The only
 *                        branch that is a statement about the WORLD.
 *   catalog_unavailable  this deployment could not read the catalog. An
 *                        UNKNOWN, and not evidence about anywhere.
 *
 * A UI THAT MAPS `catalog_unavailable` OR `covered_but_unusable` ONTO THE SAME
 * EMPTY LIST RE-CREATES THE EXACT LIE THE LIBRARY WAS BUILT TO PREVENT: a
 * planner in a city with three transit feeds, all behind keys, being told their
 * community has no transit — or a failed download reported as an absence of
 * buses. Three of the four branches carry no `feeds` field at all so that
 * `feeds?.length === 0` cannot compile as a way to collapse them; that property
 * only survives if the status crosses the wire, which is why nothing here
 * flattens it.
 *
 * ============================ THE DIAGNOSTIC IS NEVER RETURNED TO A CLIENT
 *
 * `catalog_unavailable` may carry a `diagnostic`: the refusal with the resolved
 * IP address left in. `fetch.ts` withholds that from `detail` deliberately,
 * because a member who can see it can use the feed-URL field as a DNS-mapping
 * oracle for the deployment's private network. It is logged here through
 * `audit.warn` and the response is assembled field-by-field rather than by
 * spreading the outcome, so a new field on the library type cannot leak by
 * default.
 */

const searchQuerySchema = z
  .object({
    workspaceId: z.string().uuid(),
    minLon: z.coerce.number().min(-180).max(180),
    minLat: z.coerce.number().min(-90).max(90),
    maxLon: z.coerce.number().min(-180).max(180),
    maxLat: z.coerce.number().min(-90).max(90),
    // Where in the area the planner actually pointed. Breaks ranking ties only.
    focusLon: z.coerce.number().min(-180).max(180).optional(),
    focusLat: z.coerce.number().min(-90).max(90).optional(),
  })
  .strict()
  .refine((value) => value.minLon <= value.maxLon && value.minLat <= value.maxLat, {
    message: "The bounding box minimums must not exceed its maximums.",
  })
  .refine((value) => (value.focusLon === undefined) === (value.focusLat === undefined), {
    message: "A focus point needs both focusLon and focusLat.",
  });

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("gtfs.catalog.search", request);
  const startedAt = Date.now();

  try {
    const query = searchQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json(
        {
          error: "Invalid catalog search parameters",
          hint: "Supply workspaceId and a bounding box (minLon, minLat, maxLon, maxLat), optionally focusLon and focusLat.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, query.data.workspaceId);
    if (!membership.ok) {
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
        return NextResponse.json(
          { error: "Failed to verify workspace membership" },
          { status: 500 }
        );
      }
      if (membership.kind === "schema_pending") {
        return NextResponse.json(
          {
            error: "Workspace schema is not available yet",
            hint: "Apply the latest Supabase migrations, then try again.",
          },
          { status: 503 }
        );
      }
      // A workspace the caller is not a member of is reported as absent, never
      // as forbidden: 403 confirms the id exists and is an enumeration oracle.
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Deliberately NO role gate. Searching a public catalog changes nothing,
    // and a viewer — the read-only tier — is exactly the person who should be
    // able to see which agencies publish feeds for the area they are studying.

    const outcome = await findGtfsFeedsForArea({
      bbox: {
        minLon: query.data.minLon,
        minLat: query.data.minLat,
        maxLon: query.data.maxLon,
        maxLat: query.data.maxLat,
      },
      ...(query.data.focusLon !== undefined && query.data.focusLat !== undefined
        ? { focus: { lon: query.data.focusLon, lat: query.data.focusLat } }
        : {}),
    });

    if (outcome.status === "catalog_unavailable") {
      // The unredacted refusal goes to the host log and no further.
      audit.warn("gtfs_catalog_unavailable", {
        catalogUrl: outcome.catalogUrl,
        code: outcome.code,
        detail: outcome.detail,
        ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        {
          status: outcome.status,
          code: outcome.code,
          detail: outcome.detail,
          catalogUrl: outcome.catalogUrl,
        },
        { status: 503 }
      );
    }

    audit.info("gtfs_catalog_searched", {
      workspaceId: query.data.workspaceId,
      status: outcome.status,
      feeds: outcome.status === "matched" ? outcome.feeds.length : 0,
      withheld: outcome.status === "covered_but_unusable" ? outcome.withheld.length : 0,
      durationMs: Date.now() - startedAt,
    });

    if (outcome.status === "matched") {
      return NextResponse.json(
        {
          status: outcome.status,
          feeds: outcome.feeds,
          disclosure: outcome.disclosure,
          catalogUrl: outcome.catalogUrl,
        },
        { status: 200 }
      );
    }

    if (outcome.status === "covered_but_unusable") {
      return NextResponse.json(
        {
          status: outcome.status,
          withheld: outcome.withheld,
          disclosure: outcome.disclosure,
          catalogUrl: outcome.catalogUrl,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        status: outcome.status,
        disclosure: outcome.disclosure,
        catalogUrl: outcome.catalogUrl,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("gtfs_catalog_search_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while searching the transit feed catalog" },
      { status: 500 }
    );
  }
}
