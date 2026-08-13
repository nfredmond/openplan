"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/money/format";

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
 * create and inline edit for each; there are no separate pages for these
 * records.
 *
 * THE EDIT HALF WAS MISSING UNTIL 2026-08-12. `PATCH
 * /api/invoicing/staff/[staffId]` and `PATCH
 * /api/invoicing/rate-tables/[rateTableId]` were both built — the rate-table one
 * replacing a whole entry set with a compensating rollback if the insert fails —
 * and neither had a caller anywhere in the product. A firm could add a person
 * and a price and then never change either: a departing staff member stayed
 * Active forever, and next year's rates needed a second table with a
 * near-identical name. Both are the ordinary yearly act of a consultancy, so the
 * controls belong here, next to the listing where the stale value is visible.
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
              <StaffRowEditor key={member.id} workspaceId={workspaceId} canWrite={canWrite} member={member} />
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
              <RateTableRowEditor
                key={table.id}
                workspaceId={workspaceId}
                canWrite={canWrite}
                table={table}
                engagements={engagements}
              />
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

/** Shared PATCH shape for both editors: send the change, surface the server's own words. */
async function patchJson(url: string, body: Record<string, unknown>, fallback: string): Promise<void> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { error?: string; details?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.details || payload?.error || fallback);
  }
}

/**
 * One staff row, with the two changes a firm actually makes: correcting how the
 * person is recorded, and retiring them. Retiring is a status change rather than
 * a delete — their logged time is on invoices already, and a roster that can
 * lose a name loses the person behind a billed hour.
 */
function StaffRowEditor({
  workspaceId,
  canWrite,
  member,
}: {
  workspaceId: string;
  canWrite: boolean;
  member: StaffRow;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(member.name);
  const [title, setTitle] = useState(member.title ?? "");
  const [category, setCategory] = useState(member.defaultLaborCategory ?? "");
  const [busy, setBusy] = useState<"save" | "active" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "save" | "active", body: Record<string, unknown>) {
    setError(null);
    setBusy(kind);
    try {
      await patchJson(`/api/invoicing/staff/${member.id}`, { workspaceId, ...body }, "Could not save this staff record.");
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this staff record.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="border border-border/50 bg-background/80 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{member.name}</p>
          <p className="text-xs text-muted-foreground">
            {member.title ?? "No title"}
            {member.defaultLaborCategory ? ` · ${member.defaultLaborCategory}` : " · No default labor category"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={member.active ? "success" : "neutral"}>
            {member.active ? "Active" : "Inactive"}
          </StatusBadge>
          {canWrite && !open ? (
            <>
              <button type="button" className="openplan-inline-label" onClick={() => setOpen(true)}>
                Edit
              </button>
              <button
                type="button"
                className="openplan-inline-label openplan-inline-label-muted"
                onClick={() => void run("active", { active: !member.active })}
                disabled={busy === "active"}
              >
                {member.active ? "Retire" : "Reinstate"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {canWrite && open ? (
        <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
          <div className="grid gap-2 md:grid-cols-3">
            <Input aria-label={`Name for ${member.name}`} value={name} onChange={(event) => setName(event.target.value)} />
            <Input
              aria-label={`Title for ${member.name}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
            />
            <Input
              aria-label={`Default labor category for ${member.name}`}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Default labor category"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={busy === "save" || name.trim() === ""}
              onClick={() =>
                void run("save", {
                  name: name.trim(),
                  title: title.trim() === "" ? null : title.trim(),
                  defaultLaborCategory: category.trim() === "" ? null : category.trim(),
                })
              }
            >
              {busy === "save" ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </span>
              ) : (
                "Save staff record"
              )}
            </Button>
            <button
              type="button"
              className="openplan-inline-label openplan-inline-label-muted"
              onClick={() => {
                setOpen(false);
                setError(null);
                setName(member.name);
                setTitle(member.title ?? "");
                setCategory(member.defaultLaborCategory ?? "");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-1 text-xs text-red-700 dark:text-red-200">{error}</p> : null}
    </li>
  );
}

/**
 * One rate table, repriceable in place.
 *
 * The entry list sent on save REPLACES the table's whole entry set — that is the
 * route's contract, and it is why the editor opens pre-filled with every current
 * category rather than empty: saving a partially-typed list would silently
 * delete the categories left out. Removing a row here is therefore how a
 * category is dropped, and the button says so.
 */
function RateTableRowEditor({
  workspaceId,
  canWrite,
  table,
  engagements,
}: {
  workspaceId: string;
  canWrite: boolean;
  table: RateTableRow;
  engagements: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(table.name);
  const [engagementId, setEngagementId] = useState(table.engagementId ?? "");
  const [drafts, setDrafts] = useState<RateEntryDraft[]>(
    table.entries.map((entry, index) => ({
      key: index,
      laborCategory: entry.laborCategory,
      hourlyRate: String(entry.hourlyRate),
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setError(null);
    setName(table.name);
    setEngagementId(table.engagementId ?? "");
    setDrafts(
      table.entries.map((entry, index) => ({
        key: index,
        laborCategory: entry.laborCategory,
        hourlyRate: String(entry.hourlyRate),
      }))
    );
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await patchJson(
        `/api/invoicing/rate-tables/${table.id}`,
        {
          workspaceId,
          name: name.trim(),
          engagementId: engagementId === "" ? null : engagementId,
          entries: drafts
            .filter((draft) => draft.laborCategory.trim() !== "" && draft.hourlyRate !== "")
            .map((draft) => ({ laborCategory: draft.laborCategory.trim(), hourlyRate: Number(draft.hourlyRate) })),
        },
        "Could not save this rate table."
      );
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this rate table.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border border-border/50 bg-background/80 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{table.name}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={table.engagementId ? "info" : "neutral"}>
            {table.engagementId ? `Engagement: ${table.engagementTitle ?? "Unknown"}` : "Workspace default"}
          </StatusBadge>
          {canWrite && !open ? (
            <button type="button" className="openplan-inline-label" onClick={() => setOpen(true)}>
              Reprice
            </button>
          ) : null}
        </div>
      </div>

      {table.entries.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">No labor categories priced yet.</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          {table.entries
            .map((entry) => `${entry.laborCategory} ${formatMoney(entry.hourlyRate, { precision: "cents" })}/hr`)
            .join(" · ")}
        </p>
      )}

      {canWrite && open ? (
        <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              aria-label={`Name for ${table.name}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <select
              aria-label={`Engagement scope for ${table.name}`}
              className="module-select"
              value={engagementId}
              onChange={(event) => setEngagementId(event.target.value)}
            >
              <option value="">Workspace default table</option>
              {engagements.map((engagement) => (
                <option key={engagement.id} value={engagement.id}>
                  {engagement.title}
                </option>
              ))}
            </select>
          </div>
          {drafts.map((draft, index) => (
            <div key={draft.key} className="grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
              <Input
                aria-label={`Labor category ${index + 1} in ${table.name}`}
                value={draft.laborCategory}
                onChange={(event) =>
                  setDrafts((current) =>
                    current.map((row) => (row.key === draft.key ? { ...row, laborCategory: event.target.value } : row))
                  )
                }
                placeholder="Labor category"
              />
              <Input
                aria-label={`Hourly rate ${index + 1} in ${table.name}`}
                type="number"
                min="0"
                step="0.01"
                value={draft.hourlyRate}
                onChange={(event) =>
                  setDrafts((current) =>
                    current.map((row) => (row.key === draft.key ? { ...row, hourlyRate: event.target.value } : row))
                  )
                }
                placeholder="Hourly rate"
              />
              <button
                type="button"
                className="openplan-inline-label openplan-inline-label-muted"
                onClick={() => setDrafts((current) => current.filter((row) => row.key !== draft.key))}
              >
                Drop category
              </button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Saving replaces this table&rsquo;s whole price list with the categories shown here.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="openplan-inline-label"
              onClick={() =>
                setDrafts((current) => [
                  ...current,
                  { key: (current[current.length - 1]?.key ?? -1) + 1, laborCategory: "", hourlyRate: "" },
                ])
              }
            >
              Add category
            </button>
            <Button type="button" size="sm" disabled={busy || name.trim() === ""} onClick={() => void save()}>
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </span>
              ) : (
                "Save rate table"
              )}
            </Button>
            <button type="button" className="openplan-inline-label openplan-inline-label-muted" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-1 text-xs text-red-700 dark:text-red-200">{error}</p> : null}
    </li>
  );
}
