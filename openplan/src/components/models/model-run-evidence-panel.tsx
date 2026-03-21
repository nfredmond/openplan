"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileJson2, Loader2, RefreshCcw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildEvidenceHighlights,
  formatDurationSeconds,
  labelForEngineKey,
  normalizeEvidencePacket,
  summarizeEvidenceCategories,
  type NormalizedEvidencePacket,
} from "@/lib/models/evidence-packet";

type ModelRunEvidencePanelProps = {
  modelId: string;
  modelRunId: string;
  runStatus: string;
  engineKey: string;
};

export function ModelRunEvidencePanel({
  modelId,
  modelRunId,
  runStatus,
  engineKey,
}: ModelRunEvidencePanelProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRelaunching, setIsRelaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<NormalizedEvidencePacket | null>(null);

  const canInspect = runStatus === "succeeded";
  const canRelaunch = engineKey === "aequilibrae" && runStatus !== "running" && runStatus !== "succeeded";
  const packetHref = `/api/models/${modelId}/runs/${modelRunId}/evidence-packet`;

  const highlights = useMemo(() => (evidence ? buildEvidenceHighlights(evidence) : []), [evidence]);
  const categories = useMemo(() => (evidence ? summarizeEvidenceCategories(evidence) : []), [evidence]);

  async function loadEvidence(force = false) {
    if (!canInspect) {
      return;
    }
    if (evidence && !force) {
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch(packetHref, { cache: "no-store" });
      const payload = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load evidence packet");
      }

      setEvidence(
        normalizeEvidencePacket({
          rawPacket: payload,
          modelId,
          modelRunId,
          modelTitle: typeof payload.model_title === "string" ? payload.model_title : "OpenPlan model",
          runRecord: {
            id: modelRunId,
            engine_key: engineKey,
            status: runStatus,
          },
          artifacts: [],
          stages: [],
          kpis: [],
        })
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load evidence packet");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggle() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      await loadEvidence();
    }
  }

  async function handleRelaunch() {
    setError(null);
    setIsRelaunching(true);
    try {
      const response = await fetch(`/api/models/${modelId}/runs/${modelRunId}/launch`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to relaunch worker run");
      }

      router.refresh();
      setIsOpen(false);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Failed to relaunch worker run");
    } finally {
      setIsRelaunching(false);
    }
  }

  return (
    <div className="mt-4 rounded-[20px] border border-border/70 bg-background/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Evidence packet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {canInspect
              ? "Inspect the normalized planner-safe packet and refresh it after worker reruns."
              : canRelaunch
                ? "This worker run can be reset and queued again without leaving the model page."
                : "Evidence becomes available after the run completes successfully."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canInspect ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleToggle()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson2 className="h-4 w-4" />}
              {isOpen ? "Hide evidence" : "Inspect evidence"}
            </Button>
          ) : null}

          {canRelaunch ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleRelaunch()} disabled={isRelaunching}>
              {isRelaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {runStatus === "queued" ? "Reset queue" : "Relaunch worker run"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p> : null}

      {isOpen ? (
        <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
          {evidence ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="info">{labelForEngineKey(evidence.engine || engineKey)}</StatusBadge>
                <StatusBadge tone="neutral">Packet {evidence.packet_version}</StatusBadge>
                <StatusBadge tone="neutral">{evidence.provenance.source_packet_format}</StatusBadge>
                {evidence.provenance.fallback_reason ? <StatusBadge tone="warning">Synthesized fallback</StatusBadge> : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void loadEvidence(true)} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  Refresh evidence
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <a href={packetHref} target="_blank" rel="noopener noreferrer">
                    <FileJson2 className="h-4 w-4" />
                    Open packet JSON
                  </a>
                </Button>
              </div>

              {highlights.length > 0 ? (
                <div className="module-summary-grid cols-4 mt-1">
                  {highlights.map((highlight) => (
                    <div key={highlight.label} className="module-summary-card">
                      <p className="module-summary-label">{highlight.label}</p>
                      <p className="module-summary-value text-base">{highlight.value}</p>
                      <p className="module-summary-detail">{highlight.detail}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-[18px] border border-border/65 bg-background/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">Packet posture</p>
                    <StatusBadge tone="neutral">{labelForEngineKey(evidence.engine || engineKey)}</StatusBadge>
                  </div>
                  <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-start justify-between gap-3">
                      <dt>Generated</dt>
                      <dd className="text-right text-foreground">{new Date(evidence.generated_at).toLocaleString()}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Run status</dt>
                      <dd className="text-right text-foreground">{evidence.provenance.run_status || runStatus}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Engine version</dt>
                      <dd className="text-right text-foreground">{evidence.provenance.engine_version}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Artifacts</dt>
                      <dd className="text-right text-foreground">{evidence.outputs.artifacts.length}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Stages</dt>
                      <dd className="text-right text-foreground">{evidence.outputs.stages.length}</dd>
                    </div>
                  </dl>

                  {evidence.inputs.query_text ? (
                    <div className="mt-4 rounded-[16px] border border-border/60 bg-background/90 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Query text</p>
                      <p className="mt-2 text-sm text-foreground">{evidence.inputs.query_text}</p>
                    </div>
                  ) : null}

                  {evidence.caveats.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Caveats</p>
                      <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                        {evidence.caveats.map((caveat) => (
                          <li key={caveat} className="rounded-[14px] border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                            {caveat}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4">
                  <div className="rounded-[18px] border border-border/65 bg-background/80 p-4">
                    <p className="text-sm font-semibold text-foreground">KPI categories</p>
                    {categories.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No KPI categories were registered for this run.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {categories.map((category) => (
                          <div key={category.category} className="rounded-[16px] border border-border/60 bg-background/90 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-foreground capitalize">{category.category}</p>
                              <StatusBadge tone="neutral">{category.count} KPI{category.count === 1 ? "" : "s"}</StatusBadge>
                            </div>
                            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                              {category.topItems.map((item, index) => (
                                <li key={`${category.category}-${item.name ?? item.label ?? index}`}>
                                  <span className="text-foreground">{item.label ?? item.name ?? "Metric"}</span>
                                  {typeof item.value === "number" ? ` · ${item.value}${item.unit ? ` ${item.unit}` : ""}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[18px] border border-border/65 bg-background/80 p-4">
                    <p className="text-sm font-semibold text-foreground">Execution timing</p>
                    {evidence.outputs.stages.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No stage timing was recorded for this packet.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {evidence.outputs.stages.map((stage) => (
                          <div key={`${stage.name}-${stage.status}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-border/60 bg-background/90 px-3 py-2.5 text-sm">
                            <div>
                              <p className="font-medium text-foreground">{stage.name}</p>
                              <p className="text-muted-foreground">{formatDurationSeconds(stage.duration_s) ?? "Duration unavailable"}</p>
                            </div>
                            <StatusBadge tone={stage.status === "succeeded" ? "success" : stage.status === "failed" ? "warning" : "neutral"}>
                              {stage.status}
                            </StatusBadge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading evidence packet…
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Evidence packet unavailable.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
