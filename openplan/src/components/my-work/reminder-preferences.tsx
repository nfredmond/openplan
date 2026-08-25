"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { WorkspaceReminderPreference } from "@/lib/notifications/reminder-preferences";

export function ReminderPreferencesPanel({
  preference,
  canManage,
}: {
  preference: WorkspaceReminderPreference;
  canManage: boolean;
}) {
  const router = useRouter();
  const [advanceDays, setAdvanceDays] = useState(preference.advanceDays);
  const [emailDigestEnabled, setEmailDigestEnabled] = useState(preference.emailDigestEnabled);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/workspaces/reminder-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: preference.workspaceId, advanceDays, emailDigestEnabled }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Preferences were not saved");
      setStatus("Reminder preferences saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Preferences were not saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="module-section-surface" data-testid="reminder-preferences">
      <h2 className="module-section-title">Reminder preferences</h2>
      <p className="module-note">In-app reminders always stay on. Choose how far ahead they appear and whether OpenPlan also prepares an email digest.</p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Advance window</span>
          <input className="w-28 rounded-md border border-input bg-background px-3 py-2 text-sm" type="number" min={1} max={30} value={advanceDays} disabled={!canManage || busy} onChange={(event) => setAdvanceDays(Number(event.target.value))} />
          <span className="block text-xs text-muted-foreground">1 to 30 days; overdue work is always included.</span>
        </label>
        <label className="flex items-center gap-2 pb-6 text-sm">
          <input type="checkbox" checked={emailDigestEnabled} disabled={!canManage || busy} onChange={(event) => setEmailDigestEnabled(event.target.checked)} />
          Prepare email digests when email transport exists
        </label>
        {canManage ? <Button className="mb-5" type="button" disabled={busy || advanceDays < 1 || advanceDays > 30} onClick={() => void save()}>{busy ? "Saving…" : "Save preferences"}</Button> : null}
      </div>
      {!canManage ? <p className="text-xs text-muted-foreground">Only owners and admins can change these settings.</p> : null}
      {status ? <p className="mt-2 text-sm" role="status">{status}</p> : null}
    </article>
  );
}
