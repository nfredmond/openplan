"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  accessRequestStatusLabel,
  accessRequestTriageActionLabel,
  getAccessRequestTransitionOptions,
  type AccessRequestStatus,
  type AccessRequestTriageStatus,
} from "@/lib/access-request-status";

type AccessRequestStatusControlsProps = {
  requestId: string;
  status: AccessRequestStatus;
};

export function AccessRequestStatusControls({ requestId, status }: AccessRequestStatusControlsProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<AccessRequestStatus>(status);
  const [pendingStatus, setPendingStatus] = useState<AccessRequestTriageStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transitionOptions = getAccessRequestTransitionOptions(currentStatus);

  async function updateStatus(nextStatus: AccessRequestTriageStatus) {
    setPendingStatus(nextStatus);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/admin/access-requests/${requestId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Status update failed.");
        return;
      }

      setCurrentStatus(payload.request.status);
      setMessage(`Updated to ${accessRequestStatusLabel(payload.request.status)}.`);
      router.refresh();
    } catch {
      setError("Status update failed.");
    } finally {
      setPendingStatus(null);
    }
  }

  return (
    <div className="module-subpanel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Triage</p>
        <StatusBadge tone="neutral">{accessRequestStatusLabel(currentStatus)}</StatusBadge>
      </div>

      {transitionOptions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {transitionOptions.map((option) => (
            <Button
              key={option}
              type="button"
              variant={option === "declined" ? "destructive" : "outline"}
              size="xs"
              disabled={pendingStatus !== null}
              onClick={() => updateStatus(option)}
            >
              {pendingStatus === option ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              {accessRequestTriageActionLabel(option)}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No further triage transition is available for this request.</p>
      )}

      {message ? <p className="mt-3 text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
