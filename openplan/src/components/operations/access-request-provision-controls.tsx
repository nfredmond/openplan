"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  accessRequestProvisioningSideEffectLabel,
  canProvisionAccessRequestStatus,
  type AccessRequestStatus,
} from "@/lib/access-request-status";

type AccessRequestProvisionControlsProps = {
  requestId: string;
  status: AccessRequestStatus;
  provisionedWorkspaceId: string | null;
  workspaceName: string;
};

export function AccessRequestProvisionControls({
  requestId,
  status,
  provisionedWorkspaceId,
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
  const canProvision = !linkedWorkspaceId && canProvisionAccessRequestStatus(currentStatus);
  const trimmedWorkspaceName = draftWorkspaceName.trim();

  async function provisionWorkspace() {
    if (!canProvision || !trimmedWorkspaceName) {
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
        body: JSON.stringify({ workspaceName: trimmedWorkspaceName }),
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
        <div className="mt-3 flex items-center gap-2 text-sm text-foreground">
          <UserPlus className="h-4 w-4 text-emerald-700" />
          <span>Workspace {linkedWorkspaceId.slice(0, 8)} linked.</span>
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
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={pending || !trimmedWorkspaceName}
            onClick={provisionWorkspace}
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Create invite
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
