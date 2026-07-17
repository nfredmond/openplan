/**
 * California Active Transportation Program (ATP) application packet screen.
 *
 * Ported from clawmodeler (Apache-2.0, same author):
 * `clawmodeler_engine/planner_pack/atp.py`.
 *
 * The ATP is administered by the California Transportation Commission
 * (Streets & Highways Code §§2380–2383) and funds bicycle, pedestrian, and
 * safe-routes-to-school projects. Each cycle's application is evaluated
 * against a published scoring rubric that covers project benefits,
 * disadvantaged-community (DAC) benefit, scope/schedule/budget, project
 * readiness, and past performance.
 *
 * This module composes an ATP application packet for every candidate
 * project with screening evidence: project scoring, Caltrans LAPM
 * programming fields, CEQA §15064.3 VMT determinations, and SB 535 /
 * AB 1550 equity findings — and it is honest about the application sections
 * that remain lead-agency judgment (past performance, letters of support,
 * detailed cost estimates, final schedule, environmental determination).
 *
 * Nothing here drafts prose that isn't tied to a fact block: every sentence
 * in a rendered packet either cites a fact_id or is labeled as
 * lead-agency-supplied. This module does not call an LLM.
 */

import {
  InsufficientDataError,
  type AtpCeqaRow,
  type AtpEquityRow,
  type AtpGrantResult,
  type AtpLapmRow,
  type AtpPortfolioSummary,
  type AtpProjectApplication,
  type AtpScoreRow,
  type FactBlock,
} from "./types";
import { coerceBool, coerceStr, formatFixedPython, parseOptionalFloat, pythonRound, utcNow } from "./utilities";

export const DEFAULT_ATP_AGENCY = "Lead agency to be provided";

export const DEFAULT_ATP_CYCLE = "ATP cycle to be provided";

/** Equity-lens benefit categories that qualify for the ATP DAC scoring bonus. */
export const ATP_DAC_SCORING_CATEGORIES: ReadonlySet<string> = new Set([
  "DAC",
  "Low-income near DAC",
  "Low-income",
]);

export type ComputeAtpPacketOptions = {
  runId: string;
  agency?: string;
  cycle?: string;
  lapmRows?: AtpLapmRow[] | null;
  equityRows?: AtpEquityRow[] | null;
  ceqaRows?: AtpCeqaRow[] | null;
  rtpCycleLabel?: string | null;
  /** Override the generated_at stamp (ISO-8601); defaults to now. */
  generatedAt?: string;
};

/**
 * Summarize CEQA VMT determinations across scenarios for the packet.
 *
 * The Planner Pack CEQA module keys determinations by scenario, not by
 * project. For the ATP packet we collapse them into a per-run phrase for
 * the "Benefits — environmental findings" section.
 */
function summarizeCeqaDeterminations(ceqaRows: AtpCeqaRow[] | null | undefined): string {
  if (!ceqaRows || ceqaRows.length === 0) {
    return "CEQA §15064.3 VMT screening has not been run for this workspace.";
  }
  const determinations = ceqaRows
    .map((row) => coerceStr(row.determination))
    .filter((determination) => determination.length > 0);
  if (determinations.length === 0) {
    return "CEQA §15064.3 VMT screening produced no determinations.";
  }
  const significant = determinations.filter((d) =>
    d.toLowerCase().includes("potentially significant")
  ).length;
  const lessThan = determinations.filter((d) =>
    d.toLowerCase().includes("less than significant")
  ).length;
  return (
    `Across ${determinations.length} scenario(s): ` +
    `${significant} potentially significant and ` +
    `${lessThan} less-than-significant VMT determination(s).`
  );
}

/**
 * Build per-project ATP application packets from run evidence.
 *
 * `scoreRows` is the engine's `project_scores.csv` in record form.
 * `lapmRows` (from `lapm_exhibit.csv`), `equityRows` (from
 * `equity_lens.csv`), and `ceqaRows` (from `ceqa_vmt.csv`) are optional
 * Planner Pack outputs used for enrichment. `rtpCycleLabel` is an optional
 * free-text note if the lead agency has identified the RTP cycle the
 * projects are consistent with.
 */
export function computeAtpPacket(
  scoreRows: AtpScoreRow[],
  {
    runId,
    agency = DEFAULT_ATP_AGENCY,
    cycle = DEFAULT_ATP_CYCLE,
    lapmRows = null,
    equityRows = null,
    ceqaRows = null,
    rtpCycleLabel = null,
    generatedAt,
  }: ComputeAtpPacketOptions
): AtpGrantResult {
  if (scoreRows.length === 0) {
    throw new InsufficientDataError(
      "project_scores rows are empty; run a workflow before generating an ATP packet."
    );
  }

  const lapmById = new Map<string, AtpLapmRow>();
  for (const row of lapmRows ?? []) {
    const pid = coerceStr(row.project_id);
    if (pid) {
      lapmById.set(pid, row);
    }
  }

  const equityById = new Map<string, AtpEquityRow>();
  for (const row of equityRows ?? []) {
    const pid = coerceStr(row.project_id);
    if (pid) {
      equityById.set(pid, row);
    }
  }

  const ceqaSummary = summarizeCeqaDeterminations(ceqaRows);
  const rtpConsistencyNote = rtpCycleLabel
    ? `Consistent with the agency's adopted ${rtpCycleLabel} Regional ` +
      `Transportation Plan (lead agency to confirm chapter citation).`
    : "RTP consistency to be documented by lead agency.";

  const applications: AtpProjectApplication[] = [];
  for (const row of scoreRows) {
    const pid = coerceStr(row.project_id);
    if (!pid) {
      continue;
    }

    const safety = parseOptionalFloat(row.safety_score) ?? 0;
    const equity = parseOptionalFloat(row.equity_score) ?? 0;
    const climate = parseOptionalFloat(row.climate_score) ?? 0;
    const feasibility = parseOptionalFloat(row.feasibility_score) ?? 0;
    const total = parseOptionalFloat(row.total_score) ?? 0;
    const sensitivity = coerceStr(row.sensitivity_flag, "UNKNOWN");

    const lapm = lapmById.get(pid) ?? {};
    const locationNote = coerceStr(lapm.location_note, "Location to be provided by lead agency");
    const description = coerceStr(
      lapm.description,
      "Project description to be provided by lead agency."
    );
    const projectType = coerceStr(lapm.project_type, "Project type to be provided by lead agency");
    const scheduleNote = coerceStr(
      lapm.schedule_note,
      "PA&ED, PS&E, R/W, and CON schedule to be provided by lead agency"
    );
    const estimatedCost = parseOptionalFloat(lapm.estimated_cost_usd);

    const equityRow = equityById.get(pid) ?? {};
    const overlaySupplied = coerceBool(equityRow.overlay_supplied);
    const dac = coerceBool(equityRow.dac_sb535);
    const lowIncome = coerceBool(equityRow.low_income_ab1550);
    const tribal = coerceBool(equityRow.tribal_area);
    const benefitCategory = coerceStr(
      equityRow.benefit_category,
      !overlaySupplied ? "Unknown" : "Other"
    );
    const atpDacEligible = ATP_DAC_SCORING_CATEGORIES.has(benefitCategory);

    let readinessNote: string;
    if (sensitivity === "LOW") {
      readinessNote =
        "All four screening dimensions used lead-agency-supplied " +
        "evidence; project is ready for PA&ED scoping.";
    } else if (sensitivity === "MEDIUM") {
      readinessNote =
        "One of four screening dimensions used a placeholder; lead " +
        "agency should refine before final submittal.";
    } else {
      readinessNote =
        "Two or more screening dimensions used placeholders; lead " +
        "agency must supply project-specific evidence before final " +
        "submittal.";
    }

    applications.push({
      project_id: pid,
      name: coerceStr(row.name, pid),
      agency,
      cycle,
      total_score: pythonRound(total, 3),
      safety_score: pythonRound(safety, 3),
      equity_score: pythonRound(equity, 3),
      climate_score: pythonRound(climate, 3),
      feasibility_score: pythonRound(feasibility, 3),
      sensitivity_flag: sensitivity,
      location_note: locationNote,
      description,
      project_type: projectType,
      estimated_cost_usd: estimatedCost,
      schedule_note: scheduleNote,
      ceqa_determination: ceqaSummary,
      dac_sb535: dac,
      low_income_ab1550: lowIncome,
      tribal_area: tribal,
      benefit_category: benefitCategory,
      atp_dac_benefit_eligible: atpDacEligible,
      rtp_consistency_note: rtpConsistencyNote,
      readiness_note: readinessNote,
    });
  }

  if (applications.length === 0) {
    throw new InsufficientDataError("project_scores rows had no usable project_id values.");
  }

  const applicationCount = applications.length;
  const dacCount = applications.filter((app) => app.dac_sb535).length;
  const lowIncomeCount = applications.filter(
    (app) => app.low_income_ab1550 && !app.dac_sb535
  ).length;
  const tribalCount = applications.filter((app) => app.tribal_area).length;
  const meanScore =
    applicationCount > 0
      ? applications.reduce((sum, app) => sum + app.total_score, 0) / applicationCount
      : 0;
  const dacShare = applicationCount > 0 ? dacCount / applicationCount : 0;

  const summary: AtpPortfolioSummary = {
    application_count: applicationCount,
    dac_application_count: dacCount,
    low_income_application_count: lowIncomeCount,
    tribal_application_count: tribalCount,
    dac_share: pythonRound(dacShare, 3),
    mean_total_score: pythonRound(meanScore, 3),
  };

  return {
    run_id: runId,
    agency,
    cycle,
    applications,
    summary,
    generated_at: generatedAt ?? utcNow(),
  };
}

/** Produce grounded fact blocks per application plus the portfolio summary. */
export function atpGrantFactBlocks(result: AtpGrantResult, sourcePath: string): FactBlock[] {
  const blocks: FactBlock[] = [];
  for (const app of result.applications) {
    const dacPhrase = app.dac_sb535
      ? "SB 535 DAC"
      : app.low_income_ab1550
        ? "AB 1550 low-income"
        : "non-DAC / non-AB-1550";
    const claim =
      `ATP application draft for project \`${app.project_id}\` ` +
      `(${app.name}): total screening score ${formatFixedPython(app.total_score, 1)}/100 ` +
      `(safety ${formatFixedPython(app.safety_score, 1)}, equity ${formatFixedPython(app.equity_score, 1)}, ` +
      `climate ${formatFixedPython(app.climate_score, 1)}, feasibility ` +
      `${formatFixedPython(app.feasibility_score, 1)}); community context ` +
      `${dacPhrase}; sensitivity flag ${app.sensitivity_flag}.`;
    blocks.push({
      fact_id: `atp-application-${app.project_id}`,
      fact_type: "atp_application_project",
      project_id: app.project_id,
      claim_text: claim,
      method_ref: "planner_pack.atp_packet",
      artifact_refs: [{ path: sourcePath, type: "table" }],
      source_table: sourcePath,
      source_row: app.project_id,
    });
  }

  if (result.summary !== null) {
    const summary = result.summary;
    const portfolioClaim =
      `ATP portfolio for ${result.agency} (${result.cycle}): ` +
      `${summary.application_count} application draft(s), ` +
      `mean total score ${formatFixedPython(summary.mean_total_score, 1)}/100; ` +
      `${summary.dac_application_count} SB 535 DAC ` +
      `(${formatFixedPython(summary.dac_share * 100, 1)}%), ` +
      `${summary.low_income_application_count} AB 1550 low-income (not DAC), ` +
      `${summary.tribal_application_count} in a tribal area.`;
    blocks.push({
      fact_id: "atp-application-summary",
      fact_type: "atp_application_summary",
      claim_text: portfolioClaim,
      method_ref: "planner_pack.atp_packet",
      artifact_refs: [{ path: sourcePath, type: "table" }],
      source_table: sourcePath,
      source_row: "portfolio",
    });
  }

  return blocks;
}
