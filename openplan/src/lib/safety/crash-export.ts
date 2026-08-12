/**
 * The filtered crash export — CSV and GeoJSON — built in ONE place.
 *
 * WHAT A PLANNER IS ACTUALLY ASKING FOR. "Export" on a safety screen means "give
 * me the collisions I am looking at, in a file I can hand to an engineer, put in
 * a grant appendix, or open in QGIS." Two things make that hard to do honestly:
 *
 *   1. WHAT THEY ARE LOOKING AT IS A FILTERED SUBSET, and a file that does not
 *      say which subset is worse than no file. Six months later nobody can tell
 *      whether "247 crashes" was every collision in the county or every
 *      night-time pedestrian collision on one corridor, and the number gets
 *      quoted as the former. So the filter selection is written into the file,
 *      derived from the same `CRASH_FILTER_FACETS` registry the query and the
 *      panel are generated from — a facet cannot be filterable and undisclosed.
 *   2. THE MAP IS CAPPED AND THE EXPORT MUST NOT SILENTLY INHERIT THE CAP. The
 *      workbench draws at most a couple of thousand points. Exporting exactly
 *      what is drawn would hand over a file that is a truncated slice of the
 *      filter, with no sign of it. The stored-lane export therefore reads the
 *      whole matching set up to its own, larger cap, and the header states
 *      matched-versus-exported whenever they differ.
 *
 * TWO FORMATS, ONE DECISION EACH, and the split is deliberate rather than an
 * inconsistency:
 *
 *   CSV is for a person in a spreadsheet, so the dimension columns carry the
 *   HUMAN LABEL from the facet registry ("Dark — no street lights"), because
 *   `dark_unlighted` in a grant appendix is the product's private vocabulary
 *   leaking onto an agency's letterhead.
 *
 *   GeoJSON is for a machine — QGIS, ArcGIS, a script, a re-import — so its
 *   properties are the NEUTRAL VALUES exactly as the map carries them. A
 *   round-trip through the export must not change what a value is called.
 *
 * FORMULA NEUTRALIZATION IS NOT REIMPLEMENTED HERE. Every cell goes through
 * `src/lib/export/csv.ts`, which is the one escaping layer in the product
 * (formula injection was neutralized repo-wide in v0.10.0 precisely because
 * three private escapers had each missed it). Crash exports carry source-agency
 * free text in the source label and attribution, and a planner opening their own
 * export must not execute it.
 *
 * NOTHING IS INVENTED, INCLUDING BY OMISSION. A dimension the source does not
 * record is written as a sentence saying so, never as a blank — a blank cell in
 * a spreadsheet reads as "no", and "no" about lighting or a pedestrian is a
 * finding this data cannot support. The one exception is the two casualty
 * columns, and it is a considered one: see `CASUALTY_BLANK_NOTE`.
 *
 * PURE — no I/O, no React, no Supabase. The server route and the browser both
 * call it, which is the point: the live-read lane and the stored lane cannot
 * produce files with different columns or a different header.
 */

import { csvCellForValue, escapeCsvField } from "@/lib/export/csv";
import type { SafetyCrashFeature } from "./client-types";
import {
  CRASH_FILTER_FACETS,
  facetValueLabel,
  narrowedChoice,
  type CrashFilterSelection,
} from "./crash-filters";

/** Where the exported rows came from, and what is missing from them. */
export type CrashExportProvenance = {
  /**
   * `stored` — collisions this workspace acquired and holds.
   * `live` — collisions read from the source agency for this visit only and
   * never saved. The distinction survives into the file because a live read
   * cannot be reproduced from the workspace later.
   */
  lane: "stored" | "live";
  sourceLabel: string | null;
  attribution: string | null;
  /** The acquisition this came from, when there is one. */
  ingestId: string | null;
  /** Collisions matching the filters in the source of record, when known. */
  matchedCount: number | null;
  studyAreaLabel: string | null;
  boundingBox: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
};

export type CrashExportInput = {
  features: readonly SafetyCrashFeature[];
  selection: CrashFilterSelection;
  provenance: CrashExportProvenance;
  /** Coverage and claim caveats from `caveats.ts` — imported, never re-worded here. */
  caveats: readonly string[];
  /** ISO timestamp. Passed in rather than read from the clock so the output is testable. */
  generatedAt: string;
};

/**
 * Why an empty casualty cell is allowed when nothing else may be blank.
 *
 * The two count columns must stay NUMERIC or a spreadsheet cannot sum them, and
 * a numeric column cannot hold the sentence "the source reported no count". The
 * blank is safe here only because the severity column on the same row already
 * says so in words — `SEVERITY_LABELS.unknown` is "Not classified — no casualty
 * count reported", not "Unknown". This note goes in the header so the pairing is
 * stated rather than inferred.
 */
export const CASUALTY_BLANK_NOTE =
  "An empty people-killed or people-injured cell means the source agency supplied no count for that collision; it does not mean zero. Those rows read \"Not classified\" in the severity column.";

/** The sentence a live-read export carries. A file outlives the browser tab it came from. */
export const LIVE_READ_EXPORT_NOTE =
  "These collisions were read directly from the source agency and were NOT saved into this workspace, so this file cannot be reproduced from OpenPlan later and the records are not attached to any project.";

/** The dimension columns, generated from the facet registry so a new facet exports itself. */
type ExportColumn = {
  header: string;
  /** CSV cell for one feature: a label, a sentence, or a number. */
  cell: (properties: SafetyCrashFeature["properties"]) => string | number | null;
};

function dimensionColumns(): ExportColumn[] {
  const columns: ExportColumn[] = [];

  for (const facet of CRASH_FILTER_FACETS) {
    if (facet.kind === "in") {
      columns.push({
        header: facet.label,
        cell: (properties) => {
          const raw = (properties as unknown as Record<string, unknown>)[facet.property];
          // NULL means the SOURCE has no such field. Not a blank: a blank cell in
          // a spreadsheet is read as an absence of the thing, and "no lighting
          // problem here" is a finding the feed cannot support.
          if (typeof raw !== "string" || raw.length === 0) return "Not recorded by this source";
          // EVERY OTHER VALUE COMES FROM THE REGISTRY'S OWN LABEL, including each
          // dimension's `unknown` member. An earlier version special-cased that
          // member into a generic "not reported for this collision", which was
          // right for lighting and catastrophic for severity: `unknown` there is
          // the band for a collision the source supplied no casualty count for,
          // and its label — "Not classified — no casualty count reported" — is
          // the sentence the band exists to say. The generic text erased it. The
          // registry already spells the right words per dimension; one rule with
          // no exceptions is what keeps that true for the next dimension too.
          return facetValueLabel(facet, raw);
        },
      });
      continue;
    }

    // Each involvement flag gets its own yes/no column rather than one joined
    // cell, because a spreadsheet user filters and pivots on columns.
    for (const option of facet.options) {
      columns.push({
        header: `${option.label} involved`,
        cell: (properties) =>
          (properties as unknown as Record<string, unknown>)[option.property] === true ? "Yes" : "Not reported",
      });
    }
  }

  return columns;
}

/**
 * One human sentence per facet describing what the export CONTAINS.
 *
 * It reports `narrowedChoice`, not the raw selection, and the difference
 * matters: ticking every lighting condition applies no predicate at all, so the
 * file also contains crashes whose lighting column is NULL. Listing the ticked
 * boxes there would describe the file as narrower than it is.
 */
export function describeCrashExportFilters(selection: CrashFilterSelection): string[] {
  const lines: string[] = [];

  for (const facet of CRASH_FILTER_FACETS) {
    const chosen = narrowedChoice(facet, selection[facet.id]);
    lines.push(
      chosen.length === 0
        ? `${facet.label}: all (no filter applied)`
        : `${facet.label}: ${chosen.map((value) => facetValueLabel(facet, value)).join(", ")}`
    );
  }

  const from = selection.yearFrom;
  const to = selection.yearTo;
  if (from !== undefined || to !== undefined) {
    lines.push(
      from !== undefined && to !== undefined
        ? `Collision year: ${from}–${to}`
        : from !== undefined
          ? `Collision year: ${from} onward`
          : `Collision year: up to ${to}`
    );
  } else {
    lines.push("Collision year: all (no filter applied)");
  }

  return lines;
}

/**
 * The provenance and disclosure rows that lead the CSV, as LABEL / VALUE pairs.
 *
 * PAIRS RATHER THAN SENTENCES, and this is a security decision, not a layout
 * one. The first version concatenated untrusted text into a prose line —
 * `Source: <agency label>` — which puts the agency's string in the MIDDLE of a
 * cell, where the formula-lead check in `src/lib/export/csv.ts` can never fire
 * because the cell starts with "S". That happened to be inert, by accident of
 * the sentence prefix, and an accident is not a mechanism: the next line written
 * without a prefix would have been live. Giving every untrusted value its own
 * cell means the shared escaper's protection actually applies to it, and a test
 * can prove that it did.
 */
export function crashExportHeaderRows(input: CrashExportInput): Array<[string, string]> {
  const { provenance } = input;
  const rows: Array<[string, string]> = [
    ["OpenPlan crash export", "Reported collisions, screening-grade"],
    ["Generated", input.generatedAt],
    ["Source", provenance.sourceLabel ?? "not recorded"],
  ];

  if (provenance.attribution) rows.push(["Attribution", provenance.attribution]);
  if (provenance.ingestId) rows.push(["Acquisition", provenance.ingestId]);
  if (provenance.studyAreaLabel) rows.push(["Study area", provenance.studyAreaLabel]);
  if (provenance.boundingBox) {
    const box = provenance.boundingBox;
    rows.push([
      "Map extent (WGS84)",
      `${box.minLon}, ${box.minLat} to ${box.maxLon}, ${box.maxLat}`,
    ]);
  }

  for (const line of describeCrashExportFilters(input.selection)) rows.push(["Filter", line]);

  const exported = input.features.length;
  rows.push(["Collisions in this file", exported.toLocaleString("en-US")]);
  if (provenance.matchedCount !== null && provenance.matchedCount > exported) {
    // The one number that makes a truncated export honest. Without it the file
    // is indistinguishable from a complete one.
    rows.push([
      "INCOMPLETE",
      `${provenance.matchedCount.toLocaleString("en-US")} collisions matched these filters and ${exported.toLocaleString("en-US")} were exported. This file is a partial slice — narrow the filters or the map extent to export the rest.`,
    ]);
  }

  if (provenance.lane === "live") rows.push(["Not saved", LIVE_READ_EXPORT_NOTE]);
  rows.push(["Note", CASUALTY_BLANK_NOTE]);
  for (const caveat of input.caveats) rows.push(["Caveat", caveat]);

  return rows;
}

/**
 * The CSV.
 *
 * The header lines are written as single-cell rows (each one escaped) rather
 * than as `#` comments: a comment convention is honoured by some spreadsheet
 * importers and shown as data by others, and a provenance line silently dropped
 * on import is the failure this whole header exists to prevent. As a row, it is
 * always visible.
 */
export function buildCrashExportCsv(input: CrashExportInput): string {
  const columns = dimensionColumns();
  const rows: string[] = [];

  for (const [label, value] of crashExportHeaderRows(input)) {
    rows.push(`${escapeCsvField(label)},${escapeCsvField(value)}`);
  }
  rows.push("");

  const headers = [
    "Collision date",
    "Collision year",
    // Severity is NOT written out here: it is a facet, so the registry produces
    // its column like every other dimension. Naming it as well produced two
    // "Severity" columns in the file, which a spreadsheet silently accepts.
    ...columns.map((column) => column.header),
    "People killed",
    "People injured",
    "Latitude",
    "Longitude",
    "Source",
    "Source record id",
  ];
  rows.push(headers.map((header) => escapeCsvField(header)).join(","));

  for (const feature of input.features) {
    const properties = feature.properties;
    const [longitude, latitude] = feature.geometry.coordinates;
    const cells: Array<string | number | null> = [
      properties.collisionDate,
      properties.collisionYear,
      ...columns.map((column) => column.cell(properties)),
      // Null stays null, which `csvCellForValue` writes as an empty cell. See
      // CASUALTY_BLANK_NOTE for why this is the one blank the export allows.
      properties.killedCount,
      properties.injuredCount,
      latitude,
      longitude,
      properties.sourceId,
      properties.externalId,
    ];
    rows.push(cells.map((cell) => csvCellForValue(cell)).join(","));
  }

  return `${rows.join("\n")}\n`;
}

/**
 * The GeoJSON.
 *
 * Feature properties are passed through UNCHANGED — the neutral values the map
 * and the API already use — so a file exported from OpenPlan describes a
 * collision with the same vocabulary OpenPlan does. The provenance travels as
 * foreign members on the collection, which the GeoJSON specification permits and
 * every reader tolerates.
 */
export function buildCrashExportGeoJson(input: CrashExportInput): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: input.features,
      openplan: {
        export: "safety_crashes",
        generatedAt: input.generatedAt,
        lane: input.provenance.lane,
        sourceLabel: input.provenance.sourceLabel,
        attribution: input.provenance.attribution,
        ingestId: input.provenance.ingestId,
        studyAreaLabel: input.provenance.studyAreaLabel,
        boundingBox: input.provenance.boundingBox,
        filters: describeCrashExportFilters(input.selection),
        exportedCount: input.features.length,
        matchedCount: input.provenance.matchedCount,
        complete:
          input.provenance.matchedCount === null
            ? null
            : input.provenance.matchedCount <= input.features.length,
        caveats: [
          ...(input.provenance.lane === "live" ? [LIVE_READ_EXPORT_NOTE] : []),
          CASUALTY_BLANK_NOTE,
          ...input.caveats,
        ],
      },
    },
    null,
    2
  );
}

export type CrashExportFormat = "csv" | "geojson";

/** A filename that says what the file is without the planner renaming it. */
export function crashExportFilename(format: CrashExportFormat, generatedAt: string): string {
  const stamp = generatedAt.slice(0, 10);
  return `openplan-crashes-${stamp}.${format === "csv" ? "csv" : "geojson"}`;
}
