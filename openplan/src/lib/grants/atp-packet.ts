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
 * WHERE THE NUMBERS COME FROM. `computeAtpPacket` and the renderer are used
 * unchanged. Safety and equity come from the project's latest corridor
 * analysis run, through the same presentation rule every other surface uses,
 * so a score the run withheld stays null. Climate, feasibility, the weighted
 * total and the sensitivity flag have no producer in OpenPlan and stay null.
 * No equity-lens row is passed, because OpenPlan has no SB 535, AB 1550 or
 * tribal-area source; the packet says "not recorded" for those. Nothing here
 * calls a language model.
 */

import { scoreValueForPresentation } from "@/lib/analysis/score-presentation";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { computeAtpPacket } from "@/lib/planner-pack/atp";
import type { AtpGrantResult } from "@/lib/planner-pack/types";

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

export type AtpPacketProject = { id: string; name: string };

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

/** Build the packet for one project from its latest corridor analysis run. */
export function buildAtpPacketView(input: {
  project: AtpPacketProject;
  run: AtpPacketRun | null;
  generatedAt?: string;
}): AtpPacketView {
  const metrics = input.run?.metrics ?? null;
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
      },
    ],
    {
      runId: input.run?.id ?? ATP_PACKET_NO_RUN_ID,
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
