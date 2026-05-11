import { ArrowRight, ClipboardCheck, Clock3, History, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  accessRequestStatusLabel,
  buildAccessRequestOperatorSourceProof,
  canProvisionAccessRequestStatus,
  type AccessRequestReviewRow,
  type AccessRequestStatus,
} from "@/lib/access-requests";
import {
  labelAccessRequestDeploymentPosture,
  labelAccessRequestFirstWorkflow,
  labelAccessRequestServiceLane,
} from "@/lib/access-request-intake";

export type AccessRequestActivitySummary = {
  label: string;
  detail: string;
  needsOperatorAction: boolean;
};

export type AccessRequestProvisioningReadiness = {
  label: string;
  detail: string;
  blockers: string[];
  ready: boolean;
};

export type AccessRequestOperatorActionPlan = {
  headline: string;
  steps: string[];
  riskNotes: string[];
  sourceNotes: string[];
};

function formatTimestamp(value: string | null) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getLatestReviewEvent(request: Pick<AccessRequestReviewRow, "review_events">) {
  return [...request.review_events].sort((left, right) => {
    const leftTime = left.created_at ? Date.parse(left.created_at) : 0;
    const rightTime = right.created_at ? Date.parse(right.created_at) : 0;
    return rightTime - leftTime;
  })[0] ?? null;
}

function statusNeedsOperatorAction(status: AccessRequestStatus) {
  return status === "new" || status === "reviewing" || status === "contacted" || status === "invited";
}

export function summarizeAccessRequestActivity(
  request: Pick<
    AccessRequestReviewRow,
    "status" | "created_at" | "reviewed_at" | "review_events" | "provisioned_workspace_id" | "owner_invitation"
  >,
): AccessRequestActivitySummary {
  const latestEvent = getLatestReviewEvent(request);

  if (request.status === "provisioned") {
    if (request.owner_invitation?.accepted_at) {
      return {
        label: "Owner accepted",
        detail: `Owner invite accepted ${formatTimestamp(request.owner_invitation.accepted_at)}. Workspace ${request.provisioned_workspace_id?.slice(0, 8) ?? "linked"} is ready for pilot kickoff.`,
        needsOperatorAction: false,
      };
    }

    if (request.owner_invitation) {
      return {
        label: "Invite pending",
        detail: `Owner invite ${request.owner_invitation.status} since ${formatTimestamp(request.owner_invitation.created_at)}. Manual delivery remains the operator handoff item.`,
        needsOperatorAction: request.owner_invitation.status === "pending",
      };
    }

    return {
      label: "Workspace linked",
      detail: `Provisioned workspace ${request.provisioned_workspace_id?.slice(0, 8) ?? "linked"}; owner invite status is not available in this read.`,
      needsOperatorAction: true,
    };
  }

  if (latestEvent) {
    return {
      label: "Latest review",
      detail: `${accessRequestStatusLabel(latestEvent.previous_status)} → ${accessRequestStatusLabel(latestEvent.status)} on ${formatTimestamp(latestEvent.created_at)}.`,
      needsOperatorAction: statusNeedsOperatorAction(request.status),
    };
  }

  if (request.reviewed_at) {
    return {
      label: "Review marker",
      detail: `${accessRequestStatusLabel(request.status)} marked ${formatTimestamp(request.reviewed_at)} with no compact event row loaded.`,
      needsOperatorAction: statusNeedsOperatorAction(request.status),
    };
  }

  return {
    label: "Awaiting first review",
    detail: `Submitted ${formatTimestamp(request.created_at)}. Mark reviewing, defer, or decline before provisioning.`,
    needsOperatorAction: true,
  };
}

export function summarizeAccessRequestProvisioningReadiness(
  request: Pick<
    AccessRequestReviewRow,
    | "status"
    | "expected_workspace_name"
    | "agency_name"
    | "contact_email"
    | "service_lane"
    | "deployment_posture"
    | "data_sensitivity"
    | "desired_first_workflow"
    | "provisioned_workspace_id"
  >,
): AccessRequestProvisioningReadiness {
  if (request.provisioned_workspace_id || request.status === "provisioned") {
    return {
      label: "Already provisioned",
      detail: `Workspace ${request.provisioned_workspace_id?.slice(0, 8) ?? "linked"} is linked; switch to owner-invite handoff checks.`,
      blockers: [],
      ready: false,
    };
  }

  const blockers: string[] = [];

  if (!canProvisionAccessRequestStatus(request.status)) {
    blockers.push(`Move status to Contacted or Invited; current status is ${accessRequestStatusLabel(request.status)}.`);
  }

  if (!(request.expected_workspace_name ?? request.agency_name).trim()) {
    blockers.push("Confirm the workspace display name.");
  }

  if (!request.contact_email.trim()) {
    blockers.push("Confirm the owner email for the initial invitation.");
  }

  if (!request.service_lane) blockers.push("Select a service lane.");
  if (!request.deployment_posture) blockers.push("Confirm deployment posture.");
  if (!request.data_sensitivity) blockers.push("Record data sensitivity before pilot setup.");
  if (!request.desired_first_workflow) blockers.push("Pick the first workflow to seed.");

  if (blockers.length === 0) {
    return {
      label: "Ready to provision",
      detail: "Required intake, posture, data, workflow, owner, and status checks are present for supervised workspace creation.",
      blockers,
      ready: true,
    };
  }

  return {
    label: "Provisioning prep needed",
    detail: `${blockers.length} checkpoint${blockers.length === 1 ? "" : "s"} remaining before creating a workspace and owner invite.`,
    blockers,
    ready: false,
  };
}

export function summarizeAccessRequestOperatorActionPlan(
  request: Pick<
    AccessRequestReviewRow,
    | "status"
    | "source_path"
    | "metadata_json"
    | "service_lane"
    | "deployment_posture"
    | "data_sensitivity"
    | "desired_first_workflow"
    | "onboarding_needs"
    | "use_case"
    | "provisioned_workspace_id"
    | "owner_invitation"
  >,
): AccessRequestOperatorActionPlan {
  const steps: string[] = [];
  const riskNotes: string[] = [];
  const sourceNotes: string[] = [];

  if (request.status === "new") {
    steps.push("Read use case and onboarding notes, then mark Reviewing, Deferred, or Declined.");
  } else if (request.status === "reviewing") {
    steps.push("Contact the prospect outside OpenPlan and record the status only after contact is complete.");
  } else if (request.status === "contacted" || request.status === "invited") {
    steps.push("Confirm manual commercial scope, owner email, and workspace name before using the invite control.");
  } else if (request.status === "provisioned") {
    steps.push(
      request.owner_invitation?.accepted_at
        ? "Owner accepted the invite; move to supervised pilot kickoff and support checks."
        : "Deliver or follow up on the manual owner invite outside OpenPlan; no email was sent automatically.",
    );
  } else {
    steps.push("No provisioning action: keep the decision trail visible and avoid customer-facing side effects.");
  }

  steps.push("Do not auto-create billing, send email, or promise a hosted workspace from this row.");

  if (request.data_sensitivity === "regulated_sensitive" || request.data_sensitivity === "confidential_project") {
    riskNotes.push("High-sensitivity data: require human scoping, confidentiality review, and minimum-data onboarding.");
  } else if (request.data_sensitivity === "unsure" || !request.data_sensitivity) {
    riskNotes.push("Data sensitivity is not settled; ask before requesting files or creating a pilot workspace.");
  }

  if (request.deployment_posture === "nat_ford_managed" || request.service_lane === "managed_hosting_admin") {
    riskNotes.push("Managed hosting interest: verify support scope, security expectations, and fee posture manually.");
  }

  if (!request.desired_first_workflow) {
    riskNotes.push("First workflow is missing; choose a seed workflow before provisioning.");
  }

  const sourceProof = buildAccessRequestOperatorSourceProof(request);
  const sourceText = [sourceProof.sourcePath, sourceProof.source, sourceProof.intent, sourceProof.product, sourceProof.tier]
    .filter(Boolean)
    .join(" ");
  if (sourceText.includes("pricing")) sourceNotes.push("Pricing entry: verify paid tier expectations before any pilot setup.");
  if (sourceText.includes("examples")) sourceNotes.push("Examples entry: tie follow-up to the showcased workflow they likely saw.");
  if (sourceText.includes("github") || sourceText.includes("source")) sourceNotes.push("Source-repo entry: treat as open-source support or self-host evaluation until scoped.");
  if (sourceText.includes("managed-hosting") || sourceText.includes("managed hosting") || request.service_lane === "managed_hosting_admin") sourceNotes.push("Managed hosting signal is present; keep hosting activation supervised.");
  if (sourceNotes.length === 0) {
    sourceNotes.push(`Source context: ${sourceProof.sourcePath}. Confirm whether this came from pricing, examples, source repo, or managed-hosting copy.`);
  }

  const headline = `${labelAccessRequestServiceLane(request.service_lane)} · ${labelAccessRequestDeploymentPosture(request.deployment_posture)} · ${labelAccessRequestFirstWorkflow(request.desired_first_workflow)}`;

  return { headline, steps, riskNotes, sourceNotes };
}

export function AccessRequestOperatorActionPlanPanel({ request }: { request: AccessRequestReviewRow }) {
  const plan = summarizeAccessRequestOperatorActionPlan(request);

  return (
    <div className="module-subpanel mt-3" aria-label="Manual operator action plan">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <ClipboardCheck className="h-3.5 w-3.5 text-emerald-700" />
          Manual operator action plan
        </div>
        <StatusBadge tone="warning">No automation</StatusBadge>
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">{plan.headline}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {plan.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
            Risk / triage notes
          </div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {(plan.riskNotes.length > 0 ? plan.riskNotes : ["No elevated risk signal captured; still verify scope manually."]).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground">Source / expectation notes</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {plan.sourceNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function AccessRequestProvisioningReadinessPanel({ request }: { request: AccessRequestReviewRow }) {
  const readiness = summarizeAccessRequestProvisioningReadiness(request);

  return (
    <div className="module-subpanel mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5 text-emerald-700" />
          Provisioning readiness
        </div>
        <StatusBadge tone={readiness.ready ? "success" : readiness.blockers.length > 0 ? "warning" : "neutral"}>
          {readiness.ready ? "Ready" : readiness.blockers.length > 0 ? "Needs prep" : "Linked"}
        </StatusBadge>
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">{readiness.label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{readiness.detail}</p>
      {readiness.blockers.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {readiness.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AccessRequestActivitySummaryPanel({ request }: { request: AccessRequestReviewRow }) {
  const summary = summarizeAccessRequestActivity(request);
  const latestEvent = getLatestReviewEvent(request);

  return (
    <div className="module-subpanel mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <History className="h-3.5 w-3.5 text-emerald-700" />
          Review trail
        </div>
        <StatusBadge tone={summary.needsOperatorAction ? "warning" : "success"}>
          {summary.needsOperatorAction ? "Operator handoff" : "Pilot ready"}
        </StatusBadge>
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">{summary.label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{summary.detail}</p>

      {latestEvent ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          <span className="font-medium text-foreground">{accessRequestStatusLabel(latestEvent.previous_status)}</span>
          <ArrowRight className="h-3 w-3" />
          <span className="font-medium text-foreground">{accessRequestStatusLabel(latestEvent.status)}</span>
          <span>{formatTimestamp(latestEvent.created_at)}</span>
        </div>
      ) : null}
    </div>
  );
}
