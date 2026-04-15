"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PLAN_STATUS_OPTIONS, PLAN_TYPE_OPTIONS } from "@/lib/plans/catalog";

type ProjectOption = {
  id: string;
  name: string;
};

type PlanDetailControlsProps = {
  plan: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    plan_type: string;
    project_id: string | null;
    geography_label: string | null;
    horizon_year: number | null;
  };
  projects: ProjectOption[];
};

export function PlanDetailControls({ plan, projects }: PlanDetailControlsProps) {
  const router = useRouter();
  const [title, setTitle] = useState(plan.title);
  const [summary, setSummary] = useState(plan.summary ?? "");
  const [status, setStatus] = useState(plan.status);
  const [planType, setPlanType] = useState(plan.plan_type);
  const [projectId, setProjectId] = useState(plan.project_id ?? "");
  const [geographyLabel, setGeographyLabel] = useState(plan.geography_label ?? "");
  const [horizonYear, setHorizonYear] = useState(plan.horizon_year ? String(plan.horizon_year) : "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          summary: summary.trim() ? summary.trim() : null,
          status,
          planType,
          projectId: projectId || null,
          geographyLabel: geographyLabel.trim() ? geographyLabel.trim() : null,
          horizonYear: horizonYear ? Number(horizonYear) : null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update plan");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update plan");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Controls</p>
          <h2 className="module-section-title">Plan record workflow</h2>
          <p className="module-section-description">
            Update the formal record in place. This stays metadata-first and intentionally avoids chapter editing.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Settings2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="plan-control-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input id="plan-control-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="plan-control-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="plan-control-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {PLAN_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-control-type" className="text-[0.82rem] font-semibold">
              Plan type
            </label>
            <select
              id="plan-control-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={planType}
              onChange={(event) => setPlanType(event.target.value)}
            >
              {PLAN_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="plan-control-project" className="text-[0.82rem] font-semibold">
            Primary project
          </label>
          <select
            id="plan-control-project"
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
            <label htmlFor="plan-control-geography" className="text-[0.82rem] font-semibold">
              Geography label
            </label>
            <Input
              id="plan-control-geography"
              value={geographyLabel}
              onChange={(event) => setGeographyLabel(event.target.value)}
              placeholder="Downtown core / corridor segment"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-control-horizon" className="text-[0.82rem] font-semibold">
              Horizon year
            </label>
            <Input
              id="plan-control-horizon"
              type="number"
              min={1900}
              max={2200}
              value={horizonYear}
              onChange={(event) => setHorizonYear(event.target.value)}
              placeholder="2035"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="plan-control-summary" className="text-[0.82rem] font-semibold">
            Summary
          </label>
          <Textarea
            id="plan-control-summary"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Describe what planning record is being assembled and what decisions it should support."
          />
        </div>

        {error ? (
          <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save plan record
        </Button>
      </form>
    </article>
  );
}
