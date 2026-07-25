import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import {
  upsertDesignations,
  EQUITY_DESIGNATION_DB_SOURCE_IDS,
} from "@/lib/data-sources/equity-designation/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ingest disadvantaged-community designations into the OPTIONAL
 * `equity_tract_designations` table (public, cross-tenant reference data).
 *
 * OPERATOR-ONLY. Unlike the census-tracts ingest route — which takes only a
 * state/county FIPS and fetches AUTHORITATIVE TIGERweb/ACS values server-side —
 * this route writes caller-controlled disadvantaged-community FLAGS for arbitrary
 * tracts into a table served to every workspace. A signed-in user is not enough:
 * self-serve sign-up is free and ungated, so "authenticated" means "anyone." The
 * write is therefore gated on a shared operator secret (`OPENPLAN_EQUITY_INGEST_TOKEN`)
 * that only whoever runs the deployment holds. When the env is unset the route is
 * DISABLED — there is no ambient path for a user to poison the reference layer.
 * The bundled CEJST asset stays the zero-setup default; nothing here is required.
 *
 * Ingest in batches — the operator's loader posts chunks of this size.
 */
const MAX_ROWS_PER_REQUEST = 25_000;

/** Operator-secret gate. Returns null when authorized, or a response to send. */
function checkOperatorToken(request: NextRequest): NextResponse | null {
  const expected = process.env.OPENPLAN_EQUITY_INGEST_TOKEN;
  if (!expected) {
    // No secret configured → the route cannot be used at all.
    return NextResponse.json(
      { error: "Designation ingest is not enabled on this deployment." },
      { status: 403 }
    );
  }
  const provided = request.headers.get("x-openplan-ingest-token") ?? "";
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  const ok = expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  if (!ok) {
    return NextResponse.json({ error: "Invalid or missing operator ingest token." }, { status: 403 });
  }
  return null;
}

const ingestSchema = z.object({
  sourceId: z.enum(EQUITY_DESIGNATION_DB_SOURCE_IDS),
  version: z.string().min(1).max(40),
  attribution: z.string().max(2000).default(""),
  retrievedAt: z.string().datetime().nullable().default(null),
  rows: z
    .array(
      z.object({
        geoid: z.string().regex(/^\d{11}$/),
        isDisadvantaged: z.boolean(),
      })
    )
    .min(1)
    .max(MAX_ROWS_PER_REQUEST),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("geographies.equity-designation.ingest", request);
  const startedAt = Date.now();

  try {
    const denied = checkOperatorToken(request);
    if (denied) return denied;

    const body = await readJsonWithLimit(request, BODY_LIMITS.networkGeoJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = ingestSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid equity-designation ingest parameters" }, { status: 400 });
    }

    // De-duplicate GEOIDs within the batch (last write wins) so a caller cannot
    // multiply the work with repeats.
    const deduped = Array.from(
      new Map(parsed.data.rows.map((row) => [row.geoid, row])).values()
    );

    const service = createServiceRoleClient();
    const result = await upsertDesignations(service, {
      sourceId: parsed.data.sourceId,
      version: parsed.data.version,
      attribution: parsed.data.attribution,
      retrievedAt: parsed.data.retrievedAt,
      rows: deduped,
    });

    if (result.error) {
      audit.error("equity_designation_ingest_failed", {
        sourceId: parsed.data.sourceId,
        error: result.error,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Failed to persist designations", details: result.error }, { status: 500 });
    }

    audit.info("equity_designation_ingested", {
      sourceId: parsed.data.sourceId,
      version: parsed.data.version,
      requested: parsed.data.rows.length,
      affected: result.affected,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      sourceId: parsed.data.sourceId,
      version: parsed.data.version,
      requested: parsed.data.rows.length,
      persisted: result.affected,
    });
  } catch (error) {
    audit.error("equity_designation_ingest_unhandled", {
      error: error instanceof Error ? error.message : "unknown",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Equity-designation ingest failed unexpectedly" }, { status: 500 });
  }
}
