/**
 * Planner Pack markdown renderers.
 *
 * Ported from clawmodeler (Apache-2.0, same author):
 * `clawmodeler_engine/templates/planner_pack/ceqa_vmt.md.j2` and
 * `atp_packet.md.j2`, rewritten as template-literal builders so OpenPlan
 * carries no Jinja dependency.
 *
 * Output is byte-identical to the Jinja renders (verified against jinja2
 * 3.1.6 with `trim_blocks=False`, `keep_trailing_newline=True`) with one
 * deliberate divergence: the platform name — "ClawModeler" in the source
 * templates reads "OpenPlan" here. Every caveat, statutory citation, and
 * disclaimer string is otherwise preserved verbatim; these memos are
 * screening-level drafts, not determinations of record, and the wording
 * that says so must not drift.
 */

import type { AtpGrantResult, AtpProjectApplication, CeqaVmtResult } from "./types";
import { formatFixedPython, formatPythonFloat, pythonRound } from "./utilities";

export type RenderPlannerPackOptions = {
  runId: string;
  engineVersion: string;
  /** CEQA memo only: the determination used the opt-in CALIBRATED (count-tuned)
   * VMT, not the screening default. Disclosed in the exported artifact so a
   * calibrated-basis memo can never be mistaken for a screening determination.
   * Omitted/false → the memo is byte-identical to the screening output. */
  calibratedBasis?: boolean;
};

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

/** `{{ (pct * 100) | round(0, 'floor') | int }}` from the Jinja templates. */
function floorPercent(fraction: number): number {
  return Math.floor(fraction * 100);
}

/** `{{ (delta_pct * 100) | round(1) }}` — Jinja `round` uses Python round semantics. */
function deltaPercentDisplay(deltaPct: number): string {
  return formatPythonFloat(pythonRound(deltaPct * 100, 1));
}

/** Render the CEQA §15064.3 VMT memo as Markdown. */
export function renderCeqaVmtMarkdown(
  result: CeqaVmtResult,
  { runId, engineVersion, calibratedBasis = false }: RenderPlannerPackOptions
): string {
  const thresholdPctDisplay = floorPercent(result.threshold_pct);
  const referenceDisplay = formatPythonFloat(result.reference_vmt_per_capita);
  const thresholdDisplay = formatPythonFloat(result.threshold_vmt_per_capita);
  const scenarios = result.scenarios;
  const significantScenarios = scenarios.filter((scenario) => scenario.significant);
  const belowScenarios = scenarios.filter((scenario) => !scenario.significant);

  let out = `# CEQA §15064.3 VMT Significance Determination${
    calibratedBasis ? " (CALIBRATED-INPUT BASIS)" : ""
  } — run \`${runId}\`

- Engine version: \`${engineVersion}\`
- Generated: \`${result.generated_at}\`
- Project type: **${result.project_type}**
- Reference baseline: **${result.reference_label}** — ${referenceDisplay} VMT per capita
- Screening threshold: **${thresholdPctDisplay}% below ${result.reference_label}** → ${thresholdDisplay} VMT per capita${
    calibratedBasis
      ? "\n- **Determination basis: CALIBRATED (count-tuned) VMT** — an opt-in, count-informed refinement, NOT the screening default"
      : ""
  }

## Scope

This memo documents the CEQA transportation-impact significance screening for each
scenario produced by OpenPlan run \`${runId}\`. Per California Public Resources
Code §21099 and CEQA Guidelines §15064.3 (revised after SB 743), vehicle miles
traveled (VMT) is the preferred metric for transportation-impact significance for
land-use and transportation projects.${
    calibratedBasis
      ? "\n\n**Calibrated-input basis (disclosure):** the VMT per capita below is the" +
        " CALIBRATED (count-tuned) estimate from the demand-nudge calibration stage — the model" +
        " was tuned to observed traffic counts — NOT the default screening VMT. It is a" +
        " screening-grade calibrated refinement, not a validated forecast; the default screening" +
        " determination differs. Do not present this memo as a screening-basis determination."
      : ""
  }

## Methodology

The Governor's Office of Planning and Research (OPR) *Technical Advisory on
Evaluating Transportation Impacts in CEQA* (December 2018) recommends **15 percent
below the regional or citywide VMT-per-capita baseline** as the default residential
screening threshold. Scenarios at or above that cut line are flagged as *potentially
significant*; scenarios below it are *less than significant*. The cut line applied
to this run is **${thresholdDisplay} VMT per capita**
(${thresholdPctDisplay} percent below the
${result.reference_label} reference of ${referenceDisplay}
VMT per capita). Determinations are arithmetic and reproducible; no model is
consulted.

## Per-scenario determinations

`;

  if (scenarios.length > 0) {
    out += `| Scenario | Population | Daily VMT | VMT/capita | Threshold | Δ vs. threshold | Determination |
|---|---:|---:|---:|---:|---:|---|
`;
    for (const scenario of scenarios) {
      out += `| \`${scenario.scenario_id}\` | ${formatPythonFloat(scenario.population)} | ${formatPythonFloat(scenario.daily_vmt)} | ${formatPythonFloat(scenario.vmt_per_capita)} | ${formatPythonFloat(scenario.threshold_vmt_per_capita)} | ${deltaPercentDisplay(scenario.delta_pct)}% | **${scenario.determination}** |\n`;
    }
    out += "\n";
  } else {
    out += "_No scenarios were available for CEQA screening._\n";
  }
  out += "\n\n## Findings\n\n\n";

  if (significantScenarios.length > 0) {
    out += `The following scenarios are **potentially significant** under CEQA §15064.3 and
require VMT mitigation or a substantial-evidence finding before the lead agency
can issue a less-than-significant determination:

`;
    for (const scenario of significantScenarios) {
      out += `- \`${scenario.scenario_id}\`: ${formatPythonFloat(scenario.vmt_per_capita)} VMT per capita — ${deltaPercentDisplay(scenario.delta_pct)}% above the ${formatPythonFloat(scenario.threshold_vmt_per_capita)} VMT per capita threshold. Mitigation required.\n`;
    }
    out += "\n";
  } else {
    out += `No scenarios in this run exceed the CEQA §15064.3 screening threshold. All
scenarios are **less than significant** for transportation-impact purposes.
`;
  }
  out += "\n\n\n";

  if (belowScenarios.length > 0) {
    out += `The following scenarios are **less than significant** and do not require VMT
mitigation under CEQA §15064.3:

`;
    for (const scenario of belowScenarios) {
      out += `- \`${scenario.scenario_id}\`: ${formatPythonFloat(scenario.vmt_per_capita)} VMT per capita — ${deltaPercentDisplay(scenario.delta_pct)}% versus the ${formatPythonFloat(scenario.threshold_vmt_per_capita)} VMT per capita threshold.\n`;
    }
    out += "\n";
  }
  out += "\n";

  out += `
## Citations

- California Public Resources Code §21099.
- CEQA Guidelines §15064.3 (14 CCR §15064.3).
- Governor's Office of Planning and Research, *Technical Advisory on Evaluating Transportation Impacts in CEQA*, December 2018.

## Notes

- Determinations in this memo are *screening-level*. A lead agency may adopt a
  different threshold or a custom methodology with substantial evidence. Override
  the reference VMT per capita or the percent-below value on the command line to
  reproduce the agency's preferred cut line.
- Every determination in this memo is mirrored as a \`ceqa_vmt_determination\`
  fact_block appended to this run's \`fact_blocks.jsonl\`, so subsequent narrative
  and chat turns remain subject to the OpenPlan citation contract.

---

*OpenPlan Planner Pack — CEQA §15064.3 VMT significance screening.*
`;

  return out;
}

function renderAtpApplication(app: AtpProjectApplication): string {
  const costLine =
    app.estimated_cost_usd !== null
      ? `- Estimated programmed cost: **$${formatFixedPython(app.estimated_cost_usd, 0)}** (lead agency estimate; allocate across PA&ED / PS&E / R/W / CON per LAPM Chapter 3).`
      : "- Estimated programmed cost: _to be provided by lead agency (PA&ED, PS&E, R/W, CON)._";

  return `### \`${app.project_id}\` — ${app.name}

**Application identifiers**

- Project ID: \`${app.project_id}\`
- Project title: ${app.name}
- Lead agency: ${app.agency}
- ATP cycle: ${app.cycle}
- Project type: ${app.project_type}
- Location: ${app.location_note}

**Project description**

${app.description}

**Benefits (ATP scoring areas A + B)**

| Dimension | Score |
|---|---:|
| Safety | ${formatPythonFloat(app.safety_score)} |
| Equity | ${formatPythonFloat(app.equity_score)} |
| Climate | ${formatPythonFloat(app.climate_score)} |
| Feasibility | ${formatPythonFloat(app.feasibility_score)} |
| **Total (weighted 30/25/25/20)** | **${formatPythonFloat(app.total_score)}** |
| Sensitivity flag | ${app.sensitivity_flag} |

- CEQA §15064.3 VMT screening: ${app.ceqa_determination}

**Disadvantaged-community benefit (ATP scoring area DAC)**

- SB 535 DAC: ${yesNo(app.dac_sb535)}
- AB 1550 low-income: ${yesNo(app.low_income_ab1550)}
- Tribal area: ${yesNo(app.tribal_area)}
- Benefit category: **${app.benefit_category}**
- ATP DAC benefit bonus eligible: **${yesNo(app.atp_dac_benefit_eligible)}** (eligible when the equity lens places the project in DAC, Low-income near DAC, or Low-income categories).

**Scope, schedule, and budget**

${costLine}

- Schedule: ${app.schedule_note}

**Project readiness**

- ${app.readiness_note}

**Regional plan consistency**

- ${app.rtp_consistency_note}

**Past performance, letters of support, and final environmental determination**

- _Lead agency to supply._ OpenPlan does not synthesize prior-project
  performance, local letters of support, or final environmental
  determinations; the lead agency must complete these sections of the
  ATP application.

`;
}

/** Render the ATP application packet as Markdown. */
export function renderAtpPacketMarkdown(
  result: AtpGrantResult,
  { runId, engineVersion }: RenderPlannerPackOptions
): string {
  const summary = result.summary;

  let out = `# California ATP Application Packet — run \`${runId}\`

- Engine version: \`${engineVersion}\`
- Generated: \`${result.generated_at}\`
- Lead agency: **${result.agency}**
- ATP cycle: **${result.cycle}**
- Application drafts in this packet: **${result.applications.length}**

## Scope

This packet drafts one California Active Transportation Program (ATP)
application narrative per candidate project in OpenPlan run
\`${runId}\`. ATP is administered by the California Transportation
Commission (CTC) under Streets & Highways Code §§2380–2383 and funds
bicycle, pedestrian, and Safe Routes to School projects. Each draft is
a structured outline populated with every fact OpenPlan has evidence
for — screening scores, Caltrans LAPM programming fields, CEQA §15064.3
VMT determinations, and SB 535 / AB 1550 / tribal equity findings — and
explicit about sections that remain lead-agency judgment (past
performance, detailed cost estimates, letters of support, environmental
determination, final schedule).

## Methodology

- **Project screening scores** come from this run's \`project_scores.csv\`
  and are mirrored in the \`project_scoring\` fact_blocks.
- **Programming fields** (location, description, cost, schedule) are
  lifted from \`lapm_exhibit.csv\` when the Caltrans LAPM packet has been
  generated for the same run (\`planner-pack lapm-exhibit\`).
- **CEQA VMT determinations** are lifted from \`ceqa_vmt.csv\` when
  \`planner-pack ceqa-vmt\` has been run.
- **Equity findings** (SB 535 DAC / AB 1550 / tribal) are lifted from
  \`equity_lens.csv\` when \`planner-pack equity-lens\` has been run. ATP
  awards bonus scoring for projects that benefit a DAC; this packet
  labels each application as **eligible** for that bonus when the
  equity lens places it in the \`DAC\`, \`Low-income near DAC\`, or
  \`Low-income\` benefit category.
- Every application below is mirrored as an \`atp_application_project\`
  fact_block, and the portfolio summary as an \`atp_application_summary\`
  fact_block, so downstream narrative and chat turns remain under the
  OpenPlan citation contract.

## Portfolio summary

`;

  if (summary !== null) {
    out += `- Application drafts: **${summary.application_count}**
- Mean screening total score: **${formatPythonFloat(summary.mean_total_score)}**
- SB 535 DAC applications: **${summary.dac_application_count}** (${formatFixedPython(summary.dac_share * 100, 1)}%)
- AB 1550 low-income (not DAC) applications: **${summary.low_income_application_count}**
- Tribal-area applications: **${summary.tribal_application_count}** (AB 52 consultation trigger if any)
`;
  } else {
    out += "_Portfolio summary unavailable._\n";
  }
  out += "\n\n## Per-project application drafts\n\n";

  for (const app of result.applications) {
    out += renderAtpApplication(app);
  }
  out += "\n";

  out += `
## Citations

- California Streets & Highways Code §§ 2380–2383 — Active Transportation Program.
- California Transportation Commission, *Active Transportation Program Guidelines* (latest adopted cycle).
- California Government Code §39711 — SB 535 (De León, 2012).
- California Health & Safety Code §39713 — AB 1550 (Gomez, 2016).
- California Public Resources Code §21099 + CEQA Guidelines §15064.3 — transportation impact significance.
- Caltrans *Local Assistance Procedures Manual*, Chapter 3 (Project Authorization) and Chapter 7 (Field Review).
- California Government Code §65080 — Regional Transportation Plans.

## Notes

- This packet is a **screening-level draft**. It does not substitute for
  the lead agency's submitted ATP application, CTC scoring, CEQA
  determination, or AB 52 tribal consultation.
- Every application draft above is mirrored as an
  \`atp_application_project\` fact_block in this run's
  \`fact_blocks.jsonl\`, and the portfolio totals as an
  \`atp_application_summary\` fact_block, keeping downstream narrative
  and chat turns under the OpenPlan citation contract.

---

*OpenPlan Planner Pack — California ATP grant application packet.*
`;

  return out;
}
