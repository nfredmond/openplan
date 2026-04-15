"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FUNDING_OPPORTUNITY_DECISION_OPTIONS,
  type FundingOpportunityDecision,
} from "@/lib/programs/catalog";

function toOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function appendSuggestedText(existing: string, suggestion: string) {
  const normalizedExisting = existing.trim();
  const normalizedSuggestion = suggestion.trim();

  if (!normalizedSuggestion) {
    return existing;
  }

  if (normalizedExisting.includes(normalizedSuggestion)) {
    return existing;
  }

  return normalizedExisting ? `${normalizedExisting}\n\n${normalizedSuggestion}` : normalizedSuggestion;
}

export type FundingOpportunityDecisionModelingSupport = {
  title: string;
  summary: string;
  readinessNoteSuggestion: string;
  decisionRationaleSuggestion: string;
  recommendedNextActionTitle: string;
  recommendedNextActionSummary: string;
  recommendedDecisionState: FundingOpportunityDecision;
};

function getDecisionLabel(value: FundingOpportunityDecision) {
  return (
    FUNDING_OPPORTUNITY_DECISION_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

export function FundingOpportunityDecisionControls({
  opportunityId,
  initialDecisionState,
  initialExpectedAwardAmount,
  initialFitNotes,
  initialReadinessNotes,
  initialDecisionRationale,
  modelingSupport,
}: {
  opportunityId: string;
  initialDecisionState: (typeof FUNDING_OPPORTUNITY_DECISION_OPTIONS)[number]["value"];
  initialExpectedAwardAmount?: number | string | null;
  initialFitNotes?: string | null;
  initialReadinessNotes?: string | null;
  initialDecisionRationale?: string | null;
  modelingSupport?: FundingOpportunityDecisionModelingSupport | null;
}) {
  const router = useRouter();
  const [decisionState, setDecisionState] = useState(initialDecisionState);
  const [expectedAwardAmount, setExpectedAwardAmount] = useState(initialExpectedAwardAmount?.toString() ?? "");
  const [fitNotes, setFitNotes] = useState(initialFitNotes ?? "");
  const [readinessNotes, setReadinessNotes] = useState(initialReadinessNotes ?? "");
  const [decisionRationale, setDecisionRationale] = useState(initialDecisionRationale ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recommendedDecisionLabel = modelingSupport
    ? getDecisionLabel(modelingSupport.recommendedDecisionState)
    : null;
  const recommendationAlreadyApplied =
    modelingSupport?.recommendedDecisionState === decisionState;

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/funding-opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decisionState,
          expectedAwardAmount: toOptionalNumber(expectedAwardAmount),
          fitNotes: fitNotes || null,
          readinessNotes: readinessNotes || null,
          decisionRationale: decisionRationale || null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save funding decision");
      }

      setMessage("Funding decision saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save funding decision");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[180px_220px_minmax(0,1fr)] md:items-start">
          <div className="space-y-1.5">
            <label htmlFor={`funding-decision-${opportunityId}`} className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Decision state
            </label>
            <select
              id={`funding-decision-${opportunityId}`}
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={decisionState}
              onChange={(event) =>
                setDecisionState(event.target.value as (typeof FUNDING_OPPORTUNITY_DECISION_OPTIONS)[number]["value"])
              }
            >
              {FUNDING_OPPORTUNITY_DECISION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`funding-expected-award-${opportunityId}`} className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Likely award amount
            </label>
            <Input
              id={`funding-expected-award-${opportunityId}`}
              type="number"
              min="0"
              step="0.01"
              placeholder="250000"
              value={expectedAwardAmount}
              onChange={(event) => setExpectedAwardAmount(event.target.value)}
            />
          </div>
        </div>

        {modelingSupport ? (
          <div className="rounded-2xl border border-sky-200/70 bg-sky-50/80 px-4 py-3 text-sm dark:border-sky-900/60 dark:bg-sky-950/30">
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5 text-sky-950 dark:text-sky-100">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">
                    Modeling-aware decision support
                  </p>
                  <p className="font-semibold">{modelingSupport.title}</p>
                  <p className="text-muted-foreground dark:text-sky-100/85">{modelingSupport.summary}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setReadinessNotes((current) =>
                        appendSuggestedText(current, modelingSupport.readinessNoteSuggestion)
                      )
                    }
                  >
                    Use in readiness notes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDecisionRationale((current) =>
                        appendSuggestedText(current, modelingSupport.decisionRationaleSuggestion)
                      )
                    }
                  >
                    Use in rationale
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-sky-200/80 bg-background/80 px-3 py-3 dark:border-sky-900/70 dark:bg-sky-950/40">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5 text-sky-950 dark:text-sky-100">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">
                      Recommended next action
                    </p>
                    <p className="font-semibold">{modelingSupport.recommendedNextActionTitle}</p>
                    <p className="text-muted-foreground dark:text-sky-100/85">
                      {modelingSupport.recommendedNextActionSummary}
                    </p>
                    <p className="text-xs text-muted-foreground dark:text-sky-100/75">
                      This only updates the form until you save the decision.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={recommendationAlreadyApplied}
                      onClick={() => setDecisionState(modelingSupport.recommendedDecisionState)}
                    >
                      {recommendationAlreadyApplied
                        ? `Decision already set to ${recommendedDecisionLabel}`
                        : `Set decision to ${recommendedDecisionLabel}`}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor={`funding-fit-notes-${opportunityId}`} className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Fit notes
            </label>
            <Textarea
              id={`funding-fit-notes-${opportunityId}`}
              rows={3}
              value={fitNotes}
              onChange={(event) => setFitNotes(event.target.value)}
              placeholder="Why this opportunity fits the project."
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`funding-readiness-notes-${opportunityId}`} className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Readiness notes
            </label>
            <Textarea
              id={`funding-readiness-notes-${opportunityId}`}
              rows={3}
              value={readinessNotes}
              onChange={(event) => setReadinessNotes(event.target.value)}
              placeholder="What is ready, missing, or risky."
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`funding-decision-rationale-${opportunityId}`} className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Decision rationale
            </label>
            <Textarea
              id={`funding-decision-rationale-${opportunityId}`}
              rows={3}
              value={decisionRationale}
              onChange={(event) => setDecisionRationale(event.target.value)}
              placeholder="Record why the team chose pursue, monitor, or skip."
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save decision
        </Button>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
