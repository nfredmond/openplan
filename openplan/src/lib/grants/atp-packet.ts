/**
 * The California Active Transportation Program (ATP) scoring packet for one
 * grant application, built from evidence the workspace already holds.
 *
 * WHICH APPLICATIONS GET IT. Only an application seeded from the catalog's
 * `atp` template. The opportunity row records no program key, so the template
 * is read back from the seeded sections themselves: their keys must all belong
 * to exactly one catalog template, and at least one must belong to that
 * template alone. A custom scaffold, a proposal, another state's program, or a
 * remnant too small to tell apart gets no packet. ATP is a California program;
 * nothing here applies its rules anywhere else.
 *
 * WHERE THE NUMBERS COME FROM. Safety and equity come from the project's
 * latest corridor analysis run, through the same presentation rule every
 * other surface uses, so a score the run withheld stays null. The run's crash
 * snapshot names the safety score's source and years. Climate, feasibility,
 * the weighted total and the sensitivity flag have no producer in OpenPlan and
 * stay null. The project's own summary and planning-level estimate fill the
 * description and cost lines, so a recorded fact is never printed as "to be
 * provided"; the estimate is formatted from its exact stored amount. No
 * equity-lens row is passed, because OpenPlan has no SB 535, AB 1550 or
 * tribal-area source; the packet says "not recorded" for those. Nothing here
 * calls a language model.
 */

import { scoreValueForPresentation } from "@/lib/analysis/score-presentation";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { computeAtpPacket } from "@/lib/planner-pack/atp";
import type { AtpGrantResult, AtpLapmRow } from "@/lib/planner-pack/types";
import { formatProjectEstimate } from "@/lib/projects/estimated-cost";

export const ATP_CATALOG_KEY = "atp";

/** The run id the packet carries when the project has no analysis run. */
export const ATP_PACKET_NO_RUN_ID = "no analysis run";

export type SeededSectionFacts = {
  section_key: string;
  source: string;
};

/**
 * The catalog template an application was seeded from, or null when the
 * seeded sections do not identify exactly one.
 */
export function identifySeededCatalogKey(sections: readonly SeededSectionFacts[]): string | null {
  const seeded = new Set(
    sections.filter((section) => section.source === "catalog").map((section) => section.section_key)
  );
  if (seeded.size === 0) return null;

  const templates = GRANT_PROGRAM_CATALOG.map((entry) => ({
    key: entry.key,
    sectionKeys: new Set((entry.applicationSections ?? []).map((template) => template.key)),
  })).filter((template) => template.sectionKeys.size > 0);

  const matches = templates.filter((template) =>
    [...seeded].every((key) => template.sectionKeys.has(key))
  );
  if (matches.length !== 1) return null;

  const [match] = matches;
  const distinguishing = [...seeded].some((key) =>
    templates.every((template) => template.key === match.key || !template.sectionKeys.has(key))
  );
  return distinguishing ? match.key : null;
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
};

/** The project columns the packet reads; the amount is read as text so its exact digits survive. */
export const ATP_PACKET_PROJECT_SELECT =
  "id, name, summary, estimated_cost_amount::text, estimated_cost_currency, estimated_cost_basis_year";

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

function formatYears(years: number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const contiguous = sorted.every((year, index) => index === 0 || year === sorted[index - 1] + 1);
  if (sorted.length > 1 && contiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  return sorted.join(", ");
}

/**
 * The crash source, years and retrieval date behind a run's safety score,
 * read from the run's crash source snapshot. Null when the run recorded none,
 * so the packet says the source is not recorded instead of guessing one.
 */
function describeSafetyScoreSource(metrics: Record<string, unknown> | null): string | null {
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
  const fetchedAt = typeof record.fetchedAt === "string" ? record.fetchedAt.slice(0, 10) : "";
  const parts = [label, years.length > 0 ? `crash years ${formatYears(years)}` : "crash years not recorded"];
  if (/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt)) parts.push(`retrieved ${fetchedAt}`);
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
}): AtpPacketView {
  const metrics = input.run?.metrics ?? null;
  const summary = typeof input.project.summary === "string" ? input.project.summary.trim() : "";
  const lapm: AtpLapmRow = {
    project_id: input.project.id,
    description: summary || null,
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
        safety_source_note: describeSafetyScoreSource(metrics),
      },
    ],
    {
      runId: input.run?.id ?? ATP_PACKET_NO_RUN_ID,
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
