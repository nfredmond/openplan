import { Inbox, LockKeyhole, TriangleAlert } from "lucide-react";

import {
  AccessRequestActivitySummaryPanel,
  AccessRequestOperatorActionPlanPanel,
  AccessRequestProvisioningReadinessPanel,
} from "@/components/operations/access-request-activity-summary";
import { AccessRequestProvisionControls } from "@/components/operations/access-request-provision-controls";
import { AccessRequestStatusControls } from "@/components/operations/access-request-status-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  accessRequestStatusLabel,
  buildAccessRequestOperatorSourceProof,
  type AccessRequestReviewRow,
  type AccessRequestStatus,
} from "@/lib/access-requests";
import {
  labelAccessRequestDataSensitivity,
  labelAccessRequestDeploymentPosture,
  labelAccessRequestFirstWorkflow,
  labelAccessRequestOrganizationType,
  labelAccessRequestServiceLane,
} from "@/lib/access-request-intake";

type RecentAccessRequestsProps = {
  enabled: boolean;
  requests: AccessRequestReviewRow[];
  error: { message?: string } | null;
};

function statusTone(status: AccessRequestStatus) {
  if (status === "provisioned") return "success" as const;
  if (status === "declined" || status === "deferred") return "danger" as const;
  if (status === "contacted" || status === "invited") return "info" as const;
  if (status === "reviewing") return "warning" as const;
  return "neutral" as const;
}

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

export function RecentAccessRequests({ enabled, requests, error }: RecentAccessRequestsProps) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Access request intake</p>
          <h2 className="module-section-title">Service lane intake queue</h2>
          <p className="module-section-description">
            This lane reads service-role-only request rows and routes each prospect by service lane, deployment posture, data sensitivity, and first workflow.
          </p>
        </div>
        <StatusBadge tone={!enabled ? "neutral" : error ? "warning" : "info"}>
          {!enabled ? "Review locked" : error ? "Read warning" : `${requests.length} recent`}
        </StatusBadge>
      </div>

      {!enabled ? (
        <div className="module-note mt-4 text-sm leading-relaxed text-muted-foreground">
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>
              Access request review is locked until the operator email is present in OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS.
              Submissions can still be stored by the public intake route, but prospect contact rows are not rendered here.
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="module-note mt-4 border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-sm leading-relaxed">
              Access requests could not be loaded. Check service-role configuration and the access_requests migration before
              treating the intake lane as complete.
            </p>
          </div>
        </div>
      ) : requests.length > 0 ? (
        <div className="mt-5 module-record-list">
          {requests.map((request) => {
            const sourceProof = buildAccessRequestOperatorSourceProof(request);
            return (
            <div key={request.id} className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={statusTone(request.status)}>{accessRequestStatusLabel(request.status)}</StatusBadge>
                    <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {formatTimestamp(request.created_at)}
                    </span>
                    {request.source_path ? (
                      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {request.source_path}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{request.agency_name}</h3>
                      <code className="rounded border border-border/70 bg-muted/15 px-2 py-1 text-[0.72rem] text-foreground/80">
                        {request.id.slice(0, 8)}
                      </code>
                    </div>
                    <p className="module-record-summary">
                      {request.contact_name}
                      {request.role_title ? `, ${request.role_title}` : ""} · {request.contact_email}
                    </p>
                    <p className="module-record-summary">
                      {labelAccessRequestServiceLane(request.service_lane)} · {labelAccessRequestFirstWorkflow(request.desired_first_workflow)}
                    </p>
                    <p className="module-record-summary">{request.use_case}</p>
                  </div>
                </div>
                <div className="module-record-actions">
                  <Inbox className="h-4 w-4 text-emerald-700" />
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.55fr)]">
                <div className="module-subpanel">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Service lane context
                  </p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div>
                      <dt className="inline text-muted-foreground">Lane: </dt>
                      <dd className="inline text-foreground">{labelAccessRequestServiceLane(request.service_lane)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-muted-foreground">Workflow: </dt>
                      <dd className="inline text-foreground">{labelAccessRequestFirstWorkflow(request.desired_first_workflow)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-muted-foreground">Deployment: </dt>
                      <dd className="inline text-foreground">{labelAccessRequestDeploymentPosture(request.deployment_posture)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="module-subpanel">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Organization and data
                  </p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div>
                      <dt className="inline text-muted-foreground">Type: </dt>
                      <dd className="inline text-foreground">{labelAccessRequestOrganizationType(request.organization_type)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-muted-foreground">Region: </dt>
                      <dd className="inline text-foreground">{request.region ?? "Not specified"}</dd>
                    </div>
                    <div>
                      <dt className="inline text-muted-foreground">Sensitivity: </dt>
                      <dd className="inline text-foreground">{labelAccessRequestDataSensitivity(request.data_sensitivity)}</dd>
                    </div>
                  </dl>
                </div>
                <AccessRequestStatusControls requestId={request.id} status={request.status} />
                <AccessRequestProvisionControls
                  requestId={request.id}
                  status={request.status}
                  provisionedWorkspaceId={request.provisioned_workspace_id}
                  ownerInvitation={request.owner_invitation}
                  workspaceName={request.expected_workspace_name ?? request.agency_name}
                />
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="module-subpanel">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Expected workspace
                  </p>
                  <p className="mt-2 text-sm text-foreground">{request.expected_workspace_name ?? "Not specified"}</p>
                </div>
                <div className="module-subpanel">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Onboarding needs
                  </p>
                  <p className="mt-2 text-sm text-foreground">{request.onboarding_needs ?? "Not specified"}</p>
                </div>
              </div>

              <div className="mt-3 module-subpanel" aria-label="Request source and intent proof">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Request source and intent proof
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      Confirm this public intake context before triage or any manual invite. This panel is read-only and does not create billing, email, workspace, or deployment side effects.
                    </p>
                  </div>
                  <StatusBadge tone={sourceProof.sourcePath === "/request-access" ? "success" : "warning"}>
                    {sourceProof.sourcePath === "/request-access" ? "Public intake" : "Source check"}
                  </StatusBadge>
                </div>
                <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Submitted via</dt>
                    <dd className="text-foreground">{sourceProof.submittedVia}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Source path</dt>
                    <dd className="text-foreground">{sourceProof.sourcePath}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Source intent</dt>
                    <dd className="text-foreground">{sourceProof.intent}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Acquisition source</dt>
                    <dd className="text-foreground">{sourceProof.source}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Product / tier</dt>
                    <dd className="text-foreground">{sourceProof.product} / {sourceProof.tier}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Checkout posture</dt>
                    <dd className="text-foreground">
                      {sourceProof.checkout}{sourceProof.checkoutDisabled === true ? " · checkout disabled" : ""}{sourceProof.legacyCheckout === true ? " · legacy checkout" : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Referer / received</dt>
                    <dd className="text-foreground">{sourceProof.refererHost ?? "no referer"}{sourceProof.receivedAt ? ` · ${formatTimestamp(sourceProof.receivedAt)}` : ""}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Fingerprint</dt>
                    <dd className="text-foreground">{sourceProof.sourceFingerprint?.slice(0, 12) ?? "not captured"}</dd>
                  </div>
                </dl>
                {sourceProof.workspaceId ? (
                  <p className="mt-2 text-sm text-muted-foreground">Workspace context supplied by intake: {sourceProof.workspaceId}. Operator must still verify membership manually.</p>
                ) : null}
              </div>

              <AccessRequestActivitySummaryPanel request={request} />
              <AccessRequestOperatorActionPlanPanel request={request} />
              <AccessRequestProvisioningReadinessPanel request={request} />
            </div>
            );
          })}
        </div>
      ) : (
        <div className="module-note mt-4 text-sm leading-relaxed text-muted-foreground">
          No access requests have been stored yet. The first request submitted through /request-access will appear here for
          allowlisted operators.
        </div>
      )}
    </article>
  );
}
