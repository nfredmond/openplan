"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SCENARIO_ASSUMPTION_SET_STATUSES,
  SCENARIO_DATA_PACKAGE_STATUSES,
  SCENARIO_DATA_PACKAGE_TYPES,
} from "@/lib/scenarios/catalog";

/**
 * THE SCENARIO SPINE, WHICH HAD BEEN BUILT AND NEVER SHOWN.
 *
 * A scenario set carries four kinds of record besides its entries: the
 * ASSUMPTIONS a branch is built on, the DATA PACKAGES those assumptions were
 * derived from, the INDICATOR SNAPSHOTS taken against them, and the COMPARISON
 * SNAPSHOTS that read two branches against each other. Together they are what
 * lets a comparison be defended a year later — the difference between "this
 * scenario shows 12% lower VMT" and "this scenario, on these assumptions, from
 * this data, measured this way, shows 12% lower VMT."
 *
 * Comparison snapshots had a surface. The other three had complete, tested,
 * access-gated POST routes that nothing called, and the summary GET that returns
 * all four was equally dark — so three of the four columns of the provenance
 * chain could not be created or read by any person using OpenPlan. The tables
 * existed and stayed empty, which reads as "this agency recorded no assumptions"
 * rather than "OpenPlan never offered to record any."
 *
 * A PENDING MIGRATION IS NOT AN EMPTY SPINE, and the route already draws that
 * distinction — `schemaPending` comes back true when the spine tables are not
 * there yet, with zeroed counts rather than an error. Rendering that as "no
 * assumption sets" would tell a planner something false about their own
 * workspace, so it is said plainly and the forms come off: there is nothing to
 * write to.
 *
 * WHY EVERY LIST IS READ BACK FROM THE SERVER AFTER A WRITE rather than
 * optimistically appended. Each create route resolves `scenarioEntryId` against
 * the set and can attach the record to the baseline when none is given, so the
 * stored row is not always the row that was submitted. Showing the submitted one
 * would misreport what was saved at the exact moment a planner is deciding
 * whether it was saved correctly.
 */

type SpineEntrySummary = {
  id: string;
  label: string;
  summary: string | null;
  status: string;
  attachedRunId: string | null;
  assumptionCount: number;
} | null;

type AssumptionSetRow = {
  id: string;
  scenario_entry_id: string | null;
  label: string;
  summary: string | null;
  status: string;
  updated_at: string;
};

type DataPackageRow = {
  id: string;
  scenario_entry_id: string | null;
  label: string;
  package_type: string;
  source_url: string | null;
  storage_path: string | null;
  status: string;
  updated_at: string;
};

type IndicatorSnapshotRow = {
  id: string;
  scenario_entry_id: string | null;
  indicator_key: string;
  indicator_label: string;
  unit_label: string | null;
  geography_label: string | null;
  source_label: string | null;
  snapshot_at: string | null;
};

type SpineResponse = {
  baseline: SpineEntrySummary;
  branches: SpineEntrySummary[];
  counts: {
    assumptionSets: number;
    dataPackages: number;
    indicatorSnapshots: number;
    comparisonSnapshots: number;
  };
  assumptionSets: AssumptionSetRow[];
  dataPackages: DataPackageRow[];
  indicatorSnapshots: IndicatorSnapshotRow[];
  schemaPending: boolean;
};

type FormKind = "assumption" | "package" | "indicator";

const FIELD_CLASS =
  "w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm text-foreground";


/**
 * HOISTED TO MODULE SCOPE, and that is load-bearing rather than stylistic.
 *
 * These three were originally declared inside `ScenarioSpinePanel`. A component
 * defined inside another component is a NEW type on every render, so React
 * unmounts and remounts it whenever any state changes — and every uncontrolled
 * input inside it is reset. The visible symptom was a planner typing a summary,
 * pressing Save, hitting a validation error, and finding the form empty. Losing
 * a paragraph at the moment you are told to fix it is the worst possible time.
 */
function EntrySelect({ entries }: { entries: NonNullable<SpineEntrySummary>[] }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      <span>Scenario</span>
      <select name="scenarioEntryId" className={FIELD_CLASS} defaultValue="">
        {/* Empty attaches to the set's baseline, which is what the route does
            with no entry — said here rather than left as a silent default. */}
        <option value="">Baseline</option>
        {entries.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FormShell({
  open,
  saving,
  saveError,
  onSubmit,
  onCancel,
  children,
}: {
  open: boolean;
  saving: boolean;
  saveError: string | null;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3 rounded-md border border-border/60 p-3">
      {children}
      {saveError ? (
        <p role="alert" className="text-xs text-amber-800 dark:text-amber-200">
          {saveError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-semibold text-background disabled:opacity-50"
        >
          {saving ? "Saving\u2026" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border/70 px-3 py-1.5 text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  count,
  canWrite,
  open,
  onToggle,
  children,
  formFields,
  formProps,
}: {
  title: string;
  description: string;
  count: number;
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  formFields: React.ReactNode;
  formProps: Omit<React.ComponentProps<typeof FormShell>, "open" | "children">;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-background/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {title} <span className="font-normal text-muted-foreground">({count})</span>
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={onToggle}
            className="shrink-0 rounded-md border border-border/70 px-2.5 py-1 text-xs font-semibold"
          >
            {open ? "Close" : "Add"}
          </button>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
      <FormShell {...formProps} open={open}>
        {formFields}
      </FormShell>
    </section>
  );
}

export function ScenarioSpinePanel({ scenarioSetId }: { scenarioSetId: string }) {
  const [spine, setSpine] = useState<SpineResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState<FormKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(`/api/scenarios/${scenarioSetId}/spine`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setLoadError(body?.error ?? "Could not load the scenario spine.");
        return;
      }
      setSpine((await response.json()) as SpineResponse);
    } catch {
      setLoadError("Could not reach OpenPlan to load the scenario spine.");
    } finally {
      setLoading(false);
    }
  }, [scenarioSetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(kind: FormKind, payload: Record<string, unknown>) {
    const path =
      kind === "assumption"
        ? "assumption-sets"
        : kind === "package"
          ? "data-packages"
          : "indicator-snapshots";

    setSaveError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/scenarios/${scenarioSetId}/spine/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setSaveError(body?.error ?? "Could not save this record.");
        return;
      }
      setOpenForm(null);
      // Read the spine back rather than appending what was submitted — see the
      // header: the stored row is not always the row that was sent.
      await load();
    } catch {
      setSaveError("Could not reach OpenPlan. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  const entryOptions = (): NonNullable<SpineEntrySummary>[] => {
    const branches = (spine?.branches ?? []).filter(
      (entry): entry is NonNullable<SpineEntrySummary> => Boolean(entry)
    );
    return spine?.baseline ? [spine.baseline, ...branches] : branches;
  };

  // One object, spread into all three sections: the form chrome and its error
  // are shared state, so passing them separately per section is three chances
  // for them to disagree about whether a save is in flight.
  const formProps = {
    saving,
    saveError,
    onCancel: () => {
      setOpenForm(null);
      setSaveError(null);
    },
  };
  const sectionProps = (kind: FormKind) => ({
    canWrite: Boolean(spine && !spine.schemaPending),
    open: openForm === kind,
    onToggle: () => {
      setOpenForm(openForm === kind ? null : kind);
      setSaveError(null);
    },
    formProps: { ...formProps, onSubmit: submit(kind) },
  });

  function submit(kind: FormKind) {
    return (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const entryId = String(form.get("scenarioEntryId") ?? "").trim();
      const base = entryId ? { scenarioEntryId: entryId } : {};

      if (kind === "assumption") {
        void create(kind, {
          ...base,
          label: String(form.get("label") ?? "").trim(),
          summary: String(form.get("summary") ?? "").trim() || undefined,
          status: String(form.get("status") ?? "draft"),
        });
        return;
      }
      if (kind === "package") {
        void create(kind, {
          ...base,
          label: String(form.get("label") ?? "").trim(),
          packageType: String(form.get("packageType") ?? "input"),
          sourceUrl: String(form.get("sourceUrl") ?? "").trim() || undefined,
          storagePath: String(form.get("storagePath") ?? "").trim() || undefined,
          status: String(form.get("status") ?? "draft"),
        });
        return;
      }
      void create(kind, {
        ...base,
        indicatorKey: String(form.get("indicatorKey") ?? "").trim(),
        indicatorLabel: String(form.get("indicatorLabel") ?? "").trim(),
        unitLabel: String(form.get("unitLabel") ?? "").trim() || undefined,
        geographyLabel: String(form.get("geographyLabel") ?? "").trim() || undefined,
        sourceLabel: String(form.get("sourceLabel") ?? "").trim() || undefined,
      });
    };
  }

  if (loading) {
    return <p className="mt-4 text-sm text-muted-foreground">Loading the scenario spine…</p>;
  }

  if (loadError || !spine) {
    return (
      <p role="alert" className="mt-4 rounded-md border border-border/70 px-3 py-2 text-sm text-muted-foreground">
        {loadError ?? "Could not load the scenario spine."} This is a problem reading the records, not a
        statement that there are none.
      </p>
    );
  }

  const empty = (label: string) => <p className="text-xs text-muted-foreground">{label}</p>;

  return (
    <div className="space-y-4">
      {spine.schemaPending ? (
        <p className="rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          The scenario spine tables have not been created on this deployment yet, so there is nothing to
          read or write. This is a pending migration, not an empty scenario set.
        </p>
      ) : null}

      <Section
        {...sectionProps("assumption")}
        title="Assumption sets"
        description="What a branch assumes — growth rates, network changes, policy levers. A comparison that cannot name its assumptions cannot be defended."
        count={spine.counts.assumptionSets}
        formFields={
          <>
            <EntrySelect entries={entryOptions()} />
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Label</span>
              <input name="label" required maxLength={160} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Summary</span>
              <textarea name="summary" rows={2} maxLength={2000} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Status</span>
              <select name="status" className={FIELD_CLASS} defaultValue="draft">
                {SCENARIO_ASSUMPTION_SET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      >
        {spine.assumptionSets.length === 0
          ? empty("No assumption sets recorded yet.")
          : (
              <ul className="space-y-1.5 text-sm">
                {spine.assumptionSets.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-foreground">{row.label}</span>
                    <span className="text-xs text-muted-foreground">{row.status}</span>
                    {row.summary ? <span className="text-xs text-muted-foreground">— {row.summary}</span> : null}
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section
        {...sectionProps("package")}
        title="Data packages"
        description="Where the numbers came from — an input file, a reference dataset, a model output, an evidence bundle. Recorded so a reader can go back to the source."
        count={spine.counts.dataPackages}
        formFields={
          <>
            <EntrySelect entries={entryOptions()} />
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Label</span>
              <input name="label" required maxLength={160} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Type</span>
              <select name="packageType" className={FIELD_CLASS} defaultValue="input">
                {SCENARIO_DATA_PACKAGE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Source URL</span>
              <input name="sourceUrl" type="url" maxLength={500} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Storage path</span>
              <input name="storagePath" maxLength={500} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Status</span>
              <select name="status" className={FIELD_CLASS} defaultValue="draft">
                {SCENARIO_DATA_PACKAGE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      >
        {spine.dataPackages.length === 0
          ? empty("No data packages recorded yet.")
          : (
              <ul className="space-y-1.5 text-sm">
                {spine.dataPackages.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-foreground">{row.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.package_type.replaceAll("_", " ")} · {row.status}
                    </span>
                    {row.source_url ? (
                      <a
                        href={row.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline underline-offset-4"
                      >
                        source
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section
        {...sectionProps("indicator")}
        title="Indicator snapshots"
        description="A measured value at a point in time, with the geography and source it was measured against — the thing a comparison is actually comparing."
        count={spine.counts.indicatorSnapshots}
        formFields={
          <>
            <EntrySelect entries={entryOptions()} />
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Indicator key</span>
              <input name="indicatorKey" required maxLength={120} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Indicator label</span>
              <input name="indicatorLabel" required maxLength={160} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Unit</span>
              <input name="unitLabel" maxLength={80} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Geography</span>
              <input name="geographyLabel" maxLength={160} className={FIELD_CLASS} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span>Source</span>
              <input name="sourceLabel" maxLength={160} className={FIELD_CLASS} />
            </label>
          </>
        }
      >
        {spine.indicatorSnapshots.length === 0
          ? empty("No indicator snapshots recorded yet.")
          : (
              <ul className="space-y-1.5 text-sm">
                {spine.indicatorSnapshots.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-foreground">{row.indicator_label}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.unit_label ?? "no unit recorded"}
                      {row.geography_label ? ` · ${row.geography_label}` : ""}
                      {row.source_label ? ` · ${row.source_label}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
      </Section>
    </div>
  );
}
