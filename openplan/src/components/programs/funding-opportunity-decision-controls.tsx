"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FUNDING_OPPORTUNITY_DECISION_OPTIONS } from "@/lib/programs/catalog";

function toOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function FundingOpportunityDecisionControls({
  opportunityId,
  initialDecisionState,
  initialExpectedAwardAmount,
  initialFitNotes,
  initialReadinessNotes,
  initialDecisionRationale,
}: {
  opportunityId: string;
  initialDecisionState: (typeof FUNDING_OPPORTUNITY_DECISION_OPTIONS)[number]["value"];
  initialExpectedAwardAmount?: number | string | null;
  initialFitNotes?: string | null;
  initialReadinessNotes?: string | null;
  initialDecisionRationale?: string | null;
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
    <div className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
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

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Fit notes</label>
            <Textarea rows={3} value={fitNotes} onChange={(event) => setFitNotes(event.target.value)} placeholder="Why this opportunity fits the project." />
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Readiness notes</label>
            <Textarea rows={3} value={readinessNotes} onChange={(event) => setReadinessNotes(event.target.value)} placeholder="What is ready, missing, or risky." />
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Decision rationale</label>
            <Textarea rows={3} value={decisionRationale} onChange={(event) => setDecisionRationale(event.target.value)} placeholder="Record why the team chose pursue, monitor, or skip." />
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
