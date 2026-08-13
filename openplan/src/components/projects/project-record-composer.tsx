"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Flag,
  MessagesSquare,
  Scale,
  Siren,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
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
 * ("add milestones"), singular on the button because a button opens one form.
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

const selectClassName = "module-select";

/**
 * A teammate picker that carries the flow's own DOM id for the field.
 *
 * The id arrives by SPREADING `flow.fieldProps("…")` at the call site rather
 * than by passing the field's name in: the guard reads the field name as a
 * string literal beside `fieldProps`, and a helper that took the name and
 * called `fieldProps` inside would hide four fields from it.
 *
 * Defined at module scope, not inside the composer: a component declared inside
 * another component is a NEW type on every render, so React tears the picker
 * down and rebuilds it each keystroke — which lost the chosen teammate before
 * it ever reached the request.
 */
function AssigneeRow({
  id,
  workspaceId: pickerWorkspaceId,
  value,
  onChange,
}: {
  id: string;
  workspaceId: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <AssigneePicker
        id={id}
        label="Assign it to someone"
        workspaceId={pickerWorkspaceId}
        value={value}
        onChange={onChange}
      />
      <p className="text-[0.78rem] text-muted-foreground">
        Someone on your team in this workspace. Optional, and separate from the owner name above.
      </p>
    </div>
  );
}


/**
 * Seven full forms used to be painted on the project page at all times, one per
 * tab, whether or not anybody was adding a record — the single largest block of
 * permanently-visible form in the app, sitting on top of the lists a planner
 * came to read. Now the page carries seven buttons, and each opens the same
 * questions a few at a time.
 *
 * WHAT DID NOT CHANGE. Every field, every option, the same one POST to
 * `/api/projects/[projectId]/records` with byte-identical bodies — including
 * the three date conversions (`new Date(x).toISOString()` for the two
 * datetime-local fields and the submittal's submitted-at), the review cycle's
 * `parseInt(…) || 1`, and the deliverable's two `parseFloat`-or-`undefined`
 * numbers. Blank still means "not answered", not zero.
 *
 * WHAT DID CHANGE, ON PURPOSE. The four titles that carried the browser's
 * `required` attribute are now declared required in the flow's step data. A
 * `required` attribute is not validation in a stepped form — it fires only
 * while its control is on screen — and the flow checks every step's answers at
 * submit whatever is mounted.
 */
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

  const submitRecord = React.useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await fetch(`/api/projects/${projectId}/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as { error?: string; details?: string };

      if (!response.ok) {
        throw new Error(data.details || data.error || "Failed to save record");
      }

      // The flow closes when this resolves, so the refresh happens while the
      // sheet is still up and the planner is handed back to a list that already
      // contains what they just added.
      router.refresh();
    },
    [projectId, router]
  );

  // ───────────────────────────────────────────────────────── milestone
  type MilestoneValues = {
    milestoneTitle: string;
    milestoneSummary: string;
    milestoneType: string;
    milestonePhaseCode: string;
    milestoneStatus: string;
    milestoneOwner: string;
    milestoneAssignee: string | null;
    milestoneTargetDate: string;
    milestoneActualDate: string;
    milestoneNotes: string;
  };
  const milestoneSteps: GuidedFlowStep<MilestoneValues>[] = [
    {
      id: "what",
      title: "What has to happen?",
      hint: "A milestone is a date the project has to hit — an approval, a hearing, a hand-off.",
      fields: [
        {
          name: "milestoneTitle",
          label: "a name",
          required: true,
          requiredMessage: "Name the milestone before you add it.",
        },
        { name: "milestoneSummary", label: "a description" },
        { name: "milestoneType", label: "a kind" },
        { name: "milestonePhaseCode", label: "a phase" },
      ],
      render: (flow) => (
        <>
          <GuidedFlowRow flow={flow} name="milestoneTitle" label="Name">
            <Input {...flow.text("milestoneTitle")} placeholder="LAPM authorization checklist packet ready" />
          </GuidedFlowRow>
          <GuidedFlowRow flow={flow} name="milestoneSummary" label="What is it, in a sentence?">
            <Textarea
              {...flow.text("milestoneSummary")}
              rows={3}
              placeholder="What phase gate or checkpoint does this milestone represent?"
            />
          </GuidedFlowRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="milestoneType" label="Kind of milestone">
              <select className={selectClassName} {...flow.text("milestoneType")}>
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
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="milestonePhaseCode" label="Which phase of the project?">
              <select className={selectClassName} {...flow.text("milestonePhaseCode")}>
                <option value="initiation">Initiation</option>
                <option value="procurement">Procurement</option>
                <option value="environmental">Environmental</option>
                <option value="outreach">Outreach</option>
                <option value="programming">Programming</option>
                <option value="ps_e">PS&amp;E</option>
                <option value="row_utilities">ROW / Utilities</option>
                <option value="advertise_award">Advertise / Award</option>
                <option value="construction">Construction</option>
                <option value="closeout">Closeout</option>
                <option value="other">Other</option>
              </select>
            </GuidedFlowRow>
          </div>
        </>
      ),
    },
    {
      id: "who-and-when",
      title: "Who owns it, and when is it due?",
      hint: "All optional — you can fill these in later.",
      fields: [
        { name: "milestoneStatus", label: "a status" },
        { name: "milestoneOwner", label: "an owner" },
        { name: "milestoneAssignee", label: "a teammate" },
        { name: "milestoneTargetDate", label: "a target date" },
        { name: "milestoneActualDate", label: "the date it happened" },
        { name: "milestoneNotes", label: "notes" },
      ],
      render: (flow) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="milestoneStatus" label="Where does it stand?">
              <select className={selectClassName} {...flow.text("milestoneStatus")}>
                <option value="not_started">Not started</option>
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="complete">Complete</option>
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="milestoneOwner" label="Owner">
              <Input {...flow.text("milestoneOwner")} placeholder="Elena / Owen / Consultant" />
            </GuidedFlowRow>
          </div>
          <AssigneeRow
            {...flow.fieldProps("milestoneAssignee")}
            workspaceId={workspaceId}
            value={flow.values.milestoneAssignee}
            onChange={(next) => flow.setValue("milestoneAssignee", next)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="milestoneTargetDate" label="Target date">
              <Input type="date" {...flow.text("milestoneTargetDate")} />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="milestoneActualDate" label="Date it actually happened">
              <Input type="date" {...flow.text("milestoneActualDate")} />
            </GuidedFlowRow>
          </div>
          <GuidedFlowRow flow={flow} name="milestoneNotes" label="Notes">
            <Textarea
              {...flow.text("milestoneNotes")}
              rows={4}
              placeholder="Context, dependencies, or why this milestone is blocked."
            />
          </GuidedFlowRow>
        </>
      ),
    },
  ];
  const milestoneFlow = useGuidedFlow<MilestoneValues>({
    id: "project-record-milestone",
    title: "Add a milestone",
    submitLabel: "Add the milestone",
    initialValues: {
      milestoneTitle: "",
      milestoneSummary: "",
      milestoneType: "authorization",
      milestonePhaseCode: "initiation",
      milestoneStatus: "scheduled",
      milestoneOwner: "",
      milestoneAssignee: null,
      milestoneTargetDate: "",
      milestoneActualDate: "",
      milestoneNotes: "",
    },
    steps: milestoneSteps,
    onSubmit: (values) =>
      submitRecord({
        recordType: "milestone",
        title: values.milestoneTitle,
        summary: values.milestoneSummary,
        milestoneType: values.milestoneType,
        phaseCode: values.milestonePhaseCode,
        status: values.milestoneStatus,
        ownerLabel: values.milestoneOwner,
        assigneeUserId: values.milestoneAssignee ?? undefined,
        targetDate: values.milestoneTargetDate,
        actualDate: values.milestoneActualDate,
        notes: values.milestoneNotes,
      }),
  });

  // ───────────────────────────────────────────────────────── submittal
  type SubmittalValues = {
    submittalTitle: string;
    submittalType: string;
    submittalStatus: string;
    submittalReviewCycle: string;
    submittalAgency: string;
    submittalAssignee: string | null;
    submittalReferenceNumber: string;
    submittalDueDate: string;
    submittalSubmittedAt: string;
    submittalNotes: string;
  };
  const submittalSteps: GuidedFlowStep<SubmittalValues>[] = [
    {
      id: "what",
      title: "What are you sending, and to whom?",
      hint: "A submittal is a package that goes out for someone else to review.",
      fields: [
        {
          name: "submittalTitle",
          label: "a name",
          required: true,
          requiredMessage: "Name the submittal before you add it.",
        },
        { name: "submittalType", label: "a kind" },
        { name: "submittalAgency", label: "the reviewing agency" },
        { name: "submittalReferenceNumber", label: "a reference number" },
      ],
      render: (flow) => (
        <>
          <GuidedFlowRow flow={flow} name="submittalTitle" label="Name">
            <Input {...flow.text("submittalTitle")} placeholder="Invoice backup packet" />
          </GuidedFlowRow>
          <GuidedFlowRow flow={flow} name="submittalType" label="Kind of package">
            <select className={selectClassName} {...flow.text("submittalType")}>
              <option value="authorization_packet">Authorization packet</option>
              <option value="invoice_backup">Invoice backup</option>
              <option value="environmental_package">Environmental package</option>
              <option value="hearing_record">Hearing record</option>
              <option value="ps_e">PS&amp;E</option>
              <option value="reimbursement">Reimbursement</option>
              <option value="progress_report">Progress report</option>
              <option value="other">Other</option>
            </select>
          </GuidedFlowRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="submittalAgency" label="Who reviews it?">
              <Input {...flow.text("submittalAgency")} placeholder="Caltrans D3 Local Assistance" />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="submittalReferenceNumber" label="Their reference number">
              <Input {...flow.text("submittalReferenceNumber")} placeholder="INV-7 / EX-10-A" />
            </GuidedFlowRow>
          </div>
        </>
      ),
    },
    {
      id: "where",
      title: "Where is it up to?",
      hint: "All optional. Review cycle 1 means this is the first time it has gone out.",
      fields: [
        { name: "submittalStatus", label: "a status" },
        { name: "submittalReviewCycle", label: "a review cycle" },
        { name: "submittalAssignee", label: "a teammate" },
        { name: "submittalDueDate", label: "a due date" },
        { name: "submittalSubmittedAt", label: "the date it went out" },
        { name: "submittalNotes", label: "notes" },
      ],
      render: (flow) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="submittalStatus" label="Where does it stand?">
              <select className={selectClassName} {...flow.text("submittalStatus")}>
                <option value="draft">Draft</option>
                <option value="internal_review">Internal review</option>
                <option value="submitted">Submitted</option>
                <option value="accepted">Accepted</option>
                <option value="revise_and_resubmit">Revise and resubmit</option>
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="submittalReviewCycle"
              label="Which round of review?"
              hint="1 the first time it goes out, 2 after the first round of comments, and so on."
            >
              <Input type="number" min="1" max="10" {...flow.text("submittalReviewCycle")} />
            </GuidedFlowRow>
          </div>
          <AssigneeRow
            {...flow.fieldProps("submittalAssignee")}
            workspaceId={workspaceId}
            value={flow.values.submittalAssignee}
            onChange={(next) => flow.setValue("submittalAssignee", next)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="submittalDueDate" label="Due date">
              <Input type="date" {...flow.text("submittalDueDate")} />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="submittalSubmittedAt" label="When it was sent">
              <Input type="datetime-local" {...flow.text("submittalSubmittedAt")} />
            </GuidedFlowRow>
          </div>
          <GuidedFlowRow flow={flow} name="submittalNotes" label="Notes">
            <Textarea
              {...flow.text("submittalNotes")}
              rows={4}
              placeholder="Resubmittal comments, backup requirements, or review conditions."
            />
          </GuidedFlowRow>
        </>
      ),
    },
  ];
  const submittalFlow = useGuidedFlow<SubmittalValues>({
    id: "project-record-submittal",
    title: "Add a submittal",
    submitLabel: "Add the submittal",
    initialValues: {
      submittalTitle: "",
      submittalType: "authorization_packet",
      submittalStatus: "draft",
      submittalReviewCycle: "1",
      submittalAgency: "",
      submittalAssignee: null,
      submittalReferenceNumber: "",
      submittalDueDate: "",
      submittalSubmittedAt: "",
      submittalNotes: "",
    },
    steps: submittalSteps,
    onSubmit: (values) =>
      submitRecord({
        recordType: "submittal",
        title: values.submittalTitle,
        submittalType: values.submittalType,
        status: values.submittalStatus,
        agencyLabel: values.submittalAgency,
        assigneeUserId: values.submittalAssignee ?? undefined,
        referenceNumber: values.submittalReferenceNumber,
        dueDate: values.submittalDueDate,
        submittedAt: values.submittalSubmittedAt
          ? new Date(values.submittalSubmittedAt).toISOString()
          : undefined,
        reviewCycle: Number.parseInt(values.submittalReviewCycle, 10) || 1,
        notes: values.submittalNotes,
      }),
  });

  // ─────────────────────────────────────────────────────── deliverable
  type DeliverableValues = {
    deliverableTitle: string;
    deliverableSummary: string;
    deliverableOwner: string;
    deliverableAssignee: string | null;
    deliverableDueDate: string;
    deliverableStatus: string;
    deliverableBudget: string;
    deliverablePercentComplete: string;
  };
  const deliverableSteps: GuidedFlowStep<DeliverableValues>[] = [
    {
      id: "what",
      title: "What are you producing?",
      hint: "A deliverable is something the project owes somebody — a memo, a drawing set, a dataset.",
      fields: [
        {
          name: "deliverableTitle",
          label: "a name",
          required: true,
          requiredMessage: "Name the deliverable before you add it.",
        },
        { name: "deliverableSummary", label: "a description" },
      ],
      render: (flow) => (
        <>
          <GuidedFlowRow flow={flow} name="deliverableTitle" label="Name">
            <Input {...flow.text("deliverableTitle")} placeholder="Draft board-ready safety memo" />
          </GuidedFlowRow>
          <GuidedFlowRow flow={flow} name="deliverableSummary" label="What is it, in a sentence?">
            <Textarea
              {...flow.text("deliverableSummary")}
              rows={3}
              placeholder="What has to be delivered, for whom, and to what standard?"
            />
          </GuidedFlowRow>
        </>
      ),
    },
    {
      id: "who-and-when",
      title: "Who is doing it, and by when?",
      hint: "All optional. Leave the money and percentage blank if you are not tracking them.",
      fields: [
        { name: "deliverableOwner", label: "an owner" },
        { name: "deliverableAssignee", label: "a teammate" },
        { name: "deliverableDueDate", label: "a due date" },
        { name: "deliverableStatus", label: "a status" },
        { name: "deliverableBudget", label: "a budget" },
        { name: "deliverablePercentComplete", label: "a percentage" },
      ],
      render: (flow) => (
        <>
          <GuidedFlowRow flow={flow} name="deliverableOwner" label="Owner">
            <Input {...flow.text("deliverableOwner")} placeholder="Elena / Owen / Consultant" />
          </GuidedFlowRow>
          <AssigneeRow
            {...flow.fieldProps("deliverableAssignee")}
            workspaceId={workspaceId}
            value={flow.values.deliverableAssignee}
            onChange={(next) => flow.setValue("deliverableAssignee", next)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="deliverableDueDate" label="Due date">
              <Input type="date" {...flow.text("deliverableDueDate")} />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="deliverableStatus" label="Where does it stand?">
              <select className={selectClassName} {...flow.text("deliverableStatus")}>
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="complete">Complete</option>
              </select>
            </GuidedFlowRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow
              flow={flow}
              name="deliverableBudget"
              label="Budget"
              hint="Leave blank if this deliverable is not budgeted separately. Blank means unknown, not zero."
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                {...flow.text("deliverableBudget")}
                placeholder="Optional — leave blank if not budgeted"
              />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="deliverablePercentComplete" label="How far along is it?">
              <Input
                type="number"
                min="0"
                max="100"
                step="1"
                {...flow.text("deliverablePercentComplete")}
                placeholder="Optional — 0 to 100"
              />
            </GuidedFlowRow>
          </div>
        </>
      ),
    },
  ];
  const deliverableFlow = useGuidedFlow<DeliverableValues>({
    id: "project-record-deliverable",
    title: "Add a deliverable",
    submitLabel: "Add the deliverable",
    initialValues: {
      deliverableTitle: "",
      deliverableSummary: "",
      deliverableOwner: "",
      deliverableAssignee: null,
      deliverableDueDate: "",
      deliverableStatus: "not_started",
      deliverableBudget: "",
      deliverablePercentComplete: "",
    },
    steps: deliverableSteps,
    onSubmit: (values) =>
      submitRecord({
        recordType: "deliverable",
        title: values.deliverableTitle,
        summary: values.deliverableSummary,
        ownerLabel: values.deliverableOwner,
        assigneeUserId: values.deliverableAssignee ?? undefined,
        dueDate: values.deliverableDueDate,
        status: values.deliverableStatus,
        budgetAmount: values.deliverableBudget.trim()
          ? Number.parseFloat(values.deliverableBudget)
          : undefined,
        percentComplete: values.deliverablePercentComplete.trim()
          ? Number.parseFloat(values.deliverablePercentComplete)
          : undefined,
      }),
  });

  // ───────────────────────────────────────────────────────────── risk
  type RiskValues = {
    riskTitle: string;
    riskDescription: string;
    riskSeverity: string;
    riskStatus: string;
    riskMitigation: string;
  };
  const riskSteps: GuidedFlowStep<RiskValues>[] = [
    {
      id: "what",
      title: "What could go wrong?",
      hint: "A risk has not happened yet. If it already has, log it as an issue instead.",
      fields: [
        {
          name: "riskTitle",
          label: "a name",
          required: true,
          requiredMessage: "Say what the risk is before you add it.",
        },
        { name: "riskDescription", label: "a description" },
      ],
      render: (flow) => (
        <>
          <GuidedFlowRow flow={flow} name="riskTitle" label="The risk, in a line">
            <Input
              {...flow.text("riskTitle")}
              placeholder="Schedule compression may weaken review quality"
            />
          </GuidedFlowRow>
          <GuidedFlowRow flow={flow} name="riskDescription" label="What would happen?">
            <Textarea
              {...flow.text("riskDescription")}
              rows={4}
              placeholder="Describe the risk and what could go wrong if it is ignored."
            />
          </GuidedFlowRow>
        </>
      ),
    },
    {
      id: "how-bad",
      title: "How bad would it be, and what is the plan?",
      fields: [
        { name: "riskSeverity", label: "a severity" },
        { name: "riskStatus", label: "a status" },
        { name: "riskMitigation", label: "a mitigation" },
      ],
      render: (flow) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="riskSeverity" label="How serious?">
              <select className={selectClassName} {...flow.text("riskSeverity")}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="riskStatus" label="Where does it stand?">
              <select className={selectClassName} {...flow.text("riskStatus")}>
                <option value="open">Open</option>
                <option value="watch">Watch</option>
                <option value="mitigated">Mitigated</option>
                <option value="closed">Closed</option>
              </select>
            </GuidedFlowRow>
          </div>
          <GuidedFlowRow flow={flow} name="riskMitigation" label="What would you do about it?">
            <Textarea
              {...flow.text("riskMitigation")}
              rows={4}
              placeholder="What is the mitigation path, owner, or fallback?"
            />
          </GuidedFlowRow>
        </>
      ),
    },
  ];
  const riskFlow = useGuidedFlow<RiskValues>({
    id: "project-record-risk",
    title: "Log a risk",
    submitLabel: "Log the risk",
    initialValues: {
      riskTitle: "",
      riskDescription: "",
      riskSeverity: "medium",
      riskStatus: "open",
      riskMitigation: "",
    },
    steps: riskSteps,
    onSubmit: (values) =>
      submitRecord({
        recordType: "risk",
        title: values.riskTitle,
        description: values.riskDescription,
        severity: values.riskSeverity,
        status: values.riskStatus,
        mitigation: values.riskMitigation,
      }),
  });

  // ──────────────────────────────────────────────────────────── issue
  type IssueValues = {
    issueTitle: string;
    issueDescription: string;
    issueSeverity: string;
    issueStatus: string;
    issueOwner: string;
    issueAssignee: string | null;
  };
  const issueSteps: GuidedFlowStep<IssueValues>[] = [
    {
      id: "what",
      title: "What is blocking the work?",
      hint: "An issue is happening now. Something that might happen later is a risk.",
      fields: [
        {
          name: "issueTitle",
          label: "a name",
          required: true,
          requiredMessage: "Say what the problem is before you add it.",
        },
        { name: "issueDescription", label: "a description" },
      ],
      render: (flow) => (
        <>
          <GuidedFlowRow flow={flow} name="issueTitle" label="The problem, in a line">
            <Input {...flow.text("issueTitle")} placeholder="Traffic count package still missing" />
          </GuidedFlowRow>
          <GuidedFlowRow flow={flow} name="issueDescription" label="What is going on?">
            <Textarea
              {...flow.text("issueDescription")}
              rows={4}
              placeholder="Describe the blocker and what it is holding up."
            />
          </GuidedFlowRow>
        </>
      ),
    },
    {
      id: "who",
      title: "How urgent is it, and who is on it?",
      fields: [
        { name: "issueSeverity", label: "a severity" },
        { name: "issueStatus", label: "a status" },
        { name: "issueOwner", label: "an owner" },
        { name: "issueAssignee", label: "a teammate" },
      ],
      render: (flow) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="issueSeverity" label="How serious?">
              <select className={selectClassName} {...flow.text("issueSeverity")}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="issueStatus" label="Where does it stand?">
              <select className={selectClassName} {...flow.text("issueStatus")}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="resolved">Resolved</option>
              </select>
            </GuidedFlowRow>
          </div>
          <GuidedFlowRow flow={flow} name="issueOwner" label="Owner">
            <Input {...flow.text("issueOwner")} placeholder="Priya / Consultant" />
          </GuidedFlowRow>
          <AssigneeRow
            {...flow.fieldProps("issueAssignee")}
            workspaceId={workspaceId}
            value={flow.values.issueAssignee}
            onChange={(next) => flow.setValue("issueAssignee", next)}
          />
        </>
      ),
    },
  ];
  const issueFlow = useGuidedFlow<IssueValues>({
    id: "project-record-issue",
    title: "Log an issue",
    submitLabel: "Log the issue",
    initialValues: {
      issueTitle: "",
      issueDescription: "",
      issueSeverity: "medium",
      issueStatus: "open",
      issueOwner: "",
      issueAssignee: null,
    },
    steps: issueSteps,
    onSubmit: (values) =>
      submitRecord({
        recordType: "issue",
        title: values.issueTitle,
        description: values.issueDescription,
        severity: values.issueSeverity,
        status: values.issueStatus,
        ownerLabel: values.issueOwner,
        assigneeUserId: values.issueAssignee ?? undefined,
      }),
  });

  // ───────────────────────────────────────────────────────── decision
  type DecisionValues = {
    decisionTitle: string;
    decisionRationale: string;
    decisionStatus: string;
    decisionAt: string;
    decisionImpact: string;
  };
  const decisionSteps: GuidedFlowStep<DecisionValues>[] = [
    {
      id: "what",
      title: "What was decided?",
      hint: "Write it so somebody reading in two years knows what was chosen and why.",
      fields: [
        {
          name: "decisionTitle",
          label: "a decision",
          required: true,
          requiredMessage: "Say what was decided before you record it.",
        },
        {
          name: "decisionRationale",
          label: "the reasoning",
          required: true,
          requiredMessage: "Say why it was decided. A decision with no reason cannot be revisited.",
        },
      ],
      render: (flow) => (
        <>
          <GuidedFlowRow flow={flow} name="decisionTitle" label="The decision, in a line">
            <Input
              {...flow.text("decisionTitle")}
              placeholder="Use VMT-first narrative for public packet"
            />
          </GuidedFlowRow>
          <GuidedFlowRow flow={flow} name="decisionRationale" label="Why?">
            <Textarea
              {...flow.text("decisionRationale")}
              rows={4}
              placeholder="Why was this decided, on what basis, and what was traded off?"
            />
          </GuidedFlowRow>
        </>
      ),
    },
    {
      id: "standing",
      title: "Where does it stand, and what does it change?",
      fields: [
        { name: "decisionStatus", label: "a status" },
        { name: "decisionAt", label: "a date" },
        { name: "decisionImpact", label: "the effects" },
      ],
      render: (flow) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="decisionStatus" label="Is it settled?">
              <select className={selectClassName} {...flow.text("decisionStatus")}>
                <option value="proposed">Proposed</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="decisionAt" label="When was it decided?">
              <Input type="datetime-local" {...flow.text("decisionAt")} />
            </GuidedFlowRow>
          </div>
          <GuidedFlowRow flow={flow} name="decisionImpact" label="What does it change?">
            <Textarea
              {...flow.text("decisionImpact")}
              rows={4}
              placeholder="What downstream scope, quality, schedule, or policy effects does this create?"
            />
          </GuidedFlowRow>
        </>
      ),
    },
  ];
  const decisionFlow = useGuidedFlow<DecisionValues>({
    id: "project-record-decision",
    title: "Record a decision",
    submitLabel: "Record the decision",
    initialValues: {
      decisionTitle: "",
      decisionRationale: "",
      decisionStatus: "proposed",
      decisionAt: "",
      decisionImpact: "",
    },
    steps: decisionSteps,
    onSubmit: (values) =>
      submitRecord({
        recordType: "decision",
        title: values.decisionTitle,
        rationale: values.decisionRationale,
        status: values.decisionStatus,
        impactSummary: values.decisionImpact,
        decidedAt: values.decisionAt ? new Date(values.decisionAt).toISOString() : undefined,
      }),
  });

  // ────────────────────────────────────────────────────────── meeting
  type MeetingValues = {
    meetingTitle: string;
    meetingAt: string;
    meetingAttendees: string;
    meetingNotes: string;
  };
  const meetingSteps: GuidedFlowStep<MeetingValues>[] = [
    {
      id: "what",
      title: "Which meeting?",
      fields: [
        {
          name: "meetingTitle",
          label: "a name",
          required: true,
          requiredMessage: "Name the meeting before you add it.",
        },
        { name: "meetingAt", label: "a time" },
        { name: "meetingAttendees", label: "who was there" },
      ],
      render: (flow) => (
        <>
          <GuidedFlowRow flow={flow} name="meetingTitle" label="Name">
            <Input {...flow.text("meetingTitle")} placeholder="Weekly project sync" />
          </GuidedFlowRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <GuidedFlowRow flow={flow} name="meetingAt" label="When was it?">
              <Input type="datetime-local" {...flow.text("meetingAt")} />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="meetingAttendees" label="Who was there?">
              <Input {...flow.text("meetingAttendees")} placeholder="Nathaniel, Elena, Owen" />
            </GuidedFlowRow>
          </div>
        </>
      ),
    },
    {
      id: "notes",
      title: "What came out of it?",
      hint: "Key points, action items, and anything still open.",
      fields: [{ name: "meetingNotes", label: "notes" }],
      render: (flow) => (
        <GuidedFlowRow flow={flow} name="meetingNotes" label="Notes">
          <Textarea
            {...flow.text("meetingNotes")}
            rows={7}
            placeholder="Key points, action items, and open questions."
          />
        </GuidedFlowRow>
      ),
    },
  ];
  const meetingFlow = useGuidedFlow<MeetingValues>({
    id: "project-record-meeting",
    title: "Add meeting notes",
    submitLabel: "Add the meeting",
    initialValues: {
      meetingTitle: "",
      meetingAt: "",
      meetingAttendees: "",
      meetingNotes: "",
    },
    steps: meetingSteps,
    onSubmit: (values) =>
      submitRecord({
        recordType: "meeting",
        title: values.meetingTitle,
        notes: values.meetingNotes,
        meetingAt: values.meetingAt ? new Date(values.meetingAt).toISOString() : undefined,
        attendeesSummary: values.meetingAttendees,
      }),
  });

  // Every flow is built on every render — hooks cannot be conditional — but a
  // page only OFFERS the types it was asked for, and only renders those sheets.
  const flowsByType: Record<ProjectRecordComposerType, { open: () => void; sheet: React.ReactNode }> = {
    milestone: { open: milestoneFlow.open, sheet: <GuidedFlow flow={milestoneFlow} /> },
    submittal: { open: submittalFlow.open, sheet: <GuidedFlow flow={submittalFlow} /> },
    deliverable: { open: deliverableFlow.open, sheet: <GuidedFlow flow={deliverableFlow} /> },
    risk: { open: riskFlow.open, sheet: <GuidedFlow flow={riskFlow} /> },
    issue: { open: issueFlow.open, sheet: <GuidedFlow flow={issueFlow} /> },
    decision: { open: decisionFlow.open, sheet: <GuidedFlow flow={decisionFlow} /> },
    meeting: { open: meetingFlow.open, sheet: <GuidedFlow flow={meetingFlow} /> },
  };

  return (
    <article className="module-section-surface">
      <div className="module-section-heading">
        <p className="module-section-label">Create records</p>
        <h2 className="module-section-title">Add {listRecordTypes(offered)}</h2>
        <p className="module-section-description">
          Keeping these up to date is what turns the project page from a filing cabinet into
          something you can actually run the work from. Each button asks a few short questions.
        </p>
      </div>

      {/*
        Written out one by one rather than mapped, because the project page's
        tab strip deep-links to these ids and the guard that checks every anchor
        has something to scroll to reads LITERAL `id="…"` attributes out of the
        source. A mapped `id={`${type}-add`}` renders the right thing and is
        invisible to that guard — an anchor nothing can prove exists.
      */}
      <div className="mt-5 flex flex-wrap gap-2" data-testid="project-record-composer-types">
        {shows("milestone") ? (
          <Button
            type="button"
            variant="outline"
            id="milestone-add"
            data-testid="project-record-open-milestone"
            onClick={flowsByType.milestone.open}
          >
            <Flag className="mr-1.5 h-4 w-4" />
            Add a milestone
          </Button>
        ) : null}
        {shows("submittal") ? (
          <Button
            type="button"
            variant="outline"
            id="submittal-add"
            data-testid="project-record-open-submittal"
            onClick={flowsByType.submittal.open}
          >
            <FileText className="mr-1.5 h-4 w-4" />
            Add a submittal
          </Button>
        ) : null}
        {shows("deliverable") ? (
          <Button
            type="button"
            variant="outline"
            id="deliverable-add"
            data-testid="project-record-open-deliverable"
            onClick={flowsByType.deliverable.open}
          >
            <ClipboardCheck className="mr-1.5 h-4 w-4" />
            Add a deliverable
          </Button>
        ) : null}
        {shows("risk") ? (
          <Button
            type="button"
            variant="outline"
            id="risk-add"
            data-testid="project-record-open-risk"
            onClick={flowsByType.risk.open}
          >
            <AlertTriangle className="mr-1.5 h-4 w-4" />
            Log a risk
          </Button>
        ) : null}
        {shows("issue") ? (
          <Button
            type="button"
            variant="outline"
            id="issue-add"
            data-testid="project-record-open-issue"
            onClick={flowsByType.issue.open}
          >
            <Siren className="mr-1.5 h-4 w-4" />
            Log an issue
          </Button>
        ) : null}
        {shows("decision") ? (
          <Button
            type="button"
            variant="outline"
            id="decision-add"
            data-testid="project-record-open-decision"
            onClick={flowsByType.decision.open}
          >
            <Scale className="mr-1.5 h-4 w-4" />
            Record a decision
          </Button>
        ) : null}
        {shows("meeting") ? (
          <Button
            type="button"
            variant="outline"
            id="meeting-add"
            data-testid="project-record-open-meeting"
            onClick={flowsByType.meeting.open}
          >
            <MessagesSquare className="mr-1.5 h-4 w-4" />
            Add meeting notes
          </Button>
        ) : null}
      </div>

      {offered.map((type) => (
        <React.Fragment key={type}>{flowsByType[type].sheet}</React.Fragment>
      ))}
    </article>
  );
}
