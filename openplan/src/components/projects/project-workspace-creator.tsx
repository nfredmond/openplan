"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type CreateResponse = {
  projectId: string;
  projectRecordId?: string;
};

const projectTypeOptions = [
  { value: "corridor_plan", label: "Corridor Plan" },
  { value: "active_transportation_plan", label: "Active Transportation Plan" },
  { value: "safety_plan", label: "Safety Plan" },
  { value: "regional_plan", label: "Regional / Program Plan" },
];

export function ProjectWorkspaceCreator() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [summary, setSummary] = useState("");
  const [planType, setPlanType] = useState("corridor_plan");
  const [deliveryPhase, setDeliveryPhase] = useState("scoping");
  const [status, setStatus] = useState("active");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectName,
          plan: "pilot",
          summary,
          planType,
          deliveryPhase,
          status,
        }),
      });

      const payload = (await response.json()) as CreateResponse & { error?: string; details?: string };

      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to create project workspace");
      }

      setProjectName("");
      setSummary("");
      setPlanType("corridor_plan");
      setDeliveryPhase("scoping");
      setStatus("active");

      router.refresh();
      if (payload.projectRecordId) {
        router.push(`/projects/${payload.projectRecordId}`);
        return;
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create project workspace");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <Plus className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Create</p>
            <h2 className="module-section-title">Start a project workspace</h2>
          </div>
        </div>
      </div>

      <p className="module-section-description">
        This lane creates a real project record and its attached workspace shell so planning, reporting, and analysis can
        evolve inside a stable container.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label htmlFor="project-name" className="text-sm font-medium">
            Project name
          </label>
          <Input
            id="project-name"
            placeholder="Nevada County Safety Action Program"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="project-summary" className="text-sm font-medium">
            Summary
          </label>
          <Textarea
            id="project-summary"
            placeholder="What is this project trying to accomplish, for whom, and in what context?"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={4}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label htmlFor="project-type" className="text-sm font-medium">
              Plan type
            </label>
            <select
              id="project-type"
              className="module-select"
              value={planType}
              onChange={(event) => setPlanType(event.target.value)}
            >
              {projectTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="project-phase" className="text-sm font-medium">
              Delivery phase
            </label>
            <select
              id="project-phase"
              className="module-select"
              value={deliveryPhase}
              onChange={(event) => setDeliveryPhase(event.target.value)}
            >
              <option value="scoping">Scoping</option>
              <option value="analysis">Analysis</option>
              <option value="engagement">Engagement</option>
              <option value="programming">Programming</option>
              <option value="delivery">Delivery</option>
              <option value="complete">Complete</option>
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="project-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="project-status"
              className="module-select"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="complete">Complete</option>
            </select>
          </div>
        </div>

        <div className="module-note text-sm">
          Create a project record to organize the work and continue from there.
        </div>

        {error ? (
          <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
          {isSubmitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating project workspace…
            </span>
          ) : (
            "Create project workspace"
          )}
        </Button>
      </form>
    </article>
  );
}
