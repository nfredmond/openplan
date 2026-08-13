"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Flag,
  Loader2,
  MessagesSquare,
  Scale,
  Siren,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AssigneePicker } from "@/components/workspaces/assignee-picker";

/**
 * The record types this composer can create, in the order it presents them.
 * Exported so a caller naming a subset cannot name one that does not exist,
 * and so a guard can check that the subsets a page renders add up to all seven.
 */
export const PROJECT_RECORD_COMPOSER_TYPES = [
  "milestone",
  "submittal",
  "deliverable",
  "risk",
  "issue",
  "decision",
  "meeting",
] as const;

export type ProjectRecordComposerType = (typeof PROJECT_RECORD_COMPOSER_TYPES)[number];

/**
 * The trigger for each type: its icon, and its name as it appears in the
 * heading. Plural in the heading because the heading describes a capability
 * ("add milestones"), singular on the tab because a tab opens one form.
 */
const RECORD_TYPE_META: Record<
  ProjectRecordComposerType,
  { label: string; plural: string; Icon: typeof Flag }
> = {
  milestone: { label: "Milestone", plural: "milestones", Icon: Flag },
  submittal: { label: "Submittal", plural: "submittals", Icon: FileText },
  deliverable: { label: "Deliverable", plural: "deliverables", Icon: ClipboardCheck },
  risk: { label: "Risk", plural: "risks", Icon: AlertTriangle },
  issue: { label: "Issue", plural: "issues", Icon: Siren },
  decision: { label: "Decision", plural: "decisions", Icon: Scale },
  meeting: { label: "Meeting", plural: "meetings", Icon: MessagesSquare },
};

/** "milestones, submittals, and deliverables" — the heading's own object. */
function listRecordTypes(types: readonly ProjectRecordComposerType[]): string {
  const names = types.map((type) => RECORD_TYPE_META[type].plural);
  if (names.length <= 1) return names[0] ?? "records";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

type ProjectRecordComposerProps = {
  projectId: string;
  /**
   * Required, not optional: the assignee pickers below cannot load a roster
   * without it, and an optional prop the page forgot to pass would render four
   * forms whose assignee field silently never works. The workspace is the
   * project's own (`project.workspace_id`), never the caller's "current" one —
   * a member of two workspaces can be looking at either.
   */
  workspaceId: string;
  /**
   * Which record types this instance offers. The project page splits its record
   * lanes across two tabs — what is owed in Delivery, what was decided in
   * Record — and each tab renders the composer for its own types, because a
   * planner reading a risk log must not have to leave the tab to add a risk.
   * Omitted means all seven, which is the right default for any single-tab
   * surface but is deliberately not what either project tab passes.
   */
  recordTypes?: readonly ProjectRecordComposerType[];
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function ProjectRecordComposer({
  projectId,
  workspaceId,
  recordTypes = PROJECT_RECORD_COMPOSER_TYPES,
}: ProjectRecordComposerProps) {
  const router = useRouter();

  // Presentation order is this component's, not the caller's: two tabs whose
  // lists were written in different orders would otherwise offer the same
  // record types in different places.
  const offered = PROJECT_RECORD_COMPOSER_TYPES.filter((type) => recordTypes.includes(type));
  const shows = (type: ProjectRecordComposerType) => offered.includes(type);

  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneSummary, setMilestoneSummary] = useState("");
  const [milestoneType, setMilestoneType] = useState("authorization");
  const [milestonePhaseCode, setMilestonePhaseCode] = useState("initiation");
  const [milestoneStatus, setMilestoneStatus] = useState("scheduled");
  const [milestoneOwner, setMilestoneOwner] = useState("");
  // The teammate lane, beside the free-text owner above. Null is the only
  // starting value: a composer that pre-selected somebody would be inventing
  // an assignment nobody made.
  const [milestoneAssignee, setMilestoneAssignee] = useState<string | null>(null);
  const [milestoneTargetDate, setMilestoneTargetDate] = useState("");
  const [milestoneActualDate, setMilestoneActualDate] = useState("");
  const [milestoneNotes, setMilestoneNotes] = useState("");
  const [milestoneError, setMilestoneError] = useState<string | null>(null);
  const [milestoneSaving, setMilestoneSaving] = useState(false);

  const [submittalTitle, setSubmittalTitle] = useState("");
  const [submittalType, setSubmittalType] = useState("authorization_packet");
  const [submittalStatus, setSubmittalStatus] = useState("draft");
  const [submittalAgency, setSubmittalAgency] = useState("");
  const [submittalAssignee, setSubmittalAssignee] = useState<string | null>(null);
  const [submittalReferenceNumber, setSubmittalReferenceNumber] = useState("");
  const [submittalDueDate, setSubmittalDueDate] = useState("");
  const [submittalSubmittedAt, setSubmittalSubmittedAt] = useState("");
  const [submittalReviewCycle, setSubmittalReviewCycle] = useState("1");
  const [submittalNotes, setSubmittalNotes] = useState("");
  const [submittalError, setSubmittalError] = useState<string | null>(null);
  const [submittalSaving, setSubmittalSaving] = useState(false);

  const [deliverableTitle, setDeliverableTitle] = useState("");
  const [deliverableSummary, setDeliverableSummary] = useState("");
  const [deliverableOwner, setDeliverableOwner] = useState("");
  const [deliverableAssignee, setDeliverableAssignee] = useState<string | null>(null);
  const [deliverableDueDate, setDeliverableDueDate] = useState("");
  const [deliverableStatus, setDeliverableStatus] = useState("not_started");
  const [deliverableBudget, setDeliverableBudget] = useState("");
  const [deliverablePercentComplete, setDeliverablePercentComplete] = useState("");
  const [deliverableError, setDeliverableError] = useState<string | null>(null);
  const [deliverableSaving, setDeliverableSaving] = useState(false);

  const [riskTitle, setRiskTitle] = useState("");
  const [riskDescription, setRiskDescription] = useState("");
  const [riskSeverity, setRiskSeverity] = useState("medium");
  const [riskStatus, setRiskStatus] = useState("open");
  const [riskMitigation, setRiskMitigation] = useState("");
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskSaving, setRiskSaving] = useState(false);

  const [issueTitle, setIssueTitle] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSeverity, setIssueSeverity] = useState("medium");
  const [issueStatus, setIssueStatus] = useState("open");
  const [issueOwner, setIssueOwner] = useState("");
  const [issueAssignee, setIssueAssignee] = useState<string | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueSaving, setIssueSaving] = useState(false);

  const [decisionTitle, setDecisionTitle] = useState("");
  const [decisionRationale, setDecisionRationale] = useState("");
  const [decisionStatus, setDecisionStatus] = useState("proposed");
  const [decisionImpact, setDecisionImpact] = useState("");
  const [decisionAt, setDecisionAt] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);

  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [meetingAt, setMeetingAt] = useState("");
  const [meetingAttendees, setMeetingAttendees] = useState("");
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [meetingSaving, setMeetingSaving] = useState(false);

  async function submitRecord(payload: Record<string, unknown>) {
    const response = await fetch(`/api/projects/${projectId}/records`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as { error?: string; details?: string };

    if (!response.ok) {
      throw new Error(data.details || data.error || "Failed to save record");
    }

    router.refresh();
  }

  async function handleMilestoneSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMilestoneError(null);
    setMilestoneSaving(true);
    try {
      await submitRecord({
        recordType: "milestone",
        title: milestoneTitle,
        summary: milestoneSummary,
        milestoneType,
        phaseCode: milestonePhaseCode,
        status: milestoneStatus,
        ownerLabel: milestoneOwner,
        assigneeUserId: milestoneAssignee ?? undefined,
        targetDate: milestoneTargetDate,
        actualDate: milestoneActualDate,
        notes: milestoneNotes,
      });
      setMilestoneTitle("");
      setMilestoneSummary("");
      setMilestoneType("authorization");
      setMilestonePhaseCode("initiation");
      setMilestoneStatus("scheduled");
      setMilestoneOwner("");
      setMilestoneAssignee(null);
      setMilestoneTargetDate("");
      setMilestoneActualDate("");
      setMilestoneNotes("");
    } catch (error) {
      setMilestoneError(error instanceof Error ? error.message : "Failed to save milestone");
    } finally {
      setMilestoneSaving(false);
    }
  }

  async function handleSubmittalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittalError(null);
    setSubmittalSaving(true);
    try {
      await submitRecord({
        recordType: "submittal",
        title: submittalTitle,
        submittalType,
        status: submittalStatus,
        agencyLabel: submittalAgency,
        assigneeUserId: submittalAssignee ?? undefined,
        referenceNumber: submittalReferenceNumber,
        dueDate: submittalDueDate,
        submittedAt: submittalSubmittedAt ? new Date(submittalSubmittedAt).toISOString() : undefined,
        reviewCycle: Number.parseInt(submittalReviewCycle, 10) || 1,
        notes: submittalNotes,
      });
      setSubmittalTitle("");
      setSubmittalType("authorization_packet");
      setSubmittalStatus("draft");
      setSubmittalAgency("");
      setSubmittalAssignee(null);
      setSubmittalReferenceNumber("");
      setSubmittalDueDate("");
      setSubmittalSubmittedAt("");
      setSubmittalReviewCycle("1");
      setSubmittalNotes("");
    } catch (error) {
      setSubmittalError(error instanceof Error ? error.message : "Failed to save submittal");
    } finally {
      setSubmittalSaving(false);
    }
  }

  async function handleDeliverableSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeliverableError(null);
    setDeliverableSaving(true);
    try {
      await submitRecord({
        recordType: "deliverable",
        title: deliverableTitle,
        summary: deliverableSummary,
        ownerLabel: deliverableOwner,
        assigneeUserId: deliverableAssignee ?? undefined,
        dueDate: deliverableDueDate,
        status: deliverableStatus,
        budgetAmount: deliverableBudget.trim() ? Number.parseFloat(deliverableBudget) : undefined,
        percentComplete: deliverablePercentComplete.trim() ? Number.parseFloat(deliverablePercentComplete) : undefined,
      });
      setDeliverableTitle("");
      setDeliverableSummary("");
      setDeliverableOwner("");
      setDeliverableAssignee(null);
      setDeliverableDueDate("");
      setDeliverableStatus("not_started");
      setDeliverableBudget("");
      setDeliverablePercentComplete("");
    } catch (error) {
      setDeliverableError(error instanceof Error ? error.message : "Failed to save deliverable");
    } finally {
      setDeliverableSaving(false);
    }
  }

  async function handleRiskSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRiskError(null);
    setRiskSaving(true);
    try {
      await submitRecord({
        recordType: "risk",
        title: riskTitle,
        description: riskDescription,
        severity: riskSeverity,
        status: riskStatus,
        mitigation: riskMitigation,
      });
      setRiskTitle("");
      setRiskDescription("");
      setRiskSeverity("medium");
      setRiskStatus("open");
      setRiskMitigation("");
    } catch (error) {
      setRiskError(error instanceof Error ? error.message : "Failed to save risk");
    } finally {
      setRiskSaving(false);
    }
  }

  async function handleIssueSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssueError(null);
    setIssueSaving(true);
    try {
      await submitRecord({
        recordType: "issue",
        title: issueTitle,
        description: issueDescription,
        severity: issueSeverity,
        status: issueStatus,
        ownerLabel: issueOwner,
        assigneeUserId: issueAssignee ?? undefined,
      });
      setIssueTitle("");
      setIssueDescription("");
      setIssueSeverity("medium");
      setIssueStatus("open");
      setIssueOwner("");
      setIssueAssignee(null);
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : "Failed to save issue");
    } finally {
      setIssueSaving(false);
    }
  }

  async function handleDecisionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDecisionError(null);
    setDecisionSaving(true);
    try {
      await submitRecord({
        recordType: "decision",
        title: decisionTitle,
        rationale: decisionRationale,
        status: decisionStatus,
        impactSummary: decisionImpact,
        decidedAt: decisionAt ? new Date(decisionAt).toISOString() : undefined,
      });
      setDecisionTitle("");
      setDecisionRationale("");
      setDecisionStatus("proposed");
      setDecisionImpact("");
      setDecisionAt("");
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : "Failed to save decision");
    } finally {
      setDecisionSaving(false);
    }
  }

  async function handleMeetingSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMeetingError(null);
    setMeetingSaving(true);
    try {
      await submitRecord({
        recordType: "meeting",
        title: meetingTitle,
        notes: meetingNotes,
        meetingAt: meetingAt ? new Date(meetingAt).toISOString() : undefined,
        attendeesSummary: meetingAttendees,
      });
      setMeetingTitle("");
      setMeetingNotes("");
      setMeetingAt("");
      setMeetingAttendees("");
    } catch (error) {
      setMeetingError(error instanceof Error ? error.message : "Failed to save meeting");
    } finally {
      setMeetingSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-heading">
        <p className="module-section-label">Create records</p>
        <h2 className="module-section-title">Add {listRecordTypes(offered)}</h2>
        <p className="module-section-description">
          This control layer turns each project into an active operating workspace instead of a passive record.
        </p>
      </div>

      <Tabs defaultValue={offered[0]} className="mt-5">
        {/*
          The FILLED variant, not the underlined `module-tabs-list` the rest of
          this page uses. The project page's own tab strip is directly above
          this one, and when both wore the same visual language the page showed
          two identical strips stacked — a reader could not tell which one they
          were about to move. Form-picker and page-section are different kinds
          of control and now look like it.
        */}
        <TabsList variant="default" className="flex-wrap" data-testid="project-record-composer-types">
          {offered.map((type) => {
            const { label, Icon } = RECORD_TYPE_META[type];
            return (
              <TabsTrigger key={type} value={type}>
                <Icon className="h-4 w-4" />
                {label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {shows("milestone") ? (
        <TabsContent value="milestone" className="pt-4">
          <form className="space-y-4" onSubmit={handleMilestoneSubmit}>
            <div className="space-y-2">
              <label htmlFor="milestone-title" className="text-sm font-medium">
                Milestone title
              </label>
              <Input
                id="milestone-title"
                value={milestoneTitle}
                onChange={(e) => setMilestoneTitle(e.target.value)}
                placeholder="LAPM authorization checklist packet ready"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="milestone-summary" className="text-sm font-medium">
                Summary
              </label>
              <Textarea
                id="milestone-summary"
                value={milestoneSummary}
                onChange={(e) => setMilestoneSummary(e.target.value)}
                rows={4}
                placeholder="What phase gate or operator checkpoint does this milestone represent?"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="milestone-type" className="text-sm font-medium">
                  Milestone type
                </label>
                <select id="milestone-type" className="module-select" value={milestoneType} onChange={(e) => setMilestoneType(e.target.value)}>
                  <option value="authorization">Authorization</option>
                  <option value="agreement">Agreement</option>
                  <option value="schedule">Schedule</option>
                  <option value="hearing">Hearing</option>
                  <option value="invoice">Invoice</option>
                  <option value="deliverable">Deliverable</option>
                  <option value="decision">Decision</option>
                  <option value="permit">Permit</option>
                  <option value="closeout">Closeout</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="milestone-phase" className="text-sm font-medium">
                  Phase code
                </label>
                <select id="milestone-phase" className="module-select" value={milestonePhaseCode} onChange={(e) => setMilestonePhaseCode(e.target.value)}>
                  <option value="initiation">Initiation</option>
                  <option value="procurement">Procurement</option>
                  <option value="environmental">Environmental</option>
                  <option value="outreach">Outreach</option>
                  <option value="programming">Programming</option>
                  <option value="ps_e">PS&E</option>
                  <option value="row_utilities">ROW / Utilities</option>
                  <option value="advertise_award">Advertise / Award</option>
                  <option value="construction">Construction</option>
                  <option value="closeout">Closeout</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="milestone-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="milestone-status" className="module-select" value={milestoneStatus} onChange={(e) => setMilestoneStatus(e.target.value)}>
                  <option value="not_started">Not started</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="complete">Complete</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <label htmlFor="milestone-owner" className="text-sm font-medium">
                  Owner
                </label>
                <Input id="milestone-owner" value={milestoneOwner} onChange={(e) => setMilestoneOwner(e.target.value)} placeholder="Elena / Owen / Consultant" />
                <p className="text-xs text-muted-foreground">Free text — a consultant, a partner agency, anyone without an account here.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="milestone-assignee" className="text-sm font-medium">
                  Assignee
                </label>
                <AssigneePicker
                  id="milestone-assignee"
                  label="Assignee"
                  workspaceId={workspaceId}
                  value={milestoneAssignee}
                  onChange={setMilestoneAssignee}
                />
                <p className="text-xs text-muted-foreground">A teammate in this workspace. Optional, and separate from Owner.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="milestone-target-date" className="text-sm font-medium">
                  Target date
                </label>
                <Input id="milestone-target-date" type="date" value={milestoneTargetDate} onChange={(e) => setMilestoneTargetDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="milestone-actual-date" className="text-sm font-medium">
                  Actual date
                </label>
                <Input id="milestone-actual-date" type="date" value={milestoneActualDate} onChange={(e) => setMilestoneActualDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="milestone-notes" className="text-sm font-medium">
                Notes
              </label>
              <Textarea
                id="milestone-notes"
                value={milestoneNotes}
                onChange={(e) => setMilestoneNotes(e.target.value)}
                rows={4}
                placeholder="Capture control-room context, dependency notes, or why this milestone is blocked."
              />
            </div>
            <FormError error={milestoneError} />
            <Button type="submit" disabled={milestoneSaving}>
              {milestoneSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving milestone…
                </>
              ) : (
                "Add milestone"
              )}
            </Button>
          </form>
        </TabsContent>
        ) : null}

        {shows("submittal") ? (
        <TabsContent value="submittal" className="pt-4">
          <form className="space-y-4" onSubmit={handleSubmittalSubmit}>
            <div className="space-y-2">
              <label htmlFor="submittal-title" className="text-sm font-medium">
                Submittal title
              </label>
              <Input
                id="submittal-title"
                value={submittalTitle}
                onChange={(e) => setSubmittalTitle(e.target.value)}
                placeholder="Invoice backup packet"
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="submittal-type" className="text-sm font-medium">
                  Submittal type
                </label>
                <select id="submittal-type" className="module-select" value={submittalType} onChange={(e) => setSubmittalType(e.target.value)}>
                  <option value="authorization_packet">Authorization packet</option>
                  <option value="invoice_backup">Invoice backup</option>
                  <option value="environmental_package">Environmental package</option>
                  <option value="hearing_record">Hearing record</option>
                  <option value="ps_e">PS&amp;E</option>
                  <option value="reimbursement">Reimbursement</option>
                  <option value="progress_report">Progress report</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="submittal-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="submittal-status" className="module-select" value={submittalStatus} onChange={(e) => setSubmittalStatus(e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="internal_review">Internal review</option>
                  <option value="submitted">Submitted</option>
                  <option value="accepted">Accepted</option>
                  <option value="revise_and_resubmit">Revise and resubmit</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="submittal-review-cycle" className="text-sm font-medium">
                  Review cycle
                </label>
                <Input id="submittal-review-cycle" type="number" min="1" max="10" value={submittalReviewCycle} onChange={(e) => setSubmittalReviewCycle(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="submittal-agency" className="text-sm font-medium">
                  Agency / reviewer
                </label>
                <Input id="submittal-agency" value={submittalAgency} onChange={(e) => setSubmittalAgency(e.target.value)} placeholder="Caltrans D3 Local Assistance" />
                <p className="text-xs text-muted-foreground">Who reviews the packet — a different question from who prepares it.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="submittal-assignee" className="text-sm font-medium">
                  Assignee
                </label>
                <AssigneePicker
                  id="submittal-assignee"
                  label="Assignee"
                  workspaceId={workspaceId}
                  value={submittalAssignee}
                  onChange={setSubmittalAssignee}
                />
                <p className="text-xs text-muted-foreground">The teammate who owes this packet. Optional.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="submittal-reference-number" className="text-sm font-medium">
                  Reference number
                </label>
                <Input id="submittal-reference-number" value={submittalReferenceNumber} onChange={(e) => setSubmittalReferenceNumber(e.target.value)} placeholder="INV-7 / EX-10-A" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="submittal-due-date" className="text-sm font-medium">
                  Due date
                </label>
                <Input id="submittal-due-date" type="date" value={submittalDueDate} onChange={(e) => setSubmittalDueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="submittal-submitted-at" className="text-sm font-medium">
                  Submitted at
                </label>
                <Input id="submittal-submitted-at" type="datetime-local" value={submittalSubmittedAt} onChange={(e) => setSubmittalSubmittedAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="submittal-notes" className="text-sm font-medium">
                Notes
              </label>
              <Textarea
                id="submittal-notes"
                value={submittalNotes}
                onChange={(e) => setSubmittalNotes(e.target.value)}
                rows={4}
                placeholder="Capture resubmittal comments, backup requirements, or review conditions."
              />
            </div>
            <FormError error={submittalError} />
            <Button type="submit" disabled={submittalSaving}>
              {submittalSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving submittal…
                </>
              ) : (
                "Add submittal"
              )}
            </Button>
          </form>
        </TabsContent>
        ) : null}

        {shows("deliverable") ? (
        <TabsContent value="deliverable" className="pt-4">
          <form className="space-y-4" onSubmit={handleDeliverableSubmit}>
            <div className="space-y-2">
              <label htmlFor="deliverable-title" className="text-sm font-medium">
                Deliverable title
              </label>
              <Input
                id="deliverable-title"
                value={deliverableTitle}
                onChange={(e) => setDeliverableTitle(e.target.value)}
                placeholder="Draft board-ready safety memo"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="deliverable-summary" className="text-sm font-medium">
                Summary
              </label>
              <Textarea
                id="deliverable-summary"
                value={deliverableSummary}
                onChange={(e) => setDeliverableSummary(e.target.value)}
                rows={4}
                placeholder="What needs to be delivered, for whom, and at what quality bar?"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <label htmlFor="deliverable-owner" className="text-sm font-medium">
                  Owner
                </label>
                <Input
                  id="deliverable-owner"
                  value={deliverableOwner}
                  onChange={(e) => setDeliverableOwner(e.target.value)}
                  placeholder="Elena / Owen / Consultant"
                />
                <p className="text-xs text-muted-foreground">Free text — a consultant, a partner agency, anyone without an account here.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="deliverable-assignee" className="text-sm font-medium">
                  Assignee
                </label>
                <AssigneePicker
                  id="deliverable-assignee"
                  label="Assignee"
                  workspaceId={workspaceId}
                  value={deliverableAssignee}
                  onChange={setDeliverableAssignee}
                />
                <p className="text-xs text-muted-foreground">A teammate in this workspace. Optional, and separate from Owner.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="deliverable-due" className="text-sm font-medium">
                  Due date
                </label>
                <Input id="deliverable-due" type="date" value={deliverableDueDate} onChange={(e) => setDeliverableDueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="deliverable-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="deliverable-status" className="module-select" value={deliverableStatus} onChange={(e) => setDeliverableStatus(e.target.value)}>
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="complete">Complete</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="deliverable-budget" className="text-sm font-medium">
                  Budget (not to exceed)
                </label>
                <Input
                  id="deliverable-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={deliverableBudget}
                  onChange={(e) => setDeliverableBudget(e.target.value)}
                  placeholder="Optional — leave blank if not budgeted"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="deliverable-percent-complete" className="text-sm font-medium">
                  Percent complete
                </label>
                <Input
                  id="deliverable-percent-complete"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={deliverablePercentComplete}
                  onChange={(e) => setDeliverablePercentComplete(e.target.value)}
                  placeholder="Optional — 0 to 100"
                />
              </div>
            </div>
            <FormError error={deliverableError} />
            <Button type="submit" disabled={deliverableSaving}>
              {deliverableSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving deliverable…
                </>
              ) : (
                "Add deliverable"
              )}
            </Button>
          </form>
        </TabsContent>
        ) : null}

        {shows("risk") ? (
        <TabsContent value="risk" className="pt-4">
          <form className="space-y-4" onSubmit={handleRiskSubmit}>
            <div className="space-y-2">
              <label htmlFor="risk-title" className="text-sm font-medium">
                Risk title
              </label>
              <Input id="risk-title" value={riskTitle} onChange={(e) => setRiskTitle(e.target.value)} placeholder="Schedule compression may weaken review quality" required />
            </div>
            <div className="space-y-2">
              <label htmlFor="risk-description" className="text-sm font-medium">
                Description
              </label>
              <Textarea id="risk-description" value={riskDescription} onChange={(e) => setRiskDescription(e.target.value)} rows={4} placeholder="Describe the risk and what could go wrong if it is ignored." />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="risk-severity" className="text-sm font-medium">
                  Severity
                </label>
                <select id="risk-severity" className="module-select" value={riskSeverity} onChange={(e) => setRiskSeverity(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="risk-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="risk-status" className="module-select" value={riskStatus} onChange={(e) => setRiskStatus(e.target.value)}>
                  <option value="open">Open</option>
                  <option value="watch">Watch</option>
                  <option value="mitigated">Mitigated</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="risk-mitigation" className="text-sm font-medium">
                Mitigation
              </label>
              <Textarea id="risk-mitigation" value={riskMitigation} onChange={(e) => setRiskMitigation(e.target.value)} rows={4} placeholder="What is the mitigation path, owner, or contingency?" />
            </div>
            <FormError error={riskError} />
            <Button type="submit" disabled={riskSaving}>
              {riskSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving risk…
                </>
              ) : (
                "Add risk"
              )}
            </Button>
          </form>
        </TabsContent>
        ) : null}

        {shows("issue") ? (
        <TabsContent value="issue" className="pt-4">
          <form className="space-y-4" onSubmit={handleIssueSubmit}>
            <div className="space-y-2">
              <label htmlFor="issue-title" className="text-sm font-medium">
                Issue title
              </label>
              <Input id="issue-title" value={issueTitle} onChange={(e) => setIssueTitle(e.target.value)} placeholder="Traffic count package still missing" required />
            </div>
            <div className="space-y-2">
              <label htmlFor="issue-description" className="text-sm font-medium">
                Description
              </label>
              <Textarea id="issue-description" value={issueDescription} onChange={(e) => setIssueDescription(e.target.value)} rows={4} placeholder="Describe the active blocker or operational problem." />
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <label htmlFor="issue-severity" className="text-sm font-medium">
                  Severity
                </label>
                <select id="issue-severity" className="module-select" value={issueSeverity} onChange={(e) => setIssueSeverity(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="issue-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="issue-status" className="module-select" value={issueStatus} onChange={(e) => setIssueStatus(e.target.value)}>
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="issue-owner" className="text-sm font-medium">
                  Owner
                </label>
                <Input id="issue-owner" value={issueOwner} onChange={(e) => setIssueOwner(e.target.value)} placeholder="Priya / Consultant" />
                <p className="text-xs text-muted-foreground">Free text — anyone without an account here.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="issue-assignee" className="text-sm font-medium">
                  Assignee
                </label>
                <AssigneePicker
                  id="issue-assignee"
                  label="Assignee"
                  workspaceId={workspaceId}
                  value={issueAssignee}
                  onChange={setIssueAssignee}
                />
                <p className="text-xs text-muted-foreground">A teammate in this workspace. Optional, and separate from Owner.</p>
              </div>
            </div>
            <FormError error={issueError} />
            <Button type="submit" disabled={issueSaving}>
              {issueSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving issue…
                </>
              ) : (
                "Add issue"
              )}
            </Button>
          </form>
        </TabsContent>
        ) : null}

        {shows("decision") ? (
        <TabsContent value="decision" className="pt-4">
          <form className="space-y-4" onSubmit={handleDecisionSubmit}>
            <div className="space-y-2">
              <label htmlFor="decision-title" className="text-sm font-medium">
                Decision title
              </label>
              <Input id="decision-title" value={decisionTitle} onChange={(e) => setDecisionTitle(e.target.value)} placeholder="Use VMT-first narrative for public packet" required />
            </div>
            <div className="space-y-2">
              <label htmlFor="decision-rationale" className="text-sm font-medium">
                Rationale
              </label>
              <Textarea id="decision-rationale" value={decisionRationale} onChange={(e) => setDecisionRationale(e.target.value)} rows={4} placeholder="Why was this decision made, on what basis, and with what tradeoffs?" required />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="decision-status" className="text-sm font-medium">
                  Decision state
                </label>
                <select id="decision-status" className="module-select" value={decisionStatus} onChange={(e) => setDecisionStatus(e.target.value)}>
                  <option value="proposed">Proposed</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="decision-date" className="text-sm font-medium">
                  Decision date
                </label>
                <Input id="decision-date" type="datetime-local" value={decisionAt} onChange={(e) => setDecisionAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="decision-impact" className="text-sm font-medium">
                Impact summary
              </label>
              <Textarea id="decision-impact" value={decisionImpact} onChange={(e) => setDecisionImpact(e.target.value)} rows={4} placeholder="What downstream scope, quality, schedule, or policy effects does this decision create?" />
            </div>
            <FormError error={decisionError} />
            <Button type="submit" disabled={decisionSaving}>
              {decisionSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving decision…
                </>
              ) : (
                "Add decision"
              )}
            </Button>
          </form>
        </TabsContent>
        ) : null}

        {shows("meeting") ? (
        <TabsContent value="meeting" className="pt-4">
          <form className="space-y-4" onSubmit={handleMeetingSubmit}>
            <div className="space-y-2">
              <label htmlFor="meeting-title" className="text-sm font-medium">
                Meeting title
              </label>
              <Input id="meeting-title" value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} placeholder="Weekly project sync" required />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="meeting-at" className="text-sm font-medium">
                  Meeting time
                </label>
                <Input id="meeting-at" type="datetime-local" value={meetingAt} onChange={(e) => setMeetingAt(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="meeting-attendees" className="text-sm font-medium">
                  Attendees
                </label>
                <Input id="meeting-attendees" value={meetingAttendees} onChange={(e) => setMeetingAttendees(e.target.value)} placeholder="Nathaniel, Elena, Owen" />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="meeting-notes" className="text-sm font-medium">
                Notes
              </label>
              <Textarea id="meeting-notes" value={meetingNotes} onChange={(e) => setMeetingNotes(e.target.value)} rows={5} placeholder="Key points, action items, and open questions." />
            </div>
            <FormError error={meetingError} />
            <Button type="submit" disabled={meetingSaving}>
              {meetingSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving meeting…
                </>
              ) : (
                "Add meeting"
              )}
            </Button>
          </form>
        </TabsContent>
        ) : null}
      </Tabs>
    </article>
  );
}
