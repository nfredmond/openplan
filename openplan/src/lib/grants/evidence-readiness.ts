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
import {
  ENGAGEMENT_NARRATIVE_CAVEAT,
  summarizeEngagementForCue,
  type ProjectEngagementEvidence,
} from "@/lib/grants/engagement-evidence";
import type { FundingOpportunityRow } from "@/lib/grants/page-helpers";
import type { StatusTone } from "@/lib/ui/status";

export type GrantEvidenceReadinessCueKey =
  | "funding-source-fit"
  | "source-artifact-anchors"
  | "modeling-boundary"
  | "match-reimbursement-posture"
  | "bca-support"
  | "community-engagement";

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
  bcaScreening?: ProjectBcaScreeningSummary | null,
  engagementEvidence?: ProjectEngagementEvidence | null
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
        ? "Fit notes are recorded. They help you decide whether to chase this one; they are not an eligibility ruling."
        : "No fit notes yet. Keep any pursue-or-skip call provisional until someone writes down why this source suits this project.",
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
          ? "This opportunity is tied to a project, a funding program, and readiness notes you can open."
          : `Still missing: ${joinMissing(missingAnchors)}. Keep this in review until each one is attached.`,
      nextAction:
        missingAnchors.length === 0
          ? "Check that the notes actually cite the source materials before you export anything."
          : "Attach the missing record and write the source note before treating this as ready to apply.",
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
      label: fiscalPostureMentioned ? "Match and reimbursement noted" : "Match and reimbursement not stated",
      tone: fiscalPostureMentioned ? "info" : "warning",
      detail: fiscalPostureMentioned
        ? "Your notes mention local match, reimbursement, obligation, award, invoice, or retention. This card still does not check any of it for compliance."
        : `Your notes do not say anything about local match or reimbursement${
            expectedAwardRecorded ? ", even though an expected award amount is recorded" : ""
          }. Award, match, obligation, and invoice details are kept as separate records for someone to review.`,
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
    {
      key: "community-engagement",
      label: engagementEvidence
        ? engagementEvidence.leadCampaign.synthesis
          ? "Community input synthesized"
          : "Engagement not yet synthesized"
        : "No engagement evidence linked",
      tone: engagementEvidence ? (engagementEvidence.leadCampaign.synthesis ? "success" : "info") : "neutral",
      detail: engagementEvidence
        ? `${summarizeEngagementForCue(engagementEvidence)} ${ENGAGEMENT_NARRATIVE_CAVEAT}`
        : "No engagement campaign is linked to this project, so the narrative cannot cite community input. Demonstrated community support is a scored criterion in RAISE, SS4A, and ATIIP-class programs.",
      nextAction: engagementEvidence
        ? engagementEvidence.leadCampaign.synthesis
          ? "Cite the synthesis as screening-level community input only; pair it with the representativeness screening before any equity or outreach-sufficiency language."
          : "Run the campaign's AI synthesis so approved comments become citable narrative evidence."
        : "Launch an engagement campaign linked to this project (or link an existing one) before relying on community-support language.",
    },
  ];
}

export function summarizeGrantEvidenceReadiness(cues: GrantEvidenceReadinessCue[]) {
  const warningCount = cues.filter((cue) => cue.tone === "warning" || cue.tone === "danger").length;

  if (warningCount === 0) {
    return "Each check below has something recorded against it. Read them yourself before you apply — OpenPlan does not decide eligibility or fiscal compliance for you.";
  }

  return `${warningCount} of ${cues.length} checks below still need your attention before you rely on this for an application.`;
}
