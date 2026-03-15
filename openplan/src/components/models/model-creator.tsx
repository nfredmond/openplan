"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Database, Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MODEL_FAMILY_OPTIONS, MODEL_STATUS_OPTIONS } from "@/lib/models/catalog";

type ProjectOption = {
  id: string;
  name: string;
};

type ScenarioSetOption = {
  id: string;
  title: string;
};

type CreateResponse = {
  modelId: string;
  error?: string;
};

const selectClassName = "module-select";

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function ModelCreator({
  projects,
  scenarioSets,
}: {
  projects: ProjectOption[];
  scenarioSets: ScenarioSetOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scenarioSetId, setScenarioSetId] = useState("");
  const [modelFamily, setModelFamily] = useState<(typeof MODEL_FAMILY_OPTIONS)[number]["value"]>("travel_demand");
  const [status, setStatus] = useState<(typeof MODEL_STATUS_OPTIONS)[number]["value"]>("draft");
  const [configVersion, setConfigVersion] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [horizonLabel, setHorizonLabel] = useState("");
  const [summary, setSummary] = useState("");
  const [assumptionsSummary, setAssumptionsSummary] = useState("");
  const [inputSummary, setInputSummary] = useState("");
  const [outputSummary, setOutputSummary] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const advancedFieldCount = useMemo(
    () => [configVersion, ownerLabel, horizonLabel, assumptionsSummary, inputSummary, outputSummary].filter((value) => value.trim()).length,
    [assumptionsSummary, configVersion, horizonLabel, inputSummary, outputSummary, ownerLabel]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          projectId: projectId || undefined,
          scenarioSetId: scenarioSetId || undefined,
          modelFamily,
          status,
          configVersion: configVersion || undefined,
          ownerLabel: ownerLabel || undefined,
          horizonLabel: horizonLabel || undefined,
          summary: summary || undefined,
          assumptionsSummary: assumptionsSummary || undefined,
          inputSummary: inputSummary || undefined,
          outputSummary: outputSummary || undefined,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create model");
      }

      router.refresh();
      router.push(`/models/${payload.modelId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create model");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New managed model record</h2>
          <p className="module-section-description">
            Start with the operator-owned metadata: project or scenario anchor, config version, and what the record is
            intended to produce. Link specific datasets, reports, plans, and recorded runs on the detail page.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Database className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-[22px] border border-border/70 bg-background/75 p-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Essential setup</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the record first. Advanced provenance and detailed links can layer in after the shell exists.
          </p>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="model-title" className="text-[0.82rem] font-semibold">
                Title
              </label>
              <Input
                id="model-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Countywide 2045 travel demand model setup"
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="model-project" className="text-[0.82rem] font-semibold">
                  Primary project
                  <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">or use scenario below</span>
                </label>
                <select id="model-project" className={selectClassName} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">No primary project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="model-scenario" className="text-[0.82rem] font-semibold">
                  Primary scenario set
                </label>
                <select
                  id="model-scenario"
                  className={selectClassName}
                  value={scenarioSetId}
                  onChange={(event) => setScenarioSetId(event.target.value)}
                >
                  <option value="">No primary scenario set</option>
                  {scenarioSets.map((scenarioSet) => (
                    <option key={scenarioSet.id} value={scenarioSet.id}>
                      {scenarioSet.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="model-family" className="text-[0.82rem] font-semibold">
                  Model family
                </label>
                <select
                  id="model-family"
                  className={selectClassName}
                  value={modelFamily}
                  onChange={(event) => setModelFamily(event.target.value as (typeof MODEL_FAMILY_OPTIONS)[number]["value"])}
                >
                  {MODEL_FAMILY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="model-status" className="text-[0.82rem] font-semibold">
                  Status
                </label>
                <select
                  id="model-status"
                  className={selectClassName}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as (typeof MODEL_STATUS_OPTIONS)[number]["value"])}
                >
                  {MODEL_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="model-summary" className="text-[0.82rem] font-semibold">
                Summary
              </label>
              <Textarea
                id="model-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What this managed model record is for and what planning decision it should support."
              />
            </div>
          </div>
        </div>

        <details className="group rounded-[22px] border border-border/70 bg-muted/20 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/70 bg-background/80 text-muted-foreground">
                <SlidersHorizontal className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Advanced metadata</p>
                <p className="text-sm text-muted-foreground">
                  Optional now, but useful for provenance, calibration posture, and handoff quality.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {advancedFieldCount} filled
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
            </div>
          </summary>

          <div className="mt-4 space-y-4 border-t border-border/70 pt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="model-config-version" className="text-[0.82rem] font-semibold">
                  Config version
                </label>
                <Input
                  id="model-config-version"
                  value={configVersion}
                  onChange={(event) => setConfigVersion(event.target.value)}
                  placeholder="abm-v1.3 / demand-2045-r02"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="model-owner" className="text-[0.82rem] font-semibold">
                  Operator
                </label>
                <Input
                  id="model-owner"
                  value={ownerLabel}
                  onChange={(event) => setOwnerLabel(event.target.value)}
                  placeholder="Modeling team / operator"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="model-horizon" className="text-[0.82rem] font-semibold">
                Horizon / analysis window
              </label>
              <Input
                id="model-horizon"
                value={horizonLabel}
                onChange={(event) => setHorizonLabel(event.target.value)}
                placeholder="2045 adopted RTP horizon"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="model-assumptions" className="text-[0.82rem] font-semibold">
                Assumptions posture
              </label>
              <Textarea
                id="model-assumptions"
                value={assumptionsSummary}
                onChange={(event) => setAssumptionsSummary(event.target.value)}
                placeholder="Calibration basis, scenario knobs, policy assumptions, or configuration caveats."
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="model-input-summary" className="text-[0.82rem] font-semibold">
                  Input posture
                </label>
                <Textarea
                  id="model-input-summary"
                  value={inputSummary}
                  onChange={(event) => setInputSummary(event.target.value)}
                  placeholder="Networks, land use, demand inputs, policy knobs, or linked dataset basis."
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="model-output-summary" className="text-[0.82rem] font-semibold">
                  Output posture
                </label>
                <Textarea
                  id="model-output-summary"
                  value={outputSummary}
                  onChange={(event) => setOutputSummary(event.target.value)}
                  placeholder="What outputs should exist, where they are cited, and what is still pending."
                />
              </div>
            </div>
          </div>
        </details>

        <FormError error={error} />

        <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Create model record
        </Button>
      </form>
    </article>
  );
}
