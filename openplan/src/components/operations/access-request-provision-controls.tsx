"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT,
  accessRequestProvisioningSideEffectLabel,
  canProvisionAccessRequestStatus,
  type AccessRequestStatus,
} from "@/lib/access-request-status";
import type { AccessRequestOwnerInvitationSummary } from "@/lib/access-requests";
import type { WorkspaceInvitationStatus } from "@/lib/workspaces/invitations";

type AccessRequestProvisionControlsProps = {
  requestId: string;
  status: AccessRequestStatus;
  provisionedWorkspaceId: string | null;
  ownerInvitation?: AccessRequestOwnerInvitationSummary | null;
  workspaceName: string;
};

export function AccessRequestProvisionControls({
  requestId,
  status,
  provisionedWorkspaceId,
  ownerInvitation = null,
  workspaceName,
}: AccessRequestProvisionControlsProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<AccessRequestStatus>(status);
  const [linkedWorkspaceId, setLinkedWorkspaceId] = useState<string | null>(provisionedWorkspaceId);
  const [draftWorkspaceName, setDraftWorkspaceName] = useState(workspaceName);
  const [pending, setPending] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAcknowledgement, setManualAcknowledgement] = useState(false);
  const canProvision = !linkedWorkspaceId && canProvisionAccessRequestStatus(currentStatus);
  const trimmedWorkspaceName = draftWorkspaceName.trim();
  const acknowledgementDescriptionId = `access-request-${requestId}-manual-provisioning-acknowledgement`;

  async function provisionWorkspace() {
    if (!canProvision || !trimmedWorkspaceName || !manualAcknowledgement) {
      return;
    }

    setPending(true);
    setInvitationUrl(null);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/admin/access-requests/${requestId}/provision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceName: trimmedWorkspaceName,
          operatorAcknowledgement: ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Workspace invite creation failed.");
        return;
      }

      setCurrentStatus(payload.request.status);
      setLinkedWorkspaceId(payload.request.provisionedWorkspaceId);
      setInvitationUrl(payload.ownerInvitation.invitationUrl);
      setMessage("Pilot workspace and owner invite created. No email was sent.");
      router.refresh();
    } catch {
      setError("Workspace invite creation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="module-subpanel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Workspace invite
        </p>
        <StatusBadge tone={linkedWorkspaceId ? "success" : canProvision ? "info" : "neutral"}>
          {linkedWorkspaceId ? "Linked" : canProvision ? "Ready" : "Waiting"}
        </StatusBadge>
      </div>

      {linkedWorkspaceId ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <UserPlus className="h-4 w-4 text-emerald-700" />
            <span>Workspace {linkedWorkspaceId.slice(0, 8)} linked.</span>
          </div>
          <OwnerInvitationSummary invitation={ownerInvitation} />
        </div>
      ) : canProvision ? (
        <div className="mt-3 space-y-2">
          <Input
            aria-label="Workspace name"
            className="h-9 rounded-md text-sm"
            value={draftWorkspaceName}
            onChange={(event) => setDraftWorkspaceName(event.target.value)}
            disabled={pending}
          />
          <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 rounded border-amber-300"
              checked={manualAcknowledgement}
              onChange={(event) => setManualAcknowledgement(event.target.checked)}
              disabled={pending}
              aria-describedby={acknowledgementDescriptionId}
            />
            <span>
              I have confirmed this is a manual, operator-initiated provisioning step.
              <span id={acknowledgementDescriptionId} className="mt-1 block">
                Create the workspace and owner invite only; do not send outbound email, do not auto-deliver the
                invitation URL, and do not treat this as autonomous access activation.
              </span>
            </span>
          </label>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={pending || !trimmedWorkspaceName || !manualAcknowledgement}
            onClick={provisionWorkspace}
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Create manual invite — no email
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Available after the request is marked contacted or invited.
        </p>
      )}

      <p className="mt-2 text-xs text-muted-foreground">{accessRequestProvisioningSideEffectLabel()}</p>

      {invitationUrl ? (
        <Input
          aria-label="Owner invitation URL"
          className="mt-3 h-9 rounded-md font-mono text-xs"
          readOnly
          value={invitationUrl}
        />
      ) : null}
      {message ? <p className="mt-3 text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

function invitationStatusLabel(status: WorkspaceInvitationStatus) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function invitationStatusTone(status: WorkspaceInvitationStatus) {
  if (status === "accepted") return "success" as const;
  if (status === "pending") return "info" as const;
  if (status === "expired" || status === "revoked" || status === "declined") return "warning" as const;
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

function OwnerInvitationSummary({ invitation }: { invitation: AccessRequestOwnerInvitationSummary | null }) {
  if (!invitation) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        Owner invite status is not available in the recent invitation ledger.
      </div>
    );
  }

  const timestampLabel =
    invitation.status === "accepted" && invitation.accepted_at
      ? `Accepted ${formatTimestamp(invitation.accepted_at)}`
      : `Expires ${formatTimestamp(invitation.expires_at)}`;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={invitationStatusTone(invitation.status)}>
          Owner invite {invitationStatusLabel(invitation.status)}
        </StatusBadge>
        <code className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[0.68rem] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          {invitation.id.slice(0, 8)}
        </code>
      </div>
      <p className="mt-2 text-muted-foreground">{timestampLabel}. Token and manual-delivery URL are not loaded here.</p>
    </div>
  );
}
