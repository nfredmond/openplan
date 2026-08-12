/**
 * The coordinate-system registry's only HTTP surface.
 *
 * TWO QUESTIONS, BOTH ASKED BY THE UPLOAD WIZARD:
 *
 *   GET  ?bbox=w,s,e,n  — "which systems could this county's file be in?"
 *        ?code=EPSG:2226 — "give me that one, with its arithmetic."
 *   POST { prjText }     — "my file says this. What is it?"
 *
 * WHY A ROUTE AND NOT A DIRECT IMPORT. The registry is generated data well over
 * a megabyte; importing it into a client component would ship it to every
 * browser that opens a map. More importantly, identifying a file's coordinate
 * system is a claim with consequences — a wrong answer lands a layer tens of
 * kilometres away, looking entirely plausible — and this repository's rule is
 * that the server owns that decision. The browser gets the projection formula
 * for the entry the SERVER named, and reprojects with it locally because a
 * 200 MB shapefile cannot travel.
 *
 * WHAT THIS ROUTE CANNOT DO. It writes nothing. It cannot record what a layer
 * was read as — the ingest route resolves the coordinate system a second time,
 * from the same evidence, and that resolution is the one that reaches the
 * database. So a browser that lies to this endpoint gets a wrong preview on its
 * own screen and no wrong record anywhere.
 *
 * REGISTRY DISPOSITION — no assistant action, and no refusal entry needed: this
 * route is a read with no write behind it. The refusal that matters is
 * `set_layer_crs`, recorded against the ingest route in
 * `src/test/refused-workspace-gis-actions-stay-refused.test.ts`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient } from "@/lib/supabase/server";
import { crsPickerOptionFor } from "@/lib/cartographic/crs-http-types";
import type {
  CrsIdentifyResponse,
  CrsPickerResponse,
} from "@/lib/cartographic/crs-http-types";
import {
  allCrsEntries,
  crsSiblings,
  findCrsByCode,
  identifyCrsFromPrj,
  listCrsForRegion,
} from "@/lib/geo/crs/registry";

/**
 * How many systems one picker response carries.
 *
 * A list a person reads. A whole state legitimately covers several dozen
 * systems once every unit and realization flavour is counted, so the cap is
 * generous enough that a real query is never truncated — and when it is, the
 * response says how many matched so the wizard can tell the planner rather than
 * present a cut list as the complete one.
 */
const CRS_PICKER_LIMIT = 200;

function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 4 || !parts.every((value) => Number.isFinite(value))) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west >= east || south >= north) return null;
  return [west, south, east, north];
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("geo.crs.list", request);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const code = request.nextUrl.searchParams.get("code");
    if (code) {
      const entry = findCrsByCode(code);
      if (!entry) {
        const payload: CrsIdentifyResponse = {
          ok: false,
          reason: "crs_not_in_registry",
          message:
            `OpenPlan does not carry the coordinate system ${code}, so it cannot place a file read as that ` +
            `system. It is not substituted with a nearby zone — a neighbouring zone lands the layer in the ` +
            `wrong place and nothing on screen would say so.`,
          declaredName: null,
          declaredCode: code,
        };
        return NextResponse.json(payload, { status: 404 });
      }
      const payload: CrsIdentifyResponse = {
        ok: true,
        entry,
        // A code the planner typed or picked is THEIR statement, never the
        // file's. The basis reported here matches what the ingest route will
        // independently decide, so the wizard's sentence and the stored record
        // cannot disagree.
        basis: "planner_asserted",
        siblings: crsSiblings(entry).filter((sibling) => sibling.code !== entry.code),
      };
      return NextResponse.json(payload, { status: 200 });
    }

    const bbox = parseBbox(request.nextUrl.searchParams.get("bbox"));
    if (!bbox) {
      // NOT AN ERROR, and not a silent whole-registry dump either. A workspace
      // that has never stated a home geography has no region to narrow by, and
      // the honest response is a list flagged as unnarrowed so the wizard can
      // say "this is not a shortlist for your area" rather than implying it is.
      const entries = allCrsEntries();
      const payload: CrsPickerResponse = {
        options: entries.slice(0, CRS_PICKER_LIMIT).map(crsPickerOptionFor),
        matchedCount: entries.length,
        unscoped: true,
      };
      return NextResponse.json(payload, { status: 200 });
    }

    const covering = listCrsForRegion({
      west: bbox[0],
      south: bbox[1],
      east: bbox[2],
      north: bbox[3],
      limit: CRS_PICKER_LIMIT,
    });
    // `listCrsForRegion` applies the cap itself, so a second, uncapped call is
    // the only way to know whether anything was cut. Asking for one more than
    // the cap is enough to answer that without materializing the registry.
    const matched = listCrsForRegion({
      west: bbox[0],
      south: bbox[1],
      east: bbox[2],
      north: bbox[3],
      limit: CRS_PICKER_LIMIT + 1,
    }).length;

    const payload: CrsPickerResponse = {
      options: covering.map(crsPickerOptionFor),
      matchedCount: matched,
      unscoped: false,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    audit.error("crs_list_failed", { error });
    return NextResponse.json(
      { error: "The coordinate-system registry could not be read." },
      { status: 500 }
    );
  }
}

const identifySchema = z
  .object({
    // A .prj is one long WKT line; a few kilobytes covers even a verbose ESRI
    // one with every parameter spelled out.
    prjText: z.string().min(1).max(20000),
  })
  .strict();

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("geo.crs.identify", request);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.documentJson);
    if (!body.ok) return body.response;

    const parsed = identifySchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Send the .prj file's text as `prjText`." },
        { status: 400 }
      );
    }

    const identification = identifyCrsFromPrj(parsed.data.prjText);

    if (!identification.ok) {
      // The refusal NAMES what the file said. "Unsupported coordinate system"
      // teaches a planner nothing and gives them nothing to act on; the system's
      // own name is something they can look up, send to their GIS contractor, or
      // recognise as the zone next door.
      const declaredName = identification.declaredName;
      const declaredCode = identification.declaredCode;
      const message =
        identification.reason === "unreadable"
          ? "OpenPlan could not read this file's .prj — its contents are not recognisable as a coordinate-system " +
            "definition. The file may be truncated or may not be a .prj at all."
          : `This file names a coordinate system OpenPlan does not carry, so it cannot be placed. It is not read ` +
            `as anything nearby, because a neighbouring zone lands the layer in the wrong place and nothing on ` +
            `screen would say so. The system it names is: ${declaredName ?? declaredCode ?? "not stated"}.`;

      const payload: CrsIdentifyResponse = {
        ok: false,
        reason:
          identification.reason === "unreadable" ? "crs_unreadable" : "crs_not_in_registry",
        message,
        declaredName: declaredName ?? null,
        declaredCode: declaredCode ?? null,
      };
      return NextResponse.json(payload, { status: 200 });
    }

    const payload: CrsIdentifyResponse = {
      ok: true,
      entry: identification.entry,
      basis: "prj_file",
      siblings: crsSiblings(identification.entry).filter(
        (sibling) => sibling.code !== identification.entry.code
      ),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    audit.error("crs_identify_failed", { error });
    return NextResponse.json(
      { error: "The coordinate system in this file could not be read." },
      { status: 500 }
    );
  }
}
