"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  SCENARIO_ENTRY_STATUSES,
  SCENARIO_ENTRY_TYPES,
  buildScenarioComparisonSummary,
  getScenarioComparisonReadiness,
  scenarioStatusTone,
  titleizeScenarioValue,
  type ScenarioEntryStatus,
  type ScenarioEntryType,
} from "@/lib/scenarios/catalog";

type RunOption = {
  id: string;
  title: string;
  created_at: string;
};

type ScenarioEntry = {
  id: string;
  entry_type: string;
  label: string;
  summary: string | null;
  assumptions_json: Record<string, unknown>;
  attached_run_id: string | null;
  status: string;
  sort_order: number;
  updated_at: string;
  attachedRun: {
    id: string;
    title: string;
    summary_text?: string | null;
    created_at?: string | null;
  } | null;
};

type ScenarioEntryRegistryProps = {
  scenarioSetId: string;
  entries: ScenarioEntry[];
  runs: RunOption[];
  baselineEntryId: string | null;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

function ScenarioEntryCard({
  scenarioSetId,
  entry,
  runs,
  baselineEntryId,
  baselineRunId,
}: {
  scenarioSetId: string;
  entry: ScenarioEntry;
  runs: RunOption[];
  baselineEntryId: string | null;
  baselineRunId: string | null;
}) {
  const router = useRouter();
  const [entryType, setEntryType] = useState<ScenarioEntryType>(entry.entry_type as ScenarioEntryType);
  const [label, setLabel] = useState(entry.label);
  const [summary, setSummary] = useState(entry.summary ?? "");
  const [status, setStatus] = useState<ScenarioEntryStatus>(entry.status as ScenarioEntryStatus);
  const [attachedRunId, setAttachedRunId] = useState(entry.attached_run_id ?? "");
  const [sortOrder, setSortOrder] = useState(String(entry.sort_order));
  const [assumptionsText, setAssumptionsText] = useState(JSON.stringify(entry.assumptions_json ?? {}, null, 2));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assumptions = Object.entries(entry.assumptions_json ?? {});
  const comparisonReadiness =
    entry.entry_type === "alternative"
      ? getScenarioComparisonReadiness({
          baselineEntryId,
          baselineRunId,
          candidateRunId: entry.attached_run_id,
        })
      : null;

  const entryTypeOptions =
    baselineEntryId && baselineEntryId !== entry.id ? (["alternative"] as ScenarioEntryType[]) : [...SCENARIO_ENTRY_TYPES];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const assumptionsPayload = assumptionsText.trim() ? JSON.parse(assumptionsText) : {};
      const nextSortOrder = Number.parseInt(sortOrder, 10);

      if (Number.isNaN(nextSortOrder) || nextSortOrder < 0) {
        throw new Error("Sort order must be a non-negative integer");
      }

      const response = await fetch(`/api/scenarios/${scenarioSetId}/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryType,
          label,
          summary: summary || null,
          status,
          attachedRunId: attachedRunId || null,
          sortOrder: nextSortOrder,
          assumptions: assumptionsPayload,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update scenario entry");
      }

      router.refresh();
    } catch (submitError) {
      if (submitError instanceof SyntaxError) {
        setError("Assumptions must be valid JSON");
      } else {
        setError(submitError instanceof Error ? submitError.message : "Failed to update scenario entry");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="module-record-row">
      <div className="module-record-head">
        <div className="module-record-main">
          <div className="module-record-kicker">
            <StatusBadge tone={entry.entry_type === "baseline" ? "success" : "info"}>
              {titleizeScenarioValue(entry.entry_type)}
            </StatusBadge>
            <StatusBadge tone={scenarioStatusTone(entry.status)}>{titleizeScenarioValue(entry.status)}</StatusBadge>
            {comparisonReadiness ? (
              <StatusBadge tone={comparisonReadiness.tone}>{comparisonReadiness.label}</StatusBadge>
            ) : (
              <StatusBadge tone={entry.attached_run_id ? "success" : "warning"}>
                {entry.attached_run_id ? "Run attached" : "Run missing"}
              </StatusBadge>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="module-record-title text-[1.05rem]">{entry.label}</h3>
              <p className="module-record-stamp">Updated {fmtDateTime(entry.updated_at)}</p>
            </div>
            <p className="module-record-summary line-clamp-3">
              {entry.summary || "No summary yet. Add one so this entry stays decision-legible later."}
            </p>
          </div>
        </div>
      </div>

      <div className="module-record-meta">
        <span className="module-record-chip">Run {entry.attachedRun?.title ?? "Not attached"}</span>
        <span className="module-record-chip">Assumptions {assumptions.length}</span>
        <span className="module-record-chip">Sort {entry.sort_order}</span>
      </div>

      <div className="mt-4 grid gap-3 rounded-[20px] border border-border/70 bg-background/75 p-4 lg:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Evidence</p>
          <p className="mt-2 text-sm font-medium">{entry.attachedRun?.title ?? "No run attached"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {entry.attachedRun?.created_at ? `Run saved ${fmtDateTime(entry.attachedRun.created_at)}` : "Comparison stays blocked until the needed run is attached."}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Assumptions</p>
          <p className="mt-2 text-sm font-medium">
            {assumptions.length > 0 ? `${assumptions.length} explicit assumptions` : "No structured assumptions yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {assumptions.length > 0
              ? assumptions
                  .slice(0, 3)
                  .map(([key, value]) => `${key}: ${String(value)}`)
                  .join(" · ")
              : "Add JSON assumptions so reviewers can see what changed without reading prose."}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Audit note</p>
          <p className="mt-2 text-sm font-medium">
            {comparisonReadiness ? comparisonReadiness.label : entry.attached_run_id ? "Evidence attached" : "Evidence incomplete"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {comparisonReadiness?.reason || "Baseline entries still need an attached run if alternatives are going to compare against them."}
          </p>
        </div>
      </div>

      <details className="mt-4 rounded-[20px] border border-border/70 bg-background/60 p-4">
        <summary className="cursor-pointer text-sm font-semibold tracking-tight text-foreground">
          Manage entry
        </summary>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`entry-type-${entry.id}`} className="text-sm font-medium">
                Entry type
              </label>
              <select
                id={`entry-type-${entry.id}`}
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
                value={entryType}
                onChange={(event) => setEntryType(event.target.value as ScenarioEntryType)}
              >
                {entryTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {titleizeScenarioValue(option)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`entry-status-${entry.id}`} className="text-sm font-medium">
                Entry status
              </label>
              <select
                id={`entry-status-${entry.id}`}
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
                value={status}
                onChange={(event) => setStatus(event.target.value as ScenarioEntryStatus)}
              >
                {SCENARIO_ENTRY_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {titleizeScenarioValue(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <label htmlFor={`entry-label-${entry.id}`} className="text-sm font-medium">
                Label
              </label>
              <Input id={`entry-label-${entry.id}`} value={label} onChange={(event) => setLabel(event.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`entry-sort-${entry.id}`} className="text-sm font-medium">
                Sort order
              </label>
              <Input
                id={`entry-sort-${entry.id}`}
                type="number"
                min={0}
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`entry-run-${entry.id}`} className="text-sm font-medium">
              Attached run
            </label>
            <select
              id={`entry-run-${entry.id}`}
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={attachedRunId}
              onChange={(event) => setAttachedRunId(event.target.value)}
            >
              <option value="">No run attached yet</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.title}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Clear the attachment here if the evidence is stale or the wrong run was linked.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`entry-summary-${entry.id}`} className="text-sm font-medium">
              Summary
            </label>
            <Textarea
              id={`entry-summary-${entry.id}`}
              rows={3}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`entry-assumptions-${entry.id}`} className="text-sm font-medium">
              Assumptions JSON
            </label>
            <Textarea
              id={`entry-assumptions-${entry.id}`}
              rows={6}
              value={assumptionsText}
              onChange={(event) => setAssumptionsText(event.target.value)}
            />
          </div>

          <FormError error={error} />

          <Button type="submit" size="lg" disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save entry
          </Button>
        </form>
      </details>
    </div>
  );
}

export function ScenarioEntryRegistry({
  scenarioSetId,
  entries,
  runs,
  baselineEntryId,
}: ScenarioEntryRegistryProps) {
  const baselineEntry =
    entries.find((entry) => entry.id === baselineEntryId) ?? entries.find((entry) => entry.entry_type === "baseline") ?? null;
  const alternativeEntries = entries.filter((entry) => entry.entry_type === "alternative");
  const comparisonSummary = buildScenarioComparisonSummary({
    baselineEntryId: baselineEntry?.id,
    baselineRunId: baselineEntry?.attached_run_id ?? null,
    candidateRunIds: alternativeEntries.map((entry) => entry.attached_run_id),
  });

  return (
    <div className="space-y-6">
      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Baseline</p>
            <h2 className="module-section-title">Anchor scenario</h2>
            <p className="module-section-description">
              The baseline stays visually separate so reviewers can see what every alternative is being compared against.
            </p>
          </div>
        </div>

        {!baselineEntry ? (
          <div className="module-empty-state mt-5 text-sm">
            No baseline registered yet. Add one before expecting alternative comparisons to become decision-ready.
          </div>
        ) : (
          <div className="mt-5">
            <ScenarioEntryCard
              scenarioSetId={scenarioSetId}
              entry={baselineEntry}
              runs={runs}
              baselineEntryId={baselineEntry.id}
              baselineRunId={baselineEntry.attached_run_id}
            />
          </div>
        )}
      </article>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Registry</p>
            <h2 className="module-section-title">Alternatives and attachments</h2>
            <p className="module-section-description">
              Alternative cards make the attachment state, assumptions, and comparison blockers explicit instead of hiding them in notes.
            </p>
          </div>
        </div>

        {alternativeEntries.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">No alternatives yet. Register one to start comparison tracking.</div>
        ) : (
          <div className="mt-5 module-record-list">
            {alternativeEntries.map((entry) => (
              <ScenarioEntryCard
                key={entry.id}
                scenarioSetId={scenarioSetId}
                entry={entry}
                runs={runs}
                baselineEntryId={baselineEntry?.id ?? null}
                baselineRunId={baselineEntry?.attached_run_id ?? null}
              />
            ))}
          </div>
        )}
      </article>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Comparison summary</p>
            <h2 className="module-section-title">Readiness and blockers</h2>
            <p className="module-section-description">
              This stays lightweight in V1: enough structure to explain readiness, evidence posture, and why a comparison is blocked.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-[20px] border border-border/70 bg-background/80 p-4">
            <p className="text-sm font-semibold tracking-tight">Ready alternatives</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{comparisonSummary.readyAlternatives}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {comparisonSummary.totalAlternatives > 0
                ? `${comparisonSummary.readyAlternatives} of ${comparisonSummary.totalAlternatives} alternatives have distinct runs attached on both sides.`
                : "No alternatives are registered yet."}
            </p>
          </div>
          <div className="rounded-[20px] border border-border/70 bg-background/80 p-4">
            <p className="text-sm font-semibold tracking-tight">Baseline posture</p>
            <p className="mt-2 text-lg font-semibold tracking-tight">
              {!comparisonSummary.baselineEntryPresent
                ? "Missing baseline"
                : comparisonSummary.baselineRunPresent
                  ? "Baseline run attached"
                  : "Baseline run missing"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {!comparisonSummary.baselineEntryPresent
                ? "Register a baseline entry before alternatives can compare."
                : comparisonSummary.baselineRunPresent
                  ? "The baseline has the evidence needed for alternative comparison."
                  : "Attach a run to the baseline so alternatives can become comparison-ready."}
            </p>
          </div>
          <div className="rounded-[20px] border border-border/70 bg-background/80 p-4">
            <p className="text-sm font-semibold tracking-tight">Blocked alternatives</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{comparisonSummary.blockedAlternatives}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Entries stay blocked when a baseline is missing, one side lacks a run, or both entries point at the same run.
            </p>
          </div>
        </div>

        {alternativeEntries.length > 0 ? (
          <div className="mt-5 space-y-3">
            {alternativeEntries.map((entry) => {
              const readiness = getScenarioComparisonReadiness({
                baselineEntryId: baselineEntry?.id ?? null,
                baselineRunId: baselineEntry?.attached_run_id ?? null,
                candidateRunId: entry.attached_run_id,
              });

              return (
                <div key={entry.id} className="rounded-[20px] border border-border/70 bg-background/80 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold tracking-tight">{entry.label}</p>
                      <p className="text-sm text-muted-foreground">
                        Baseline run: {baselineEntry?.attachedRun?.title ?? "Missing"} · Candidate run: {entry.attachedRun?.title ?? "Missing"}
                      </p>
                      <p className="text-sm text-muted-foreground">{readiness.reason}</p>
                    </div>
                    <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </article>
    </div>
  );
}
