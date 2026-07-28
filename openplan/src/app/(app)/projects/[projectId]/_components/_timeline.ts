import {
  fmtCurrency,
  titleize,
  toneForDecision,
  toneForDeliverableStatus,
  toneForInvoiceStatus,
  toneForMilestoneStatus,
  toneForRiskSeverity,
  toneForSubmittalStatus,
} from "./_helpers";
import type {
  BillingInvoice,
  DecisionRow,
  DeliverableRow,
  IssueRow,
  MeetingRow,
  MilestoneRow,
  RecentRun,
  RiskRow,
  SubmittalRow,
  TimelineItem,
} from "./_types";

type StageGateDecisionRow = {
  id: string;
  gate_id: string;
  decision: string;
  rationale: string | null;
  decided_at: string | null;
};

type CitedModelRunItem = {
  id: string;
  run_title: string;
  status: string;
  created_at?: string | null;
};

type CitedCountyRunItem = {
  id: string;
  run_name: string | null;
  stage: string | null;
  updated_at?: string | null;
};

/**
 * Assembles the project activity timeline from every record lane, newest
 * first, capped. Extracted from the page (which sits at the max-lines cap) —
 * pure presentation shaping, no I/O.
 */
export function buildProjectTimelineItems({
  milestones,
  submittals,
  projectInvoices,
  deliverables,
  risks,
  issues,
  decisions,
  meetings,
  recentRuns,
  citedModelRuns,
  citedCountyRuns,
  recentGateDecisions,
  limit = 12,
}: {
  milestones: MilestoneRow[];
  submittals: SubmittalRow[];
  projectInvoices: BillingInvoice[];
  deliverables: DeliverableRow[] | null;
  risks: RiskRow[] | null;
  issues: IssueRow[] | null;
  decisions: DecisionRow[] | null;
  meetings: MeetingRow[] | null;
  recentRuns: RecentRun[] | null;
  citedModelRuns: CitedModelRunItem[];
  citedCountyRuns: CitedCountyRunItem[];
  recentGateDecisions: StageGateDecisionRow[] | null;
  limit?: number;
}): TimelineItem[] {
  return [
    ...milestones.map((item) => ({
      id: `milestone-${item.id}`,
      type: "milestone",
      title: item.title,
      description: item.summary || item.notes || "Milestone added to the project control room.",
      at: item.actual_date || item.target_date || item.created_at,
      badge: `Milestone · ${titleize(item.status)}`,
      tone: toneForMilestoneStatus(item.status),
    })),
    ...submittals.map((item) => ({
      id: `submittal-${item.id}`,
      type: "submittal",
      title: item.title,
      description:
        item.notes ||
        `${titleize(item.submittal_type)}${item.agency_label ? ` · ${item.agency_label}` : ""}`,
      at: item.submitted_at || item.due_date || item.created_at,
      badge: `Submittal · ${titleize(item.status)}`,
      tone: toneForSubmittalStatus(item.status),
    })),
    ...projectInvoices.map((item) => ({
      id: `invoice-${item.id}`,
      type: "invoice",
      title: item.invoice_number,
      description: `${fmtCurrency(item.net_amount)} net${item.submitted_to ? ` · ${item.submitted_to}` : ""}`,
      at: item.invoice_date || item.created_at,
      badge: `Invoice · ${titleize(item.status)}`,
      tone: toneForInvoiceStatus(item.status),
    })),
    ...(deliverables ?? []).map((item) => ({
      id: `deliverable-${item.id}`,
      type: "deliverable",
      title: item.title,
      description: item.summary || "Deliverable added to project.",
      at: item.created_at,
      badge: `Deliverable · ${titleize(item.status)}`,
      tone: toneForDeliverableStatus(item.status),
    })),
    ...(risks ?? []).map((item) => ({
      id: `risk-${item.id}`,
      type: "risk",
      title: item.title,
      description: item.description || "Risk recorded for this project.",
      at: item.created_at,
      badge: `Risk · ${titleize(item.severity)}`,
      tone: toneForRiskSeverity(item.severity),
    })),
    ...(issues ?? []).map((item) => ({
      id: `issue-${item.id}`,
      type: "issue",
      title: item.title,
      description: item.description || "Issue logged for this project.",
      at: item.created_at,
      badge: `Issue · ${titleize(item.status)}`,
      tone: toneForRiskSeverity(item.severity),
    })),
    ...(decisions ?? []).map((item) => ({
      id: `decision-${item.id}`,
      type: "decision",
      title: item.title,
      description: item.rationale,
      at: item.decided_at || item.created_at,
      badge: `Decision · ${titleize(item.status)}`,
      tone: toneForDecision(item.status),
    })),
    ...(meetings ?? []).map((item) => ({
      id: `meeting-${item.id}`,
      type: "meeting",
      title: item.title,
      description: item.notes || item.attendees_summary || "Meeting logged for this project.",
      at: item.meeting_at || item.created_at,
      badge: "Meeting",
      tone: "info" as const,
    })),
    ...(recentRuns ?? []).map((item) => ({
      id: `run-${item.id}`,
      type: "run",
      title: item.title,
      description: item.summary_text || "Analysis run created.",
      at: item.created_at,
      badge: "Analysis Run",
      tone: "success" as const,
    })),
    ...citedModelRuns.map((item) => ({
      id: `cited-model-run-${item.id}`,
      type: "run",
      title: item.run_title,
      description: "Worker model run cited by a project report (screening-grade).",
      at: item.created_at ?? null,
      badge: `Cited Model Run · ${titleize(item.status)}`,
      tone: "info" as const,
    })),
    ...citedCountyRuns.map((item) => ({
      id: `cited-county-run-${item.id}`,
      type: "run",
      title: item.run_name ?? "County run",
      description: "County validation run cited by a project report.",
      at: item.updated_at ?? null,
      badge: `Cited County Run · ${titleize(item.stage ?? "unknown")}`,
      tone: "info" as const,
    })),
    ...(recentGateDecisions ?? []).map((item) => ({
      id: `gate-${item.id}`,
      type: "gate",
      title: item.gate_id,
      description: item.rationale ?? "",
      at: item.decided_at,
      badge: `Stage Gate · ${item.decision}`,
      tone: toneForDecision(item.decision),
    })),
  ]
    .sort((a, b) => {
      const aTime = a.at ? new Date(a.at).getTime() : 0;
      const bTime = b.at ? new Date(b.at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);
}
