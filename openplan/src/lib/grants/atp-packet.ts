/**
 * The California Active Transportation Program (ATP) scoring packet for one
 * grant application, built from evidence the workspace already holds.
 *
 * WHICH APPLICATIONS GET IT. Only an application seeded from one of the
 * catalog's `atp` templates: the 2027 one, or the earlier one that
 * applications seeded before it still carry. The opportunity row records no
 * program key, so the template is read back from the seeded sections
 * themselves: their keys must all belong to exactly one catalog template, and
 * at least one must belong to that template alone. A custom scaffold, a
 * proposal, another state's program, or a remnant too small to tell apart
 * gets no packet. ATP is a California program; nothing here applies its rules
 * anywhere else.
 *
 * WHERE THE NUMBERS COME FROM. Safety and equity come from the project's
 * latest corridor analysis run, through the same presentation rule every
 * other surface uses, so a score the run withheld stays null. The run's crash
 * snapshot names the safety score's source and years. Climate, feasibility,
 * the weighted total and the sensitivity flag have no producer in OpenPlan and
 * stay null. The project's own summary and planning-level estimate fill the
 * description and cost lines, and its recorded study place fills the location
 * line, so a recorded fact is never printed as "to be provided"; the estimate
 * is formatted from its exact stored amount. No equity-lens row is passed,
 * because OpenPlan holds no disadvantaged-community determination; the packet
 * says "not recorded" for those. Nothing here calls a language model.
 *
 * THE PLACE AND THE APPLICANT. The study place is the area the project row
 * records (`place_*`, set from the place search or drawn). It is named as the
 * study place and never as the project's limits, which only the application
 * states. No record holds the applicant's name: the workspace is not
 * necessarily the applicant (a consultant's workspace is not the agency), so
 * the packet says the applicant is not entered and never prints the workspace
 * name in its place.
 */

import { scoreValueForPresentation } from "@/lib/analysis/score-presentation";
import { listGrantApplicationTemplates, type GrantApplicationTemplate } from "@/lib/grants/application-templates";
import { normalizePlaceGeoid, PLACE_KIND_LABELS, placeKindSchema } from "@/lib/api/place-geographies";
import { DRAWN_PLACE_SOURCE, UPLOADED_PLACE_SOURCE } from "@/lib/geographies/place-of-record";
import { formatEvidenceTimestamp } from "@/lib/grants/evidence-timestamp";
import { computeAtpPacket } from "@/lib/planner-pack/atp";
import type { AtpGrantResult, AtpLapmRow } from "@/lib/planner-pack/types";
import { formatProjectEstimate } from "@/lib/projects/estimated-cost";
import { calendarDayOf, UTC_TIME_ZONE } from "@/lib/time/workspace-calendar";
import { TIGERWEB_GEOGRAPHY_SOURCE } from "@/lib/workspaces/home-geography";

export const ATP_CATALOG_KEY = "atp";

/** The run id the packet carries when the project has no analysis run. */
export const ATP_PACKET_NO_RUN_ID = "no analysis run";

export type SeededSectionFacts = {
  section_key: string;
  source: string;
};

/**
 * The catalog template an application was seeded from, or null when the
 * seeded sections do not identify exactly one. A program's earlier templates
 * count, so an application seeded before the program's template changed is
 * still recognised.
 */
export function identifySeededTemplate(sections: readonly SeededSectionFacts[]): GrantApplicationTemplate | null {
  const seeded = new Set(
    sections.filter((section) => section.source === "catalog").map((section) => section.section_key)
  );
  if (seeded.size === 0) return null;

  const templates = listGrantApplicationTemplates()
    .map((template) => ({
      template,
      sectionKeys: new Set(template.applicationSections.map((section) => section.key)),
    }))
    .filter((candidate) => candidate.sectionKeys.size > 0);

  const matches = templates.filter((candidate) =>
    [...seeded].every((key) => candidate.sectionKeys.has(key))
  );
  if (matches.length !== 1) return null;

  const [match] = matches;
  const distinguishing = [...seeded].some((key) =>
    templates.every((candidate) => candidate === match || !candidate.sectionKeys.has(key))
  );
  return distinguishing ? match.template : null;
}

/** The catalog program an application was seeded from, whichever of its templates seeded it. */
export function identifySeededCatalogKey(sections: readonly SeededSectionFacts[]): string | null {
  return identifySeededTemplate(sections)?.catalogKey ?? null;
}

export function isAtpApplication(sections: readonly SeededSectionFacts[]): boolean {
  return identifySeededCatalogKey(sections) === ATP_CATALOG_KEY;
}

export type AtpPacketProject = {
  id: string;
  name: string;
  summary?: string | null;
  estimated_cost_amount?: string | number | null;
  estimated_cost_currency?: string | null;
  estimated_cost_basis_year?: number | null;
  /** The study place the project row records: which resolver, its kind, its id there and its label. */
  place_source?: string | null;
  place_kind?: string | null;
  place_ref?: string | null;
  place_label?: string | null;
};

/**
 * The project columns the packet reads; the amount is read as text so its
 * exact digits survive. The place columns leave out the boundary geometry,
 * which can be megabytes and is not printed.
 */
export const ATP_PACKET_PROJECT_SELECT =
  "id, name, summary, estimated_cost_amount::text, estimated_cost_currency, estimated_cost_basis_year, place_source, place_kind, place_ref, place_label";

/** The packet's project facts from a `projects` row read with `ATP_PACKET_PROJECT_SELECT`. */
export function readAtpPacketProject(row: Record<string, unknown>): AtpPacketProject | null {
  if (typeof row.id !== "string") return null;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const amount = row.estimated_cost_amount;
  return {
    id: row.id,
    name: typeof row.name === "string" ? row.name : row.id,
    summary: text(row.summary),
    estimated_cost_amount: typeof amount === "string" || typeof amount === "number" ? amount : null,
    estimated_cost_currency: text(row.estimated_cost_currency),
    estimated_cost_basis_year: typeof row.estimated_cost_basis_year === "number" ? row.estimated_cost_basis_year : null,
    place_source: text(row.place_source),
    place_kind: text(row.place_kind),
    place_ref: text(row.place_ref),
    place_label: text(row.place_label),
  };
}

/** What the packet prints where no study place is set on the project. */
export const ATP_STUDY_PLACE_NOT_RECORDED = "Study place not recorded in OpenPlan";

/**
 * What the packet prints for the applicant. Nothing in OpenPlan holds an
 * applicant's name for an application yet, so this is the only value.
 */
export const ATP_APPLICANT_NOT_ENTERED = "Applicant not entered in OpenPlan";

/** What the packet prints where the project has no summary. */
const ATP_DESCRIPTION_NOT_RECORDED = "Not recorded in OpenPlan. The project has no summary.";

/**
 * The project's study place as the packet states it.
 *
 * `description` is the place in words: a searched place by its label, kind and
 * Census GEOID (the kind and GEOID are the ones the server resolved; the
 * label is the one saved with them), a drawn or uploaded area as what it is.
 * `censusTribalAreaName` is set only when the study place is a Census tribal
 * area (American Indian, Alaska Native or Native Hawaiian area), which is a
 * fact about the place the project studies and no finding about the project.
 */
export type AtpStudyPlace =
  | { recorded: false }
  | { recorded: true; description: string; censusTribalAreaName: string | null };

export function readAtpStudyPlace(project: AtpPacketProject): AtpStudyPlace {
  const source = project.place_source?.trim() || null;
  if (!source) return { recorded: false };
  const label = project.place_label?.trim() || null;
  const labeled = label ? `, labeled "${label}"` : "";
  if (source === DRAWN_PLACE_SOURCE) {
    return { recorded: true, description: `an area drawn on the map${labeled}`, censusTribalAreaName: null };
  }
  if (source === UPLOADED_PLACE_SOURCE) {
    return { recorded: true, description: `an area read from an uploaded file${labeled}`, censusTribalAreaName: null };
  }
  if (source === TIGERWEB_GEOGRAPHY_SOURCE) {
    const kind = placeKindSchema.safeParse(project.place_kind);
    const geoid = kind.success ? normalizePlaceGeoid(kind.data, project.place_ref) : null;
    if (kind.success && geoid) {
      const kindWords = kind.data === "aiannh" ? "Census tribal area" : PLACE_KIND_LABELS[kind.data];
      const name = label ?? `Unnamed ${kindWords}`;
      return {
        recorded: true,
        description: `${name} (${kindWords}, GEOID ${geoid})`,
        censusTribalAreaName: kind.data === "aiannh" ? name : null,
      };
    }
  }
  // A place from a source this packet has no words for: its saved label, and nothing claimed about its kind.
  return { recorded: true, description: label ?? "an area with no name recorded", censusTribalAreaName: null };
}

/** The one line that names the study place, or says none is recorded. */
export function atpStudyPlaceLine(project: AtpPacketProject): string {
  const place = readAtpStudyPlace(project);
  return place.recorded ? `Study place: ${place.description}` : ATP_STUDY_PLACE_NOT_RECORDED;
}

export type AtpPacketRun = {
  id: string;
  title: string | null;
  created_at: string | null;
  metrics: Record<string, unknown> | null;
};

export type AtpPacketView = {
  packet: AtpGrantResult;
  project: AtpPacketProject;
  /** The corridor analysis run the safety and equity scores came from, if any. */
  scoreRun: { id: string; title: string | null; createdAt: string | null } | null;
};

/** Years as one range ("2022–2025") when they run without a gap, else as a list. */
export function formatYears(years: number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const contiguous = sorted.every((year, index) => index === 0 || year === sorted[index - 1] + 1);
  if (sorted.length > 1 && contiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  return sorted.join(", ");
}

/**
 * The crash source, years and retrieval date behind a run's safety score,
 * read from the run's crash source snapshot. Null when the run recorded none,
 * so the packet says the source is not recorded instead of guessing one. The
 * retrieval date is the day on the workspace calendar.
 */
function describeSafetyScoreSource(metrics: Record<string, unknown> | null, timeZone: string): string | null {
  const snapshots = metrics?.sourceSnapshots;
  if (!snapshots || typeof snapshots !== "object") return null;
  const crashes = (snapshots as Record<string, unknown>).crashes;
  if (!crashes || typeof crashes !== "object") return null;
  const record = crashes as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!label) return null;
  const years = Array.isArray(record.yearsQueried)
    ? record.yearsQueried.filter((year): year is number => Number.isInteger(year))
    : [];
  const fetchedOn = typeof record.fetchedAt === "string" ? calendarDayOf(record.fetchedAt, timeZone) : null;
  const parts = [label, years.length > 0 ? `crash years ${formatYears(years)}` : "crash years not recorded"];
  // The day prints the way the appendices' other dates do ("Nov 16, 2026").
  if (fetchedOn) parts.push(`retrieved ${formatEvidenceTimestamp(fetchedOn)}`);
  return `${parts.join(", ")}.`;
}

/**
 * The project's planning-level estimate, formatted from its exact stored
 * amount and labelled for what it is. Null when none is recorded.
 */
function describeProjectEstimate(project: AtpPacketProject): string | null {
  const amount = project.estimated_cost_amount;
  const currency = project.estimated_cost_currency;
  if (amount === null || amount === undefined || amount === "" || !currency) return null;
  const year = project.estimated_cost_basis_year ? `, ${project.estimated_cost_basis_year} price year` : "";
  return `${formatProjectEstimate(amount, currency)}${year}. Planning-level estimate recorded on the project, not an engineer's estimate.`;
}

/** Build the packet for one project from its latest corridor analysis run. */
export function buildAtpPacketView(input: {
  project: AtpPacketProject;
  run: AtpPacketRun | null;
  generatedAt?: string;
  /** The workspace calendar's zone for the crash retrieval day. Defaults to UTC. */
  timeZone?: string;
}): AtpPacketView {
  const metrics = input.run?.metrics ?? null;
  const summary = typeof input.project.summary === "string" ? input.project.summary.trim() : "";
  const lapm: AtpLapmRow = {
    project_id: input.project.id,
    description: summary || ATP_DESCRIPTION_NOT_RECORDED,
    location_note: atpStudyPlaceLine(input.project),
    estimated_cost_note: describeProjectEstimate(input.project),
  };
  const packet = computeAtpPacket(
    [
      {
        project_id: input.project.id,
        name: input.project.name,
        safety_score: scoreValueForPresentation(metrics, "safetyScore"),
        equity_score: scoreValueForPresentation(metrics, "equityScore"),
        climate_score: null,
        feasibility_score: null,
        total_score: null,
        sensitivity_flag: null,
        safety_source_note: describeSafetyScoreSource(metrics, input.timeZone ?? UTC_TIME_ZONE),
      },
    ],
    {
      runId: input.run?.id ?? ATP_PACKET_NO_RUN_ID,
      agency: ATP_APPLICANT_NOT_ENTERED,
      lapmRows: [lapm],
      generatedAt: input.generatedAt,
    }
  );
  return {
    packet,
    project: input.project,
    scoreRun: input.run
      ? { id: input.run.id, title: input.run.title, createdAt: input.run.created_at }
      : null,
  };
}
