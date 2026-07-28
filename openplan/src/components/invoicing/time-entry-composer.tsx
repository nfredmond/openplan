"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TimeEntryComposerProps = {
  workspaceId: string;
  canWrite: boolean;
  staff: Array<{ id: string; name: string; defaultLaborCategory: string | null }>;
  engagements: Array<{ id: string; title: string; projectId: string | null }>;
  deliverables: Array<{ id: string; projectId: string; title: string }>;
};

/**
 * Logs one time entry into the ledger draft invoice lines are pulled from.
 * The labor category defaults from the staff member's own default; the server
 * applies the same fallback when the field is left blank.
 */
export function TimeEntryComposer({
  workspaceId,
  canWrite,
  staff,
  engagements,
  deliverables,
}: TimeEntryComposerProps) {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [engagementId, setEngagementId] = useState("");
  const [deliverableId, setDeliverableId] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [hours, setHours] = useState("");
  const [billable, setBillable] = useState(true);
  const [laborCategory, setLaborCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedStaff = staff.find((member) => member.id === staffId) ?? null;
  const selectedEngagement = engagements.find((engagement) => engagement.id === engagementId) ?? null;
  const visibleDeliverables = useMemo(
    () =>
      deliverables.filter(
        (deliverable) => selectedEngagement?.projectId && deliverable.projectId === selectedEngagement.projectId
      ),
    [deliverables, selectedEngagement]
  );

  if (!canWrite) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/invoicing/time-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          staffId,
          engagementId,
          deliverableId: deliverableId || undefined,
          entryDate,
          hours: Number(hours),
          billable,
          laborCategory: laborCategory || undefined,
          notes: notes || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to log time entry");
      }

      setHours("");
      setNotes("");
      setMessage("Time entry logged.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to log time entry");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="space-y-3 border border-border/60 bg-background/70 px-4 py-4" onSubmit={handleSubmit}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Log time</p>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="time-entry-staff" className="text-sm font-medium">
            Staff
          </label>
          <select
            id="time-entry-staff"
            className="module-select"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
            required
          >
            <option value="">Choose staff</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="time-entry-engagement" className="text-sm font-medium">
            Engagement
          </label>
          <select
            id="time-entry-engagement"
            className="module-select"
            value={engagementId}
            onChange={(event) => {
              setEngagementId(event.target.value);
              setDeliverableId("");
            }}
            required
          >
            <option value="">Choose engagement</option>
            {engagements.map((engagement) => (
              <option key={engagement.id} value={engagement.id}>
                {engagement.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="time-entry-deliverable" className="text-sm font-medium">
            Deliverable
          </label>
          <select
            id="time-entry-deliverable"
            className="module-select"
            value={deliverableId}
            onChange={(event) => setDeliverableId(event.target.value)}
            disabled={visibleDeliverables.length === 0}
          >
            <option value="">
              {visibleDeliverables.length === 0 ? "No project deliverables" : "No linked deliverable"}
            </option>
            {visibleDeliverables.map((deliverable) => (
              <option key={deliverable.id} value={deliverable.id}>
                {deliverable.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor="time-entry-date" className="text-sm font-medium">
            Date
          </label>
          <Input id="time-entry-date" type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="time-entry-hours" className="text-sm font-medium">
            Hours
          </label>
          <Input
            id="time-entry-hours"
            type="number"
            min="0.01"
            max="24"
            step="0.01"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="time-entry-category" className="text-sm font-medium">
            Labor category
          </label>
          <Input
            id="time-entry-category"
            value={laborCategory}
            onChange={(event) => setLaborCategory(event.target.value)}
            placeholder={selectedStaff?.defaultLaborCategory ?? "Staff default applies"}
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Billable</span>
          <label htmlFor="time-entry-billable" className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
            <input
              id="time-entry-billable"
              type="checkbox"
              checked={billable}
              onChange={(event) => setBillable(event.target.checked)}
            />
            Counts toward invoices
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="time-entry-notes" className="text-sm font-medium">
          Notes
        </label>
        <Textarea id="time-entry-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {message ? (
        <p className="border-l-2 border-emerald-400 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="border-l-2 border-red-400 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isSaving}>
        {isSaving ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Logging…
          </span>
        ) : (
          "Log time entry"
        )}
      </Button>
    </form>
  );
}
