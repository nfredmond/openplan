"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/state-block";

type ProjectOption = {
  id: string;
  workspace_id: string;
  name: string;
};

type CreateResponse = {
  scenarioSetId: string;
  error?: string;
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function ScenarioSetCreator({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [planningQuestion, setPlanningQuestion] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          title,
          summary,
          planningQuestion,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create scenario set");
      }

      router.refresh();
      router.push(`/scenarios/${payload.scenarioSetId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create scenario set");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New scenario set</h2>
          <p className="module-section-description">
            Start with the planning question, link the set to a project, then register a baseline and alternatives as
            durable planning records.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <FilePlus2 className="h-5 w-5" />
        </span>
      </div>

      {projects.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No projects available"
            description="Create a project before opening a scenario set. Scenario sets stay anchored to a real project container."
            compact
          />
        </div>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="scenario-project" className="text-[0.82rem] font-semibold">
              Project
            </label>
            <select
              id="scenario-project"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="scenario-title" className="text-[0.82rem] font-semibold">
              Title
            </label>
            <Input
              id="scenario-title"
              placeholder="2026 Safety package alternatives"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="scenario-summary" className="text-[0.82rem] font-semibold">
              Summary
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Textarea
              id="scenario-summary"
              placeholder="What is this scenario set trying to compare?"
              rows={3}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="scenario-question" className="text-[0.82rem] font-semibold">
              Planning question
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Textarea
              id="scenario-question"
              placeholder="What tradeoff, decision, or policy question should this set answer?"
              rows={4}
              value={planningQuestion}
              onChange={(event) => setPlanningQuestion(event.target.value)}
            />
          </div>

          <FormError error={error} />

          <Button type="submit" size="lg" disabled={isSubmitting || !projectId}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create scenario set
          </Button>
        </form>
      )}
    </article>
  );
}
