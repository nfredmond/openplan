"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecordStatusAdvanceButton } from "@/components/projects/record-status-advance-button";

/**
 * The planner-facing control for an existing deliverable.
 *
 * Everything here writes through the one deliverable branch of
 * PATCH /api/projects/[projectId]/records/[recordId]. That branch shipped
 * complete — status, not-to-exceed budget, percent complete — and had no caller
 * at all: a deliverable could be given a budget and a progress figure at
 * CREATION time (project-record-composer) and never again. The consequence was
 * not cosmetic. src/lib/projects/budget.ts refuses a pace verdict without both
 * a budget and a recorded percent_complete, so every deliverable created
 * without them was permanently stuck at "No budget entered" / "No progress
 * basis" with no way in the product to supply either.
 *
 * Status lives in RecordStatusAdvanceButton rather than being reimplemented
 * here, so the deliverable and milestone lanes cannot drift apart in what a
 * transition means.
 */

/** Blank means "no value" — an explicit null, which the route accepts. */
function parseOptionalNumber(raw: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return { ok: false, message: "Enter a number, or leave the field blank." };
  return { ok: true, value: parsed };
}

function formatInitial(value: number | null): string {
  return value === null ? "" : String(value);
}

export function DeliverableUpdateControls({
  projectId,
  deliverableId,
  currentStatus,
  currentBudgetAmount,
  currentPercentComplete,
}: {
  projectId: string;
  deliverableId: string;
  currentStatus: string;
  /** Budget as the budget lib parsed it — null when none is recorded. */
  currentBudgetAmount: number | null;
  /** Recorded progress, null when none is recorded. */
  currentPercentComplete: number | null;
}) {
  const router = useRouter();
  const [budget, setBudget] = useState(() => formatInitial(currentBudgetAmount));
  const [percentComplete, setPercentComplete] = useState(() => formatInitial(currentPercentComplete));
  // Only a field the planner actually touched is sent. The route writes a
  // column only when its key is present, so an untouched field is left alone
  // rather than re-asserted — which matters twice over: a blank field is not
  // always "nothing recorded" (when 20260727000012 has not been applied the
  // budget columns are not returned at all, and the prefill is blank because
  // the value could not be READ), and re-asserting a rendered value silently
  // reverts whatever a colleague changed since this page was rendered.
  const [budgetEdited, setBudgetEdited] = useState(false);
  const [percentEdited, setPercentEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const budgetFieldId = `deliverable-budget-${deliverableId}`;
  const percentFieldId = `deliverable-percent-complete-${deliverableId}`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    // Range checks are a fallback, not the active guard: the min/max attributes
    // on the two number fields make native constraint validation block the
    // submit event before this handler runs, so these branches are unreachable
    // while those attributes stand. They are kept so removing an attribute
    // cannot silently start sending values the route will 400.
    const parsedBudget = parseOptionalNumber(budget);
    if (!parsedBudget.ok) {
      setError(`Budget: ${parsedBudget.message}`);
      return;
    }
    if (parsedBudget.value !== null && parsedBudget.value < 0) {
      setError("Budget cannot be negative.");
      return;
    }

    const parsedPercent = parseOptionalNumber(percentComplete);
    if (!parsedPercent.ok) {
      setError(`Percent complete: ${parsedPercent.message}`);
      return;
    }
    if (parsedPercent.value !== null && (parsedPercent.value < 0 || parsedPercent.value > 100)) {
      setError("Percent complete must be between 0 and 100.");
      return;
    }

    if (!budgetEdited && !percentEdited) {
      setMessage("Nothing changed, so nothing was saved.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/records/${deliverableId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordType: "deliverable",
          // The route's deliverable branch requires a status. This re-asserts
          // the status the server last rendered rather than inventing one, so
          // saving a budget never silently advances or reverts the lane.
          status: currentStatus,
          ...(budgetEdited ? { budgetAmount: parsedBudget.value } : {}),
          ...(percentEdited ? { percentComplete: parsedPercent.value } : {}),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update deliverable");
      }

      setMessage("Deliverable budget and progress saved.");
      // What is on screen is now what is stored, so a later save of the other
      // field must not carry this one along again.
      setBudgetEdited(false);
      setPercentEdited(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update deliverable");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <RecordStatusAdvanceButton
        projectId={projectId}
        recordId={deliverableId}
        recordType="deliverable"
        currentStatus={currentStatus}
      />
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={budgetFieldId} className="text-[0.72rem] font-medium text-muted-foreground">
            Budget (not to exceed)
          </label>
          <Input
            id={budgetFieldId}
            type="number"
            min="0"
            step="0.01"
            className="h-8 w-36 text-xs"
            value={budget}
            disabled={isSaving}
            onChange={(event) => {
              setBudget(event.target.value);
              setBudgetEdited(true);
            }}
            placeholder="Blank = none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={percentFieldId} className="text-[0.72rem] font-medium text-muted-foreground">
            Percent complete
          </label>
          <Input
            id={percentFieldId}
            type="number"
            min="0"
            max="100"
            step="1"
            className="h-8 w-32 text-xs"
            value={percentComplete}
            disabled={isSaving}
            onChange={(event) => {
              setPercentComplete(event.target.value);
              setPercentEdited(true);
            }}
            placeholder="Blank = none"
          />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={isSaving}>
          {isSaving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : (
            "Save budget & progress"
          )}
        </Button>
      </form>
      {message ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
