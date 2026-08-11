"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEPARTED_ASSIGNEE_SENTENCE } from "@/lib/workspaces/roster";

/**
 * Pick a teammate to assign work to — deliverables, milestones, submittals,
 * issues. Sits BESIDE the free-text owner label, never replacing it: the label
 * is the external-party lane (consultants, partner agencies), this picker is
 * the accountable-teammate lane.
 *
 * Three honesty rules this component enforces on itself:
 * - A failed roster load renders as a failure with a retry, never as an empty
 *   team — an empty select would claim "you have no teammates".
 * - An assignee who has left the workspace renders the shared departed
 *   sentence, never a stale name and never a blank. The current value is kept
 *   selectable so an untouched form does not silently rewrite the record.
 * - The picker never invents an assignee: no default selection, and clearing
 *   is an explicit "Unassigned" choice.
 */

type RosterOption = {
  userId: string;
  email: string | null;
  role: string;
};

const UNASSIGNED_VALUE = "";

type AssigneePickerProps = {
  workspaceId: string;
  /** The currently assigned user id, or null for unassigned. */
  value: string | null;
  onChange: (assigneeUserId: string | null) => void;
  id?: string;
  disabled?: boolean;
  /** Accessible name; also used in the failure sentence. Defaults to "Assignee". */
  label?: string;
};

export function AssigneePicker({
  workspaceId,
  value,
  onChange,
  id,
  disabled,
  label = "Assignee",
}: AssigneePickerProps) {
  const [members, setMembers] = useState<RosterOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/workspaces/roster?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (!res.ok) {
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? "Failed to load the team roster"
        );
      }
      const body = await res.json();
      setMembers(Array.isArray(body.members) ? (body.members as RosterOption[]) : []);
      setLoadError(null);
    } catch (error) {
      // Read-failure ≠ empty: keep members null so the select below cannot
      // render an empty roster as if the team were empty.
      setMembers(null);
      setLoadError(error instanceof Error ? error.message : "Failed to load the team roster");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load the team roster, so {label.toLowerCase()} can&apos;t be chosen right
          now — that&apos;s a loading problem, not an empty team. ({loadError})
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  if (members === null) {
    return (
      <select
        id={id}
        aria-label={label}
        disabled
        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground"
      >
        <option>{loading ? "Loading team…" : "Team not loaded"}</option>
      </select>
    );
  }

  // A recorded assignee who is no longer on the roster: keep the value
  // selectable under the honest departed sentence so rendering the form does
  // not silently change the record.
  const departed = value !== null && !members.some((member) => member.userId === value);

  return (
    <select
      id={id}
      aria-label={label}
      disabled={disabled}
      value={value ?? UNASSIGNED_VALUE}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next === UNASSIGNED_VALUE ? null : next);
      }}
      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
    >
      <option value={UNASSIGNED_VALUE}>Unassigned</option>
      {departed && value !== null ? (
        <option value={value}>{DEPARTED_ASSIGNEE_SENTENCE}</option>
      ) : null}
      {members.map((member) => (
        <option key={member.userId} value={member.userId}>
          {member.email ?? "Member (email unavailable)"} ({member.role})
        </option>
      ))}
    </select>
  );
}
