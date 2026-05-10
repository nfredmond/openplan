import { ArrowRight, Clock3, History } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  accessRequestStatusLabel,
  canProvisionAccessRequestStatus,
  type AccessRequestReviewRow,
  type AccessRequestStatus,
} from "@/lib/access-requests";

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
          Access activity checkpoint
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
