"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PLAN_STATUS_OPTIONS, PLAN_TYPE_OPTIONS } from "@/lib/plans/catalog";

type ProjectOption = {
  id: string;
  workspace_id: string;
  name: string;
};

type CreateResponse = {
  planId: string;
  error?: string;
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function PlanCreator({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [planType, setPlanType] = useState<(typeof PLAN_TYPE_OPTIONS)[number]["value"]>("corridor");
  const [status, setStatus] = useState<(typeof PLAN_STATUS_OPTIONS)[number]["value"]>("draft");
  const [geographyLabel, setGeographyLabel] = useState("");
  const [horizonYear, setHorizonYear] = useState("");
  const [summary, setSummary] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: projectId || undefined,
          title,
          planType,
          status,
          geographyLabel: geographyLabel || undefined,
          horizonYear: horizonYear ? Number(horizonYear) : undefined,
          summary: summary || undefined,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create plan");
      }

      router.refresh();
      router.push(`/plans/${payload.planId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create plan");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New plan record</h2>
          <p className="module-section-description">
            Register the formal planning object now, then use the detail page to inspect linked scenarios, engagement,
            and reports without pretending the document is already complete.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <FilePlus2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="plan-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input
            id="plan-title"
            placeholder="Downtown safety action plan"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="plan-type" className="text-[0.82rem] font-semibold">
              Plan type
            </label>
            <select
              id="plan-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={planType}
              onChange={(event) => setPlanType(event.target.value as (typeof PLAN_TYPE_OPTIONS)[number]["value"])}
            >
              {PLAN_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="plan-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof PLAN_STATUS_OPTIONS)[number]["value"])}
            >
              {PLAN_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="plan-project" className="text-[0.82rem] font-semibold">
            Primary project
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <select
            id="plan-project"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No linked project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="plan-geography" className="text-[0.82rem] font-semibold">
              Geography label
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="plan-geography"
              placeholder="Downtown core / SR-49 corridor"
              value={geographyLabel}
              onChange={(event) => setGeographyLabel(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-horizon" className="text-[0.82rem] font-semibold">
              Horizon year
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="plan-horizon"
              type="number"
              min={1900}
              max={2200}
              placeholder="2035"
              value={horizonYear}
              onChange={(event) => setHorizonYear(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="plan-summary" className="text-[0.82rem] font-semibold">
            Summary
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Textarea
            id="plan-summary"
            placeholder="What formal plan object is being assembled, for which geography, and toward what planning decision?"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        <FormError error={error} />

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create plan
        </Button>
      </form>
    </article>
  );
}
