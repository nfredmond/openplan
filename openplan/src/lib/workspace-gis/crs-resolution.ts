/**
 * THE SEAM between this lane and the CRS registry, and the one place a
 * coordinate system is decided.
 *
 * WHY THE SERVER DECIDES AND THE BROWSER DOES NOT. The browser has to do the
 * reprojection — a 200 MB shapefile never fits in a request body, so the file
 * is read and transformed where it already is. But WHICH system it is read AS
 * decides where every shape lands, and that is a claim, not a computation. If
 * the client declared it, an out-of-date tab, a hand-edited request or a bug in
 * one browser could write "California zone 2 (US survey feet)" onto a layer
 * that is nothing of the kind, and nothing downstream could tell. So the client
 * sends EVIDENCE — the .prj text the file carried, a few hundred bytes — or an
 * explicit assertion naming a registry entry, and this module decides which of
 * those it is looking at.
 *
 * THE CLAIM TIER IS THE WHOLE POINT. `prj_file` is the file's own testimony.
 * `planner_asserted` is a person's statement, it names that person, and the
 * database refuses to store it without them (20260812000015). One may never be
 * written as the other, which is why `basis` comes out of this module and is
 * never an input to it.
 *
 * WHY THE RESOLVER IS INJECTED — AND WHY IT IS A PARAMETER, NOT A REGISTRATION.
 * The registry itself — entries, projection methods, area-of-use checks — is a
 * separate lane with its own generator and its own tests. Binding to it by
 * static import here would make "what does OpenPlan do when the registry is
 * absent?" untestable, and with no registry the answer must be an honest
 * refusal that names what was missing — never a guess, and never a silent
 * WGS84. So the registry is injected.
 *
 * It was originally injected by having the registry REGISTER ITSELF into a
 * module-level slot at startup. Nothing ever performed that registration, so
 * every deployment ran with an empty slot and refused every projected shapefile
 * — honestly, and therefore invisibly, because the tests all injected a fake.
 * An ambient dependency that one unnamed module is trusted to supply is
 * indistinguishable, from inside this file, from one nobody supplies.
 *
 * The registry is therefore a REQUIRED ARGUMENT. A call site that has not said
 * which registry it resolves against does not compile, which is a property the
 * type checker enforces on every future caller rather than a convention a
 * reviewer has to notice. `@/lib/workspace-gis/crs-registry-binding` is what a
 * server route passes; a test passes a fake, or `null` to exercise the refusal.
 */

import type { WorkspaceGisSourceFormat, WorkspaceGisSrsBasis } from "./types";

/**
 * One entry of the CRS registry, as this lane needs to consume it.
 *
 * Deliberately the SMALL half of the registry's entry shape: the projection
 * method and its parameters are the registry's business, and nothing here
 * should be able to reproject anything. What the store needs is the identity a
 * planner recognises, the units (because feet-for-metres is the commonest
 * legacy mistake and the version record has to be able to say which it was),
 * and whether the datum carries a positional caveat this layer must display
 * forever.
 */
export type WorkspaceGisCrsEntry = {
  /** "EPSG", "ESRI". */
  authority: string;
  /** "2226". Matching is by authority code first, alias second, never fuzzy name. */
  code: string;
  /** What a planner recognises: "California State Plane Zone 3, US survey feet". */
  name: string;
  /** "metre", "US survey foot", "degree" — recorded so the record can say which. */
  unit: string;
  kind: "geographic" | "projected";
  datum: string;
  /**
   * True when this datum can put shapes a disclosable distance from truth —
   * NAD27 without a NADCON grid, for instance. The upload then REQUIRES an
   * explicit acknowledgement, and `datumShiftNote` rides with the layer
   * everywhere it appears.
   */
  requiresDatumAcknowledgement: boolean;
  /** The permanent caveat sentence, or null when the datum needs no note. */
  datumShiftNote: string | null;
};

export type WorkspaceGisCrsRefusalReason =
  | "crs_registry_unavailable"
  | "crs_not_in_registry"
  | "crs_evidence_missing"
  | "crs_unsupported_for_format";

export type WorkspaceGisCrsResolution =
  | {
      ok: true;
      entry: WorkspaceGisCrsEntry;
      basis: WorkspaceGisSrsBasis;
    }
  | {
      ok: false;
      reason: WorkspaceGisCrsRefusalReason;
      /** Shown to the planner. Always names the real cause and the next step. */
      message: string;
    };

/**
 * What the registry lane must provide. Both lookups answer the same shape.
 *
 * `fromPrj` reads a .prj's WKT and identifies it; `byCode` takes an authority
 * code a planner chose from the picker. Neither ever guesses: a system the
 * registry does not carry is a refusal that NAMES THE CODE, never the nearest
 * zone that happens to be implemented.
 */
export type WorkspaceGisCrsRegistry = {
  fromPrj(prjText: string): WorkspaceGisCrsEntry | null;
  byCode(authorityCode: string): WorkspaceGisCrsEntry | null;
};

/**
 * WGS84, which is not a registry lookup but a specification.
 *
 * RFC 7946 fixes GeoJSON coordinates to WGS84 and OGC KML fixes KML's, so for
 * those formats there is nothing to resolve and nothing to assert. Held here
 * rather than in the registry because it is a property of the FORMAT.
 */
export const WGS84_ENTRY: WorkspaceGisCrsEntry = {
  authority: "EPSG",
  code: "4326",
  name: "WGS 84 (longitude/latitude)",
  unit: "degree",
  kind: "geographic",
  datum: "WGS 84",
  requiresDatumAcknowledgement: false,
  datumShiftNote: null,
};

/** Which formats fix their coordinate system by specification, and to which basis. */
const SPEC_FIXED_BASIS: Partial<Record<WorkspaceGisSourceFormat, WorkspaceGisSrsBasis>> = {
  geojson: "geojson_rfc7946_default",
  kml: "kml_specification",
  kmz: "kml_specification",
};

export type ResolveWorkspaceGisCrsInput = {
  sourceFormat: WorkspaceGisSourceFormat;
  /** Verbatim .prj text when the upload carried one. */
  prjText?: string | null;
  /** An authority code the planner chose ("EPSG:2226") when it did not. */
  assertedSrsCode?: string | null;
};

/**
 * The decision. Evidence beats assertion: a file that carries a .prj is read as
 * what the .prj says, and a planner's pick is only consulted when the file said
 * nothing. That order is deliberate — the alternative lets a stale picker
 * override the file's own testimony without anybody noticing.
 *
 * `registry` is required and may be `null`. Null is the honest "this deployment
 * has no coordinate-system registry" state, and it refuses rather than falling
 * back to WGS 84 — reading survey feet as degrees is the worst thing this
 * module could do. Passing it explicitly is what stops that state from
 * happening by accident: see the header.
 */
export function resolveWorkspaceGisCrs(
  input: ResolveWorkspaceGisCrsInput,
  registry: WorkspaceGisCrsRegistry | null
): WorkspaceGisCrsResolution {
  const specBasis = SPEC_FIXED_BASIS[input.sourceFormat];
  if (specBasis) {
    return { ok: true, entry: WGS84_ENTRY, basis: specBasis };
  }

  if (input.sourceFormat === "file_geodatabase") {
    return {
      ok: false,
      reason: "crs_unsupported_for_format",
      message:
        "A file geodatabase has to be converted before OpenPlan can read its coordinate system, and this deployment " +
        "has no conversion worker configured.",
    };
  }

  const prjText = input.prjText?.trim();
  const assertedCode = input.assertedSrsCode?.trim();

  if (!prjText && !assertedCode) {
    return {
      ok: false,
      reason: "crs_evidence_missing",
      message:
        "This shapefile has no .prj file, so nothing in it says which coordinate system its numbers are in. Choose " +
        "the system it was made in and OpenPlan will record that as your statement — it will not guess, because a " +
        "wrong guess puts the layer tens of kilometres from where it belongs and looks exactly like a right one.",
    };
  }

  if (!registry) {
    return {
      ok: false,
      reason: "crs_registry_unavailable",
      message:
        "This OpenPlan deployment has no coordinate-system registry available, so a projected file cannot be placed. " +
        "Files already in longitude/latitude (GeoJSON, KML, KMZ) still upload normally.",
    };
  }

  if (prjText) {
    const entry = registry.fromPrj(prjText);
    if (!entry) {
      return {
        ok: false,
        reason: "crs_not_in_registry",
        message:
          "This file names a coordinate system OpenPlan does not carry, so it cannot be placed. It is not read as " +
          "anything nearby — a neighbouring zone lands the layer in the wrong place and nothing on screen would say so. " +
          `The system it names is: ${summarizePrj(prjText)}.`,
      };
    }
    return { ok: true, entry, basis: "prj_file" };
  }

  const entry = registry.byCode(assertedCode as string);
  if (!entry) {
    return {
      ok: false,
      reason: "crs_not_in_registry",
      message: `OpenPlan does not carry the coordinate system ${assertedCode}, so it cannot place a file read as that system.`,
    };
  }
  return { ok: true, entry, basis: "planner_asserted" };
}

/**
 * The first line of a .prj, for a refusal that tells the planner what their
 * file actually says. Bounded: a .prj is one long line and the whole of it in
 * an error message is unreadable.
 */
function summarizePrj(prjText: string): string {
  const collapsed = prjText.replace(/\s+/g, " ").trim();
  const named = /^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[\s*"([^"]{1,120})"/i.exec(collapsed);
  if (named) return named[1];
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}…` : collapsed;
}
