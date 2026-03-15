"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MODEL_FAMILY_OPTIONS, MODEL_STATUS_OPTIONS } from "@/lib/models/catalog";

type NamedOption = {
  id: string;
  title: string;
};

type ProjectOption = {
  id: string;
  name: string;
};

type ModelDetailControlsProps = {
  model: {
    id: string;
    title: string;
    project_id: string | null;
    scenario_set_id: string | null;
    model_family: string;
    status: string;
    config_version: string | null;
    owner_label: string | null;
    horizon_label: string | null;
    assumptions_summary: string | null;
    input_summary: string | null;
    output_summary: string | null;
    summary: string | null;
    config_json: Record<string, unknown> | null;
    last_validated_at: string | null;
    last_run_recorded_at: string | null;
  };
  projects: ProjectOption[];
  scenarioSets: NamedOption[];
  plans: NamedOption[];
  reports: NamedOption[];
  datasets: NamedOption[];
  runs: NamedOption[];
  selectedLinks: {
    scenarios: string[];
    plans: string[];
    reports: string[];
    datasets: string[];
    runs: string[];
    relatedProjects: string[];
  };
};

function toLocalDateTimeValue(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function fromLocalDateTimeValue(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readSelectedIds(event: React.ChangeEvent<HTMLSelectElement>) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

export function ModelDetailControls({
  model,
  projects,
  scenarioSets,
  plans,
  reports,
  datasets,
  runs,
  selectedLinks,
}: ModelDetailControlsProps) {
  const router = useRouter();
  const [title, setTitle] = useState(model.title);
  const [projectId, setProjectId] = useState(model.project_id ?? "");
  const [scenarioSetId, setScenarioSetId] = useState(model.scenario_set_id ?? "");
  const [modelFamily, setModelFamily] = useState(model.model_family);
  const [status, setStatus] = useState(model.status);
  const [configVersion, setConfigVersion] = useState(model.config_version ?? "");
  const [ownerLabel, setOwnerLabel] = useState(model.owner_label ?? "");
  const [horizonLabel, setHorizonLabel] = useState(model.horizon_label ?? "");
  const [summary, setSummary] = useState(model.summary ?? "");
  const [assumptionsSummary, setAssumptionsSummary] = useState(model.assumptions_summary ?? "");
  const [inputSummary, setInputSummary] = useState(model.input_summary ?? "");
  const [outputSummary, setOutputSummary] = useState(model.output_summary ?? "");
  const [configJsonText, setConfigJsonText] = useState(JSON.stringify(model.config_json ?? {}, null, 2));
  const [lastValidatedAt, setLastValidatedAt] = useState(toLocalDateTimeValue(model.last_validated_at));
  const [lastRunRecordedAt, setLastRunRecordedAt] = useState(toLocalDateTimeValue(model.last_run_recorded_at));
  const [linkedScenarioIds, setLinkedScenarioIds] = useState<string[]>(selectedLinks.scenarios);
  const [linkedPlanIds, setLinkedPlanIds] = useState<string[]>(selectedLinks.plans);
  const [linkedReportIds, setLinkedReportIds] = useState<string[]>(selectedLinks.reports);
  const [linkedDatasetIds, setLinkedDatasetIds] = useState<string[]>(selectedLinks.datasets);
  const [linkedRunIds, setLinkedRunIds] = useState<string[]>(selectedLinks.runs);
  const [linkedProjectIds, setLinkedProjectIds] = useState<string[]>(selectedLinks.relatedProjects);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      let parsedConfigJson: Record<string, unknown>;
      try {
        const parsed = JSON.parse(configJsonText || "{}");
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          throw new Error("Config JSON must be an object");
        }
        parsedConfigJson = parsed as Record<string, unknown>;
      } catch (parseError) {
        throw new Error(parseError instanceof Error ? parseError.message : "Config JSON is invalid");
      }

      const response = await fetch(`/api/models/${model.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          projectId: projectId || null,
          scenarioSetId: scenarioSetId || null,
          modelFamily,
          status,
          configVersion: configVersion.trim() ? configVersion.trim() : null,
          ownerLabel: ownerLabel.trim() ? ownerLabel.trim() : null,
          horizonLabel: horizonLabel.trim() ? horizonLabel.trim() : null,
          summary: summary.trim() ? summary.trim() : null,
          assumptionsSummary: assumptionsSummary.trim() ? assumptionsSummary.trim() : null,
          inputSummary: inputSummary.trim() ? inputSummary.trim() : null,
          outputSummary: outputSummary.trim() ? outputSummary.trim() : null,
          configJson: parsedConfigJson,
          lastValidatedAt: fromLocalDateTimeValue(lastValidatedAt),
          lastRunRecordedAt: fromLocalDateTimeValue(lastRunRecordedAt),
          links: [
            ...linkedScenarioIds
              .filter((linkedId) => linkedId !== scenarioSetId)
              .map((linkedId) => ({ linkType: "scenario_set", linkedId })),
            ...linkedPlanIds.map((linkedId) => ({ linkType: "plan", linkedId })),
            ...linkedReportIds.map((linkedId) => ({ linkType: "report", linkedId })),
            ...linkedDatasetIds.map((linkedId) => ({ linkType: "data_dataset", linkedId })),
            ...linkedRunIds.map((linkedId) => ({ linkType: "run", linkedId })),
            ...linkedProjectIds
              .filter((linkedId) => linkedId !== projectId)
              .map((linkedId) => ({ linkType: "project_record", linkedId })),
          ],
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update model");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update model");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Controls</p>
          <h2 className="module-section-title">Model record workflow</h2>
          <p className="module-section-description">
            Keep the config metadata, anchors, and traceability links current. This is readiness management, not run
            orchestration.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <Settings2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="model-control-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input id="model-control-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="model-control-project" className="text-[0.82rem] font-semibold">
              Primary project
            </label>
            <select
              id="model-control-project"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">No primary project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="model-control-scenario" className="text-[0.82rem] font-semibold">
              Primary scenario set
            </label>
            <select
              id="model-control-scenario"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
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
            <label htmlFor="model-control-family" className="text-[0.82rem] font-semibold">
              Model family
            </label>
            <select
              id="model-control-family"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={modelFamily}
              onChange={(event) => setModelFamily(event.target.value)}
            >
              {MODEL_FAMILY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="model-control-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="model-control-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {MODEL_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="model-control-config-version" className="text-[0.82rem] font-semibold">
              Config version
            </label>
            <Input
              id="model-control-config-version"
              value={configVersion}
              onChange={(event) => setConfigVersion(event.target.value)}
              placeholder="Versioned config or template label"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="model-control-owner" className="text-[0.82rem] font-semibold">
              Operator
            </label>
            <Input
              id="model-control-owner"
              value={ownerLabel}
              onChange={(event) => setOwnerLabel(event.target.value)}
              placeholder="Owner or operator"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="model-control-horizon" className="text-[0.82rem] font-semibold">
            Horizon / window
          </label>
          <Input
            id="model-control-horizon"
            value={horizonLabel}
            onChange={(event) => setHorizonLabel(event.target.value)}
            placeholder="2045 RTP / 2035 transit buildout"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="model-control-summary" className="text-[0.82rem] font-semibold">
            Summary
          </label>
          <Textarea id="model-control-summary" value={summary} onChange={(event) => setSummary(event.target.value)} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="model-control-assumptions" className="text-[0.82rem] font-semibold">
            Assumptions posture
          </label>
          <Textarea
            id="model-control-assumptions"
            value={assumptionsSummary}
            onChange={(event) => setAssumptionsSummary(event.target.value)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="model-control-inputs" className="text-[0.82rem] font-semibold">
              Input posture
            </label>
            <Textarea id="model-control-inputs" value={inputSummary} onChange={(event) => setInputSummary(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="model-control-outputs" className="text-[0.82rem] font-semibold">
              Output posture
            </label>
            <Textarea id="model-control-outputs" value={outputSummary} onChange={(event) => setOutputSummary(event.target.value)} />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="model-control-validated" className="text-[0.82rem] font-semibold">
              Last validated
            </label>
            <Input
              id="model-control-validated"
              type="datetime-local"
              value={lastValidatedAt}
              onChange={(event) => setLastValidatedAt(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="model-control-last-run" className="text-[0.82rem] font-semibold">
              Last run recorded
            </label>
            <Input
              id="model-control-last-run"
              type="datetime-local"
              value={lastRunRecordedAt}
              onChange={(event) => setLastRunRecordedAt(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="model-control-config-json" className="text-[0.82rem] font-semibold">
            Config JSON
          </label>
          <Textarea
            id="model-control-config-json"
            value={configJsonText}
            onChange={(event) => setConfigJsonText(event.target.value)}
            className="min-h-44 font-mono text-xs"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="model-control-scenario-links" className="text-[0.82rem] font-semibold">
              Additional scenario links
            </label>
            <select
              id="model-control-scenario-links"
              multiple
              value={linkedScenarioIds}
              onChange={(event) => setLinkedScenarioIds(readSelectedIds(event))}
              className="min-h-36 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm shadow-xs outline-none"
            >
              {scenarioSets.map((scenarioSet) => (
                <option key={scenarioSet.id} value={scenarioSet.id}>
                  {scenarioSet.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="model-control-plan-links" className="text-[0.82rem] font-semibold">
              Plan links
            </label>
            <select
              id="model-control-plan-links"
              multiple
              value={linkedPlanIds}
              onChange={(event) => setLinkedPlanIds(readSelectedIds(event))}
              className="min-h-36 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm shadow-xs outline-none"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="model-control-report-links" className="text-[0.82rem] font-semibold">
              Report links
            </label>
            <select
              id="model-control-report-links"
              multiple
              value={linkedReportIds}
              onChange={(event) => setLinkedReportIds(readSelectedIds(event))}
              className="min-h-36 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm shadow-xs outline-none"
            >
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="model-control-dataset-links" className="text-[0.82rem] font-semibold">
              Dataset links
            </label>
            <select
              id="model-control-dataset-links"
              multiple
              value={linkedDatasetIds}
              onChange={(event) => setLinkedDatasetIds(readSelectedIds(event))}
              className="min-h-36 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm shadow-xs outline-none"
            >
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="model-control-run-links" className="text-[0.82rem] font-semibold">
              Recorded run links
            </label>
            <select
              id="model-control-run-links"
              multiple
              value={linkedRunIds}
              onChange={(event) => setLinkedRunIds(readSelectedIds(event))}
              className="min-h-36 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm shadow-xs outline-none"
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="model-control-project-links" className="text-[0.82rem] font-semibold">
              Related project links
            </label>
            <select
              id="model-control-project-links"
              multiple
              value={linkedProjectIds}
              onChange={(event) => setLinkedProjectIds(readSelectedIds(event))}
              className="min-h-36 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm shadow-xs outline-none"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving} className="w-full">
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save model record
        </Button>
      </form>
    </article>
  );
}
