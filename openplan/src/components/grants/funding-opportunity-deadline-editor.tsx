"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canAccessWorkspaceAction, normalizeWorkspaceRole } from "@/lib/auth/role-matrix";
import {
  GRANT_DEADLINE_FIELDS,
  browserDeadlineTimeZone,
  grantDeadlineDraft,
  grantDeadlinePatch,
  type RecordedGrantDeadlines,
} from "@/lib/grants/deadline-edit";

type Props = RecordedGrantDeadlines & { opportunityId: string; workspaceId: string };

/** A changed record or refreshed date snapshot starts a separate editing session. */
export function FundingOpportunityDeadlineEditor(props: Props) {
  return <DeadlineRecord key={JSON.stringify([props.opportunityId, props.workspaceId, props.closesAt, props.decisionDueAt])} {...props} />;
}

function DeadlineRecord(props: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<RecordedGrantDeadlines>({ closesAt: props.closesAt, decisionDueAt: props.decisionDueAt });
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <details className="mt-4" open={open}>
        <summary className="cursor-pointer text-sm font-semibold text-foreground" onClick={(event) => {
          event.preventDefault();
          if (!busy) { setMessage(null); setOpen(!open); }
        }}>Edit recorded dates</summary>
        {open ? <DeadlineForm {...props} {...recorded} onBusy={setBusy} onCancel={() => setOpen(false)} onSaved={(values) => {
          setRecorded(values); setBusy(false); setOpen(false); setMessage("Recorded dates saved.");
        }} /> : null}
      </details>
      {message ? <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
    </>
  );
}

function DeadlineForm({ opportunityId, workspaceId, closesAt, decisionDueAt, onBusy, onCancel, onSaved }: Props & {
  onBusy: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: (recorded: RecordedGrantDeadlines) => void;
}) {
  const router = useRouter();
  const alive = useRef(true);
  const [initial] = useState(() => {
    try {
      const zone = browserDeadlineTimeZone();
      if (!zone) throw new Error("The browser time zone could not be read. Reopen the editor to try again.");
      return { zone, draft: grantDeadlineDraft({ closesAt, decisionDueAt }, zone), error: null };
    } catch (error) {
      return { zone: null, draft: { closesAt: "", decisionDueAt: "" }, error: error instanceof Error ? error.message : "Recorded dates could not be read." };
    }
  });
  const [draft, setDraft] = useState(initial.draft);
  const [error, setError] = useState<string | null>(initial.error);
  const [access, setAccess] = useState<"checking" | "write" | "readOnly" | "unavailable">(initial.error ? "unavailable" : "checking");
  const [saving, setSaving] = useState(false);
  const [badInput, setBadInput] = useState({ closesAt: false, decisionDueAt: false });

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    if (initial.zone) void (async () => {
      try {
        const response = await fetch("/api/workspaces/current", { cache: "no-store" });
        const body = await response.json().catch(() => null) as { workspaceId?: unknown; role?: unknown; error?: unknown } | null;
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Workspace permissions could not be read. Reopen the editor to try again.");
        if (body?.workspaceId !== workspaceId) throw new Error("This opportunity belongs to a different workspace. Reload its Grants page before editing.");
        const role = typeof body.role === "string" ? normalizeWorkspaceRole(body.role) : null;
        if (!role) throw new Error("Workspace permissions could not be read. Reopen the editor to try again.");
        if (!cancelled && alive.current) setAccess(canAccessWorkspaceAction("programs.write", role) ? "write" : "readOnly");
      } catch (cause) {
        if (!cancelled && alive.current) { setAccess("unavailable"); setError(cause instanceof Error ? cause.message : "Workspace permissions could not be read."); }
      }
    })();
    return () => { cancelled = true; alive.current = false; };
  }, [initial.zone, workspaceId]);

  async function save() {
    if (access !== "write" || saving || !initial.zone) return;
    setError(null);
    try {
      if (browserDeadlineTimeZone() !== initial.zone) throw new Error("The browser time zone changed. Cancel and reopen before saving dates.");
      if (Object.values(badInput).some(Boolean)) throw new Error("Complete the local date and time, or clear the whole field.");
      const patch = grantDeadlinePatch({ closesAt, decisionDueAt }, draft, initial.zone);
      if (Object.keys(patch).length === 0) return;
      setSaving(true); onBusy(true);
      const response = await fetch(`/api/funding-opportunities/${encodeURIComponent(opportunityId)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => null) as { error?: unknown; opportunity?: { id?: unknown; workspace_id?: unknown; closes_at?: unknown; decision_due_at?: unknown } } | null;
      if (!alive.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setAccess("readOnly");
        throw new Error(typeof body?.error === "string" ? body.error : "Recorded dates could not be saved. Your entries remain here.");
      }
      const row = body?.opportunity;
      if (row?.id !== opportunityId || row.workspace_id !== workspaceId ||
        !(row.closes_at === null || typeof row.closes_at === "string") ||
        !(row.decision_due_at === null || typeof row.decision_due_at === "string")) {
        throw new Error("Saved dates could not be confirmed for this opportunity. Your entries remain here.");
      }
      const recorded = { closesAt: row.closes_at, decisionDueAt: row.decision_due_at };
      grantDeadlineDraft(recorded, initial.zone);
      router.refresh(); onSaved(recorded);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "The save could not be confirmed. Your entries remain here.");
    } finally {
      if (alive.current) { setSaving(false); onBusy(false); }
    }
  }

  const changed = GRANT_DEADLINE_FIELDS.some(({ name }) => draft[name] !== initial.draft[name]);
  return (
    <div className="mt-3 space-y-3 rounded-[0.5rem] border border-border p-4">
      <p className="text-sm text-muted-foreground">These dates are saved in OpenPlan. They do not confirm that the funder amended its notice. Check the official notice before relying on them.</p>
      <p className="text-sm">Browser time zone: {initial.zone ?? "unavailable"}. Enter local times to the minute. Unchanged dates keep their original precision. When clocks repeat an hour, edits use its first occurrence.</p>
      <dl className="space-y-1 text-sm">
        <div><dt className="font-semibold">Saved application closing</dt><dd className="break-all">{closesAt ?? "Not recorded"}</dd></div>
        <div><dt className="font-semibold">Saved pursue-or-skip decision</dt><dd className="break-all">{decisionDueAt ?? "Not recorded"}</dd></div>
      </dl>
      {access === "checking" ? <p role="status">Checking your permission to edit dates.</p> : null}
      {access === "readOnly" ? <p role="status">Your current access does not allow date changes.</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {GRANT_DEADLINE_FIELDS.map(({ name, label }) => (
          <div key={name} className="min-w-0 space-y-1.5">
            <label htmlFor={`grant-deadline-${opportunityId}-${name}`} className="text-sm font-semibold">{label}</label>
            <Input id={`grant-deadline-${opportunityId}-${name}`} type="datetime-local" step="60" value={draft[name]}
              disabled={access !== "write" || saving} onChange={(event) => {
                setDraft({ ...draft, [name]: event.target.value });
                setBadInput({ ...badInput, [name]: event.target.validity.badInput }); setError(null);
              }} />
          </div>
        ))}
      </div>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={access !== "write" || saving || !changed} onClick={() => void save()}>{saving ? "Saving dates…" : "Save dates"}</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
