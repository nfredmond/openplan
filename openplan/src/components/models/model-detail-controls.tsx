"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Link2, Loader2, Save, Settings2, ShieldCheck } from "lucide-react";
import { ChipMultiSelect } from "@/components/ui/chip-multi-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const selectClassName = "module-select";

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
  const [linkedScenarioIds, setLinkedScenarioIds] = useState<string[]>(() =>
    selectedLinks.scenarios.filter((linkedId) => linkedId !== (model.scenario_set_id ?? ""))
  );
  const [linkedPlanIds, setLinkedPlanIds] = useState<string[]>(selectedLinks.plans);
  const [linkedReportIds, setLinkedReportIds] = useState<string[]>(selectedLinks.reports);
  const [linkedDatasetIds, setLinkedDatasetIds] = useState<string[]>(selectedLinks.datasets);
  const [linkedRunIds, setLinkedRunIds] = useState<string[]>(selectedLinks.runs);
  const [linkedProjectIds, setLinkedProjectIds] = useState<string[]>(() =>
    selectedLinks.relatedProjects.filter((linkedId) => linkedId !== (model.project_id ?? ""))
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scenarioSetId) return;
    setLinkedScenarioIds((current) => current.filter((linkedId) => linkedId !== scenarioSetId));
  }, [scenarioSetId]);

  useEffect(() => {
    if (!projectId) return;
    setLinkedProjectIds((current) => current.filter((linkedId) => linkedId !== projectId));
  }, [projectId]);

  const linkCount =
    linkedScenarioIds.length +
    linkedPlanIds.length +
    linkedReportIds.length +
    linkedDatasetIds.length +
    linkedRunIds.length +
    linkedProjectIds.length;

  const timestampsCount = [lastValidatedAt, lastRunRecordedAt].filter(Boolean).length;
  const anchorsCount = [projectId, scenarioSetId].filter(Boolean).length;

  const projectOptions = useMemo(() => projects.map((project) => ({ id: project.id, label: project.name })), [projects]);
  const scenarioOptions = useMemo(
    () => scenarioSets.map((scenarioSet) => ({ id: scenarioSet.id, label: scenarioSet.title })),
    [scenarioSets]
  );
  const planOptions = useMemo(() => plans.map((plan) => ({ id: plan.id, label: plan.title })), [plans]);
  const reportOptions = useMemo(() => reports.map((report) => ({ id: report.id, label: report.title })), [reports]);
  const datasetOptions = useMemo(() => datasets.map((dataset) => ({ id: dataset.id, label: dataset.title })), [datasets]);
  const runOptions = useMemo(() => runs.map((run) => ({ id: run.id, label: run.title })), [runs]);

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
            ...linkedScenarioIds.map((linkedId) => ({ linkType: "scenario_set", linkedId })),
            ...linkedPlanIds.map((linkedId) => ({ linkType: "plan", linkedId })),
            ...linkedReportIds.map((linkedId) => ({ linkType: "report", linkedId })),
            ...linkedDatasetIds.map((linkedId) => ({ linkType: "data_dataset", linkedId })),
            ...linkedRunIds.map((linkedId) => ({ linkType: "run", linkedId })),
            ...linkedProjectIds.map((linkedId) => ({ linkType: "project_record", linkedId })),
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

      <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[20px] border border-border/70 bg-background/75 p-3.5">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Anchors</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{anchorsCount}/2</p>
            <p className="mt-1 text-sm text-muted-foreground">Primary project and scenario context.</p>
          </div>
          <div className="rounded-[20px] border border-border/70 bg-background/75 p-3.5">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Explicit links</p>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-foreground">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              {linkCount}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Attached provenance, outputs, and related records.</p>
          </div>
          <div className="rounded-[20px] border border-border/70 bg-background/75 p-3.5">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Timestamps</p>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-foreground">
              <Clock3 className="h-4 w-4 text-muted-foreground" />
              {timestampsCount}/2
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Validation and latest recorded execution evidence.</p>
          </div>
        </div>

        <Tabs defaultValue="core">
          <TabsList variant="line" className="module-tabs-list">
            <TabsTrigger value="core" className="module-tab-trigger">
              Core
            </TabsTrigger>
            <TabsTrigger value="provenance" className="module-tab-trigger">
              Provenance
            </TabsTrigger>
            <TabsTrigger value="links" className="module-tab-trigger">
              Links
            </TabsTrigger>
            <TabsTrigger value="timestamps" className="module-tab-trigger">
              Timestamps
            </TabsTrigger>
          </TabsList>

          <TabsContent value="core" className="pt-4 space-y-4">
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
                  className={selectClassName}
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
                <label htmlFor="model-control-family" className="text-[0.82rem] font-semibold">
                  Model family
                </label>
                <select
                  id="model-control-family"
                  className={selectClassName}
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
                  className={selectClassName}
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
          </TabsContent>

          <TabsContent value="provenance" className="pt-4 space-y-4">
            <div className="rounded-[20px] border border-border/70 bg-muted/20 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <ShieldCheck className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Capture the evidence chain, not just the title card.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keep assumptions, input basis, outputs, and config JSON aligned so downstream reports can trust the record.
                  </p>
                </div>
              </div>
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

            <div className="space-y-1.5">
              <label htmlFor="model-control-config-json" className="text-[0.82rem] font-semibold">
                Config JSON
              </label>
              <Textarea
                id="model-control-config-json"
                value={configJsonText}
                onChange={(event) => setConfigJsonText(event.target.value)}
                className="min-h-52 font-mono text-xs"
              />
            </div>
          </TabsContent>

          <TabsContent value="links" className="pt-4 space-y-4">
            <div className="rounded-[20px] border border-border/70 bg-muted/20 p-4">
              <p className="text-sm font-semibold text-foreground">Link supporting records with chips instead of platform-native multi-select.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Primary project and primary scenario anchors stay out of this additional link stack automatically.
              </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="model-control-scenario-links-search" className="text-[0.82rem] font-semibold">
                  Additional scenario links
                </label>
                <ChipMultiSelect
                  id="model-control-scenario-links"
                  options={scenarioOptions}
                  selectedIds={linkedScenarioIds}
                  onChange={setLinkedScenarioIds}
                  reservedIds={scenarioSetId ? [scenarioSetId] : []}
                  searchPlaceholder="Search scenario sets to add…"
                  emptySelectionLabel="No additional scenario links yet."
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="model-control-plan-links-search" className="text-[0.82rem] font-semibold">
                  Plan links
                </label>
                <ChipMultiSelect
                  id="model-control-plan-links"
                  options={planOptions}
                  selectedIds={linkedPlanIds}
                  onChange={setLinkedPlanIds}
                  searchPlaceholder="Search plans to add…"
                  emptySelectionLabel="No linked plans yet."
                />
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="model-control-report-links-search" className="text-[0.82rem] font-semibold">
                  Report links
                </label>
                <ChipMultiSelect
                  id="model-control-report-links"
                  options={reportOptions}
                  selectedIds={linkedReportIds}
                  onChange={setLinkedReportIds}
                  searchPlaceholder="Search reports to add…"
                  emptySelectionLabel="No linked reports yet."
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="model-control-dataset-links-search" className="text-[0.82rem] font-semibold">
                  Dataset links
                </label>
                <ChipMultiSelect
                  id="model-control-dataset-links"
                  options={datasetOptions}
                  selectedIds={linkedDatasetIds}
                  onChange={setLinkedDatasetIds}
                  searchPlaceholder="Search datasets to add…"
                  emptySelectionLabel="No linked datasets yet."
                />
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="model-control-run-links-search" className="text-[0.82rem] font-semibold">
                  Recorded run links
                </label>
                <ChipMultiSelect
                  id="model-control-run-links"
                  options={runOptions}
                  selectedIds={linkedRunIds}
                  onChange={setLinkedRunIds}
                  searchPlaceholder="Search run records to add…"
                  emptySelectionLabel="No linked runs yet."
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="model-control-project-links-search" className="text-[0.82rem] font-semibold">
                  Related project links
                </label>
                <ChipMultiSelect
                  id="model-control-project-links"
                  options={projectOptions}
                  selectedIds={linkedProjectIds}
                  onChange={setLinkedProjectIds}
                  reservedIds={projectId ? [projectId] : []}
                  searchPlaceholder="Search projects to add…"
                  emptySelectionLabel="No related projects yet."
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="timestamps" className="pt-4 space-y-4">
            <div className="rounded-[20px] border border-border/70 bg-muted/20 p-4">
              <p className="text-sm font-semibold text-foreground">Timebox the evidence trail.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Record when the model was last validated and when the latest run evidence was captured.
              </p>
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
          </TabsContent>
        </Tabs>

        {error ? (
          <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving} className="w-full sm:w-auto">
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save model record
        </Button>
      </form>
    </article>
  );
}
