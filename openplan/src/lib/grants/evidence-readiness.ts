import { BCA_SCREENING_CAVEAT } from "@/lib/bca/parameters";
import {
  summarizeBcaScreeningForCue,
  type ProjectBcaScreeningSummary,
} from "@/lib/grants/bca-evidence";
import {
  GRANT_MODELING_PLANNING_CAVEAT,
  describeProjectGrantModelingReadiness,
  type ProjectGrantModelingEvidence,
} from "@/lib/grants/modeling-evidence";
import type { FundingOpportunityRow } from "@/lib/grants/page-helpers";
import type { StatusTone } from "@/lib/ui/status";

export type GrantEvidenceReadinessCueKey =
  | "funding-source-fit"
  | "source-artifact-anchors"
  | "modeling-boundary"
  | "match-reimbursement-posture"
  | "bca-support";

export type GrantEvidenceReadinessCue = {
  key: GrantEvidenceReadinessCueKey;
  label: string;
  tone: StatusTone;
  detail: string;
  nextAction: string;
};

type OpportunityEvidenceReadinessInput = Pick<
  FundingOpportunityRow,
  | "fit_notes"
  | "readiness_notes"
  | "decision_rationale"
  | "expected_award_amount"
  | "project_id"
  | "program_id"
  | "closes_at"
  | "decision_due_at"
> & {
  project?: { id: string; name: string } | null;
  program?: { id: string; title: string } | null;
};

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasPositiveAmount(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(numeric) && numeric > 0;
}

function joinMissing(items: string[]) {
  return items.length ? items.join(", ") : "none";
}

function mentionsMatchOrReimbursement(opportunity: OpportunityEvidenceReadinessInput) {
  const searchable = [opportunity.readiness_notes, opportunity.decision_rationale]
    .filter(hasText)
    .join(" ")
    .toLowerCase();

  return /\b(match|local match|reimburse|reimbursement|invoice|obligation|obligate|award|retention)\b/.test(
    searchable
  );
}

export function buildGrantEvidenceReadinessCues(
  opportunity: OpportunityEvidenceReadinessInput,
  modelingEvidence: ProjectGrantModelingEvidence | null | undefined,
  bcaScreening?: ProjectBcaScreeningSummary | null
): GrantEvidenceReadinessCue[] {
  const fitNotesRecorded = hasText(opportunity.fit_notes);
  const readinessNotesRecorded = hasText(opportunity.readiness_notes);
  const projectLinked = Boolean(opportunity.project?.id ?? opportunity.project_id);
  const programLinked = Boolean(opportunity.program?.id ?? opportunity.program_id);
  const expectedAwardRecorded = hasPositiveAmount(opportunity.expected_award_amount);
  const modelingReadiness = describeProjectGrantModelingReadiness(modelingEvidence);
  const fiscalPostureMentioned = mentionsMatchOrReimbursement(opportunity);

  const missingAnchors = [
    projectLinked ? null : "linked project",
    programLinked ? null : "program/funding-source anchor",
    readinessNotesRecorded ? null : "readiness/source-artifact notes",
  ].filter((value): value is string => Boolean(value));

  return [
    {
      key: "funding-source-fit",
      label: fitNotesRecorded ? "Fit notes documented" : "Fit notes missing",
      tone: fitNotesRecorded ? "success" : "warning",
      detail: fitNotesRecorded
        ? "Funding-source fit notes are visible for operator review. They support triage language but are not an eligibility determination."
        : "No funding-source fit notes are visible yet, so pursue/skip language should stay provisional until an operator records why the source fits this project.",
      nextAction: fitNotesRecorded
        ? "Review fit language against the actual NOFO/program guidance before final application copy."
        : "Add a short fit note tied to the funding source, project purpose, and known program priorities.",
    },
    {
      key: "source-artifact-anchors",
      label: missingAnchors.length === 0 ? "Source anchors documented" : "Source anchors incomplete",
      tone: missingAnchors.length === 0 ? "success" : "warning",
      detail:
        missingAnchors.length === 0
          ? "The opportunity is anchored to a project, funding/program record, and readiness notes visible in the workspace."
          : `Required source anchors are still incomplete: ${joinMissing(missingAnchors)}. Keep the opportunity in review until these artifacts are explicit.`,
      nextAction:
        missingAnchors.length === 0
          ? "Confirm the visible notes cite or summarize the actual source materials before export."
          : "Link the missing record(s) and capture the source-artifact note before treating this as grant-ready.",
    },
    {
      key: "modeling-boundary",
      label: modelingReadiness?.label ?? "No modeling packet linked",
      tone: modelingReadiness?.tone ?? "neutral",
      detail: modelingReadiness
        ? `${modelingReadiness.detail} ${GRANT_MODELING_PLANNING_CAVEAT}`
        : `No comparison-backed modeling packet is visible for this project yet. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      nextAction:
        modelingReadiness?.key === "decision-ready"
          ? "Use the packet as cited planning support only; do not convert it into award likelihood or validated forecasting language."
          : modelingReadiness?.key === "stale"
            ? "Refresh the supporting packet before final pursue language or grant narrative reuse."
            : "Add or strengthen cited planning/modeling evidence before leaning on analysis language.",
    },
    {
      key: "match-reimbursement-posture",
      label: fiscalPostureMentioned ? "Fiscal posture mentioned" : "Match/reimbursement not stated",
      tone: fiscalPostureMentioned ? "info" : "warning",
      detail: fiscalPostureMentioned
        ? "Readiness or decision notes mention match, reimbursement, obligation, award, invoice, or retention posture. This card still does not certify fiscal compliance."
        : `No local match or reimbursement posture is stated in the visible opportunity notes${
            expectedAwardRecorded ? ", even though an expected award amount is recorded" : ""
          }. Award, match, obligation, and invoice details remain separate operator-reviewed records.`,
      nextAction: fiscalPostureMentioned
        ? "Cross-check the award, match, obligation, and invoice lanes before application or reimbursement language leaves OpenPlan."
        : "Record whether local match, reimbursement timing, and obligation risk are known, unknown, or out of scope for this source.",
    },
    {
      key: "bca-support",
      label: bcaScreening ? "BCA screening saved" : "No BCA screening saved",
      tone: bcaScreening ? "success" : "neutral",
      detail: bcaScreening
        ? `${summarizeBcaScreeningForCue(bcaScreening)} ${BCA_SCREENING_CAVEAT}`
        : "No screening-level benefit-cost analysis is saved for this project. A benefit-cost case matters most for benefit-cost-scored sources — USDOT BUILD and INFRA-class programs require an application BCA, and California's Local HSIP scores on a Local Roadway Safety Manual benefit/cost.",
      nextAction: bcaScreening
        ? "Re-run and re-save the screening if costs or benefits have changed. This is a USDOT-style screening analogue; confirm the source's own required method (USDOT BCA Guidance, or the Caltrans LRSM for Local HSIP) before application use."
        : "If this source scores on benefit-cost, run the benefit-cost screen on the grants worksurface and save it to the project record.",
    },
  ];
}

export function summarizeGrantEvidenceReadiness(cues: GrantEvidenceReadinessCue[]) {
  const warningCount = cues.filter((cue) => cue.tone === "warning" || cue.tone === "danger").length;

  if (warningCount === 0) {
    return "Visible grant evidence cues are documented for supervised review; final application, eligibility, and fiscal decisions still require human source review.";
  }

  return `${warningCount} of ${cues.length} visible grant evidence cues need operator review before pursue, application, or reimbursement language is treated as ready.`;
}
