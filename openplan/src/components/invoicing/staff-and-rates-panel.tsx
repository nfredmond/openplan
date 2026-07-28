"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type StaffRow = {
  id: string;
  name: string;
  title: string | null;
  defaultLaborCategory: string | null;
  active: boolean;
};

type RateTableRow = {
  id: string;
  name: string;
  engagementId: string | null;
  engagementTitle: string | null;
  entries: Array<{ laborCategory: string; hourlyRate: number }>;
};

type StaffAndRatesPanelProps = {
  workspaceId: string;
  canWrite: boolean;
  staff: StaffRow[];
  rateTables: RateTableRow[];
  engagements: Array<{ id: string; title: string }>;
};

type RateEntryDraft = { key: number; laborCategory: string; hourlyRate: string };

/**
 * Compact management of the two lookup sets behind time billing: the staff
 * roster and the rate tables. Deliberately minimal — a listing plus inline
 * create for each; there are no separate pages for these records.
 */
export function StaffAndRatesPanel({
  workspaceId,
  canWrite,
  staff,
  rateTables,
  engagements,
}: StaffAndRatesPanelProps) {
  const router = useRouter();
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [staffTitle, setStaffTitle] = useState("");
  const [staffCategory, setStaffCategory] = useState("");
  const [tableOpen, setTableOpen] = useState(false);
  const [tableName, setTableName] = useState("");
  const [tableEngagementId, setTableEngagementId] = useState("");
  const [entryDrafts, setEntryDrafts] = useState<RateEntryDraft[]>([{ key: 0, laborCategory: "", hourlyRate: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"staff" | "table" | null>(null);

  async function handleCreateStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving("staff");
    try {
      const response = await fetch("/api/invoicing/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: staffName,
          title: staffTitle || undefined,
          defaultLaborCategory: staffCategory || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to create staff record");
      }
      setStaffName("");
      setStaffTitle("");
      setStaffCategory("");
      setStaffOpen(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create staff record");
    } finally {
      setSaving(null);
    }
  }

  async function handleCreateRateTable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const entries = entryDrafts
      .filter((draft) => draft.laborCategory.trim() && draft.hourlyRate !== "")
      .map((draft) => ({ laborCategory: draft.laborCategory.trim(), hourlyRate: Number(draft.hourlyRate) }));

    setSaving("table");
    try {
      const response = await fetch("/api/invoicing/rate-tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: tableName,
          engagementId: tableEngagementId || undefined,
          entries: entries.length > 0 ? entries : undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to create rate table");
      }
      setTableName("");
      setTableEngagementId("");
      setEntryDrafts([{ key: 0, laborCategory: "", hourlyRate: "" }]);
      setTableOpen(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create rate table");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 border border-border/60 bg-background/70 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Staff</p>
          {canWrite && !staffOpen ? (
            <button type="button" className="openplan-inline-label" onClick={() => setStaffOpen(true)}>
              Add staff
            </button>
          ) : null}
        </div>

        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff recorded yet. Staff need not be OpenPlan users.</p>
        ) : (
          <ul className="space-y-2">
            {staff.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 border border-border/50 bg-background/80 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{member.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.title ?? "No title"}
                    {member.defaultLaborCategory ? ` · ${member.defaultLaborCategory}` : " · No default labor category"}
                  </p>
                </div>
                <StatusBadge tone={member.active ? "success" : "neutral"}>
                  {member.active ? "Active" : "Inactive"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}

        {canWrite && staffOpen ? (
          <form className="space-y-2 border-t border-border/50 pt-3" onSubmit={handleCreateStaff}>
            <div className="grid gap-2 md:grid-cols-3">
              <Input
                aria-label="Staff name"
                value={staffName}
                onChange={(event) => setStaffName(event.target.value)}
                placeholder="Name"
                required
              />
              <Input
                aria-label="Staff title"
                value={staffTitle}
                onChange={(event) => setStaffTitle(event.target.value)}
                placeholder="Title"
              />
              <Input
                aria-label="Default labor category"
                value={staffCategory}
                onChange={(event) => setStaffCategory(event.target.value)}
                placeholder="Default labor category"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="sm" disabled={saving === "staff"}>
                {saving === "staff" ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </span>
                ) : (
                  "Create staff record"
                )}
              </Button>
              <button
                type="button"
                className="openplan-inline-label openplan-inline-label-muted"
                onClick={() => setStaffOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>

      <div className="space-y-3 border border-border/60 bg-background/70 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Rate tables</p>
          {canWrite && !tableOpen ? (
            <button type="button" className="openplan-inline-label" onClick={() => setTableOpen(true)}>
              Add rate table
            </button>
          ) : null}
        </div>

        {rateTables.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rate tables yet. Without one, pulled time has no price and every line needs a manual amount.
          </p>
        ) : (
          <ul className="space-y-2">
            {rateTables.map((table) => (
              <li key={table.id} className="border border-border/50 bg-background/80 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{table.name}</p>
                  <StatusBadge tone={table.engagementId ? "info" : "neutral"}>
                    {table.engagementId ? `Engagement: ${table.engagementTitle ?? "Unknown"}` : "Workspace default"}
                  </StatusBadge>
                </div>
                {table.entries.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No labor categories priced yet.</p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {table.entries
                      .map((entry) => `${entry.laborCategory} ${formatCurrency(entry.hourlyRate)}/hr`)
                      .join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {canWrite && tableOpen ? (
          <form className="space-y-2 border-t border-border/50 pt-3" onSubmit={handleCreateRateTable}>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                aria-label="Rate table name"
                value={tableName}
                onChange={(event) => setTableName(event.target.value)}
                placeholder="Table name"
                required
              />
              <select
                aria-label="Rate table engagement scope"
                className="module-select"
                value={tableEngagementId}
                onChange={(event) => setTableEngagementId(event.target.value)}
              >
                <option value="">Workspace default table</option>
                {engagements.map((engagement) => (
                  <option key={engagement.id} value={engagement.id}>
                    {engagement.title}
                  </option>
                ))}
              </select>
            </div>
            {entryDrafts.map((draft, index) => (
              <div key={draft.key} className="grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                <Input
                  aria-label={`Labor category ${index + 1}`}
                  value={draft.laborCategory}
                  onChange={(event) =>
                    setEntryDrafts((current) =>
                      current.map((row) => (row.key === draft.key ? { ...row, laborCategory: event.target.value } : row))
                    )
                  }
                  placeholder="Labor category"
                />
                <Input
                  aria-label={`Hourly rate ${index + 1}`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.hourlyRate}
                  onChange={(event) =>
                    setEntryDrafts((current) =>
                      current.map((row) => (row.key === draft.key ? { ...row, hourlyRate: event.target.value } : row))
                    )
                  }
                  placeholder="Hourly rate"
                />
                <button
                  type="button"
                  className="openplan-inline-label openplan-inline-label-muted"
                  onClick={() =>
                    setEntryDrafts((current) =>
                      current.length > 1 ? current.filter((row) => row.key !== draft.key) : current
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="openplan-inline-label"
                onClick={() =>
                  setEntryDrafts((current) => [
                    ...current,
                    { key: (current[current.length - 1]?.key ?? 0) + 1, laborCategory: "", hourlyRate: "" },
                  ])
                }
              >
                Add category
              </button>
              <Button type="submit" size="sm" disabled={saving === "table"}>
                {saving === "table" ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </span>
                ) : (
                  "Create rate table"
                )}
              </Button>
              <button
                type="button"
                className="openplan-inline-label openplan-inline-label-muted"
                onClick={() => setTableOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>

      {error ? (
        <p className="border-l-2 border-red-400 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200 lg:col-span-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
