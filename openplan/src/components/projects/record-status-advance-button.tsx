"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  nextProjectRecordStatus,
  projectRecordAdvanceLabel,
  projectRecordLabel,
  projectRecordStatuses,
  type ProjectRecordStatusType,
} from "@/lib/projects/record-status-transitions";

/**
 * The one status control every project-record lane uses.
 *
 * The vocabularies and the forward path used to be a pair of switch statements
 * in this file. That is why the risk and issue lanes shipped read-only for
 * months: there was nothing to reuse short of copying a switch out of a button,
 * so nobody did, and a planner could log a risk but never move it. The tables
 * now live in `@/lib/projects/record-status-transitions`, which
 * `src/test/risk-and-issue-status-branches-are-reachable.test.tsx` checks
 * against the CHECK constraints in the migrations — the only authority, since
 * neither a `.select()` string nor a zod enum is verified against the schema in
 * this repo. That same file also asserts a control RENDERS for every lane the
 * registry declares: a registry makes adding a lane cost one object literal,
 * which makes it cheap to add a lane that reaches no screen.
 */
type RecordType = ProjectRecordStatusType;

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

  const nextStatus = nextProjectRecordStatus(recordType, currentStatus);
  const actionLabel = projectRecordAdvanceLabel(recordType, currentStatus);
  const statuses = projectRecordStatuses(recordType);
  const recordLabel = projectRecordLabel(recordType);

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
