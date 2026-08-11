"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AssigneePicker } from "@/components/workspaces/assignee-picker";
import { projectRecordLabel } from "@/lib/projects/record-status-transitions";

/**
 * REASSIGN OR UNASSIGN AN EXISTING PROJECT RECORD.
 *
 * WHY THIS EXISTS. `assigneeUserId` shipped on the four assignable branches of
 * PATCH /api/projects/[projectId]/records/[recordId] — validated against the
 * workspace roster, covered by six route tests — and NOTHING IN THE PRODUCT
 * SENT IT. Assignment was create-time only: the composer could name a teammate
 * once and no screen could ever change that answer. The case the lane rendered
 * most carefully was the one it stranded hardest — a departed member's work
 * showed the honest "previously a member" sentence on every surface and could
 * not be handed to anybody. `every-api-route-has-a-caller` cannot see this
 * class: the route had two callers, the FIELD had none.
 *
 * WHY IT IS ITS OWN COMPONENT rather than a third block inside
 * `deliverable-update-controls.tsx` or `record-status-advance-button.tsx`. Four
 * lanes need it (deliverables, milestones, submittals, issues) and one lane
 * must NOT have it (risks carry no assignee column at all), so it cannot live
 * in the status button that all five share. Extracting it is the same rule the
 * assignee chip already follows: a shared capability that lives inside one of
 * its callers gets reimplemented wrongly by the other.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT DO.
 *
 * - IT NEVER SENDS `status`. The route's schema made status optional precisely
 *   so this call is possible; re-asserting the status this page happened to
 *   render would roll back a colleague's transition every time somebody
 *   reassigned a record. See that route's header for the full argument.
 * - IT RENDERS NOTHING WHEN THE COLUMN WAS NOT READ. `undefined` means the
 *   projection could not ask for `assignee_user_id` (a deployment behind
 *   20260811000006); `null` means it asked and nobody is assigned. Offering a
 *   picker in the first case would show "Unassigned" as the current answer to a
 *   question that was never put to the database, and one careless click would
 *   write that guess over a real assignment.
 */

type AssignableRecordType = "deliverable" | "milestone" | "submittal" | "issue";

export function RecordAssigneeControl({
  projectId,
  workspaceId,
  recordId,
  recordType,
  currentAssigneeUserId,
  canWrite,
}: {
  projectId: string;
  /** The PROJECT's workspace, never the viewer's "current" one. */
  workspaceId: string;
  recordId: string;
  recordType: AssignableRecordType;
  /** `undefined` = the column was not projected; `null` = nobody is assigned. */
  currentAssigneeUserId: string | null | undefined;
  /** False for the read-only viewer tier — the route refuses them anyway. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string | null>(currentAssigneeUserId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const recordLabel = projectRecordLabel(recordType);

  async function apply(next: string | null) {
    if (next === value) return;

    setError(null);
    setMessage(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/records/${recordId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordType,
          // The only field. `null` is a real instruction — "unassign" — which is
          // why it is sent rather than omitted.
          assigneeUserId: next,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Failed to update the ${recordType} assignee`);
      }

      setValue(next);
      setMessage(next === null ? `${recordLabel} unassigned.` : `${recordLabel} reassigned.`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : `Failed to update the ${recordType} assignee`
      );
    } finally {
      setIsSaving(false);
    }
  }

  // Refusals after the hooks — see the header for why each is a refusal rather
  // than a disabled control.
  if (!canWrite) return null;
  if (currentAssigneeUserId === undefined) return null;

  return (
    <div className="mt-3 flex flex-col gap-1">
      <p className="text-[0.72rem] font-medium text-muted-foreground">Assignee</p>
      <div className="max-w-[18rem]">
        <AssigneePicker
          id={`record-assignee-${recordId}`}
          label="Assignee"
          workspaceId={workspaceId}
          value={value}
          disabled={isSaving}
          onChange={(next) => void apply(next)}
        />
      </div>
      {message ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
