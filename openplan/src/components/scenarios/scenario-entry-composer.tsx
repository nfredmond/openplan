"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GitCompareArrows, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SCENARIO_ENTRY_STATUSES, SCENARIO_ENTRY_TYPES, type ScenarioEntryStatus, type ScenarioEntryType } from "@/lib/scenarios/catalog";

type RunOption = {
  id: string;
  title: string;
  created_at: string;
};

type ScenarioEntryComposerProps = {
  scenarioSetId: string;
  hasBaseline: boolean;
  runs: RunOption[];
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function ScenarioEntryComposer({ scenarioSetId, hasBaseline, runs }: ScenarioEntryComposerProps) {
  const router = useRouter();
  const [entryType, setEntryType] = useState<ScenarioEntryType>(hasBaseline ? "alternative" : "baseline");
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<ScenarioEntryStatus>("draft");
  const [attachedRunId, setAttachedRunId] = useState("");
  const [assumptionsText, setAssumptionsText] = useState("{}");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreateBaseline = !hasBaseline;
  const entryTypeOptions = useMemo(
    () => SCENARIO_ENTRY_TYPES.filter((value) => value !== "baseline" || canCreateBaseline),
    [canCreateBaseline]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const assumptions = assumptionsText.trim() ? JSON.parse(assumptionsText) : {};
      const response = await fetch(`/api/scenarios/${scenarioSetId}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryType,
          label,
          summary,
          status,
          attachedRunId: attachedRunId || undefined,
          assumptions,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create scenario entry");
      }

      router.refresh();
      if (entryType === "baseline") {
        setEntryType("alternative");
      }
      setLabel("");
      setSummary("");
      setStatus("draft");
      setAttachedRunId("");
      setAssumptionsText("{}");
    } catch (submitError) {
      if (submitError instanceof SyntaxError) {
        setError("Assumptions must be valid JSON");
      } else {
        setError(submitError instanceof Error ? submitError.message : "Failed to create scenario entry");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Entries</p>
          <h2 className="module-section-title">Register baseline and alternatives</h2>
          <p className="module-section-description">
            Add the entry, attach the best available run, and keep assumptions structured so readiness is clear from the start.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
          <GitCompareArrows className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-1.5">
            <label htmlFor="scenario-entry-type" className="text-sm font-medium">
              Entry type
            </label>
            <select
              id="scenario-entry-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={entryType}
              onChange={(event) => setEntryType(event.target.value as ScenarioEntryType)}
            >
              {entryTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="scenario-entry-status" className="text-sm font-medium">
              Entry status
            </label>
            <select
              id="scenario-entry-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as ScenarioEntryStatus)}
            >
              {SCENARIO_ENTRY_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="scenario-entry-label" className="text-sm font-medium">
            Label
          </label>
          <Input
            id="scenario-entry-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={entryType === "baseline" ? "Existing conditions baseline" : "Alternative A"}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="scenario-entry-summary" className="text-sm font-medium">
            Summary
          </label>
          <Textarea
            id="scenario-entry-summary"
            rows={3}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Capture the main framing, scope, or rationale for this entry."
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="scenario-entry-run" className="text-sm font-medium">
            Attached run
          </label>
          <select
            id="scenario-entry-run"
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
            A comparison becomes ready only after both the baseline and alternative entries have distinct runs attached.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="scenario-entry-assumptions" className="text-sm font-medium">
            Assumptions JSON
          </label>
          <Textarea
            id="scenario-entry-assumptions"
            rows={5}
            value={assumptionsText}
            onChange={(event) => setAssumptionsText(event.target.value)}
            placeholder='{"vmt_horizon":"2045","network_scope":"downtown"}'
          />
        </div>

        <FormError error={error} />

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add scenario entry
        </Button>
      </form>
    </article>
  );
}
