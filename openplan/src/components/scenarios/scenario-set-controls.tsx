"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SCENARIO_SET_STATUSES, type ScenarioSetStatus } from "@/lib/scenarios/catalog";

type ScenarioSetControlsProps = {
  scenarioSetId: string;
  title: string;
  summary: string | null;
  planningQuestion: string | null;
  status: string;
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function ScenarioSetControls({
  scenarioSetId,
  title: initialTitle,
  summary: initialSummary,
  planningQuestion: initialPlanningQuestion,
  status: initialStatus,
}: ScenarioSetControlsProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [planningQuestion, setPlanningQuestion] = useState(initialPlanningQuestion ?? "");
  const [status, setStatus] = useState(initialStatus as ScenarioSetStatus);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/scenarios/${scenarioSetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          summary: summary || null,
          planningQuestion: planningQuestion || null,
          status,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update scenario set");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update scenario set");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-heading">
        <p className="module-section-label">Scenario set</p>
        <h2 className="module-section-title">Metadata and framing</h2>
        <p className="module-section-description">
          Keep the planning question explicit. The scenario set stays useful later only if its framing remains legible.
        </p>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-1.5">
            <label htmlFor="scenario-set-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="scenario-set-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="scenario-set-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="scenario-set-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as ScenarioSetStatus)}
            >
              {SCENARIO_SET_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="scenario-set-summary" className="text-sm font-medium">
            Summary
          </label>
          <Textarea
            id="scenario-set-summary"
            rows={3}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="scenario-set-question" className="text-sm font-medium">
            Planning question
          </label>
          <Textarea
            id="scenario-set-question"
            rows={4}
            value={planningQuestion}
            onChange={(event) => setPlanningQuestion(event.target.value)}
          />
        </div>

        <FormError error={error} />

        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save scenario set
        </Button>
      </form>
    </article>
  );
}
