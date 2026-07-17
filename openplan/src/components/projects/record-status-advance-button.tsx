"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type RecordType = "milestone" | "submittal";

const MILESTONE_STATUSES = ["not_started", "scheduled", "in_progress", "blocked", "complete"] as const;
const SUBMITTAL_STATUSES = ["draft", "internal_review", "submitted", "accepted", "revise_and_resubmit"] as const;

function nextStatusForRecord(recordType: RecordType, status: string): string | null {
  if (recordType === "milestone") {
    switch (status) {
      case "not_started":
      case "scheduled":
        return "in_progress";
      case "blocked":
        return "in_progress";
      case "in_progress":
        return "complete";
      default:
        return null;
    }
  }

  switch (status) {
    case "draft":
      return "internal_review";
    case "internal_review":
      return "submitted";
    case "revise_and_resubmit":
      return "submitted";
    case "submitted":
      return "accepted";
    default:
      return null;
  }
}

function actionLabelForRecord(recordType: RecordType, status: string): string | null {
  if (recordType === "milestone") {
    switch (status) {
      case "not_started":
      case "scheduled":
        return "Start milestone";
      case "blocked":
        return "Resume milestone";
      case "in_progress":
        return "Mark complete";
      default:
        return null;
    }
  }

  switch (status) {
    case "draft":
      return "Move to internal review";
    case "internal_review":
      return "Mark submitted";
    case "revise_and_resubmit":
      return "Mark resubmitted";
    case "submitted":
      return "Mark accepted";
    default:
      return null;
  }
}

function titleizeStatus(status: string): string {
  return status
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function RecordStatusAdvanceButton({
  projectId,
  recordId,
  recordType,
  currentStatus,
}: {
  projectId: string;
  recordId: string;
  recordType: RecordType;
  currentStatus: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const nextStatus = nextStatusForRecord(recordType, currentStatus);
  const actionLabel = actionLabelForRecord(recordType, currentStatus);
  const statuses = recordType === "milestone" ? MILESTONE_STATUSES : SUBMITTAL_STATUSES;
  const recordLabel = recordType === "milestone" ? "Milestone" : "Submittal";

  async function applyStatus(status: string) {
    if (status === currentStatus) return;

    setError(null);
    setMessage(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/records/${recordId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recordType,
          status,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Failed to update ${recordType} status`);
      }

      setMessage(`${recordLabel} moved to ${status.replace(/[_-]+/g, " ")}.`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `Failed to update ${recordType} status`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="module-record-actions justify-start">
        {nextStatus && actionLabel ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void applyStatus(nextStatus)} disabled={isSaving}>
            {isSaving ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Updating…
              </span>
            ) : (
              actionLabel
            )}
          </Button>
        ) : null}
        <select
          aria-label={`Set ${recordType} status`}
          className="module-select h-8 w-auto px-2 text-xs"
          value={currentStatus}
          disabled={isSaving}
          onChange={(event) => void applyStatus(event.target.value)}
        >
          {statuses.map((status) => (
            <option key={status} value={status}>
              {titleizeStatus(status)}
            </option>
          ))}
        </select>
      </div>
      {message ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
