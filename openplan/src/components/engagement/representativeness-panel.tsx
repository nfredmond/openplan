"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScatterChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CampaignRepresentativeness,
  RepresentativenessMetric,
} from "@/lib/engagement/representativeness";

const STATUS_LABEL: Record<RepresentativenessMetric["status"], string> = {
  under: "Under-represented",
  over: "Over-represented",
  balanced: "Balanced",
  insufficient: "Not enough data",
};

const STATUS_TONE: Record<RepresentativenessMetric["status"], string> = {
  under: "text-amber-700 dark:text-amber-300",
  over: "text-sky-700 dark:text-sky-300",
  balanced: "text-emerald-700 dark:text-emerald-300",
  insufficient: "text-muted-foreground",
};

const ERROR_MESSAGE: Record<string, string> = {
  no_located_respondents: "No approved, geolocated comments yet — representativeness needs mapped input.",
  census_unavailable: "ACS data was unavailable for this area. Try again shortly.",
  tract_geometry_unavailable: "Census tract geometry was unavailable for this area. Try again shortly.",
};

function MetricRow({ metric }: { metric: RepresentativenessMetric }) {
  const max = Math.max(metric.baselinePct ?? 0, metric.respondentPct ?? 0, 1);
  const baseW = ((metric.baselinePct ?? 0) / max) * 100;
  const respW = ((metric.respondentPct ?? 0) / max) * 100;
  return (
    <div className="border-l-2 border-border/60 pl-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{metric.label}</p>
        <p className="text-xs text-muted-foreground">
          <span className={STATUS_TONE[metric.status]}>{STATUS_LABEL[metric.status]}</span>
          {metric.representationRatio !== null ? ` · ${metric.representationRatio.toFixed(2)}×` : ""}
        </p>
      </div>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-muted-foreground">Area baseline</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-slate-400/60" style={{ width: `${baseW}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
            {metric.baselinePct === null ? "—" : `${metric.baselinePct}%`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-muted-foreground">Respondents</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-sky-500/60" style={{ width: `${respW}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
            {metric.respondentPct === null ? "—" : `${metric.respondentPct}%`}
          </span>
        </div>
      </div>
    </div>
  );
}

export function RepresentativenessPanel({
  campaignId,
  initialResult,
}: {
  campaignId: string;
  initialResult: CampaignRepresentativeness | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState<CampaignRepresentativeness | null>(initialResult);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCompute() {
    setError(null);
    setIsRunning(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/representativeness`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload = (await response.json()) as {
        error?: string;
        representativeness?: CampaignRepresentativeness;
      };
      if (!response.ok || !payload.representativeness) {
        throw new Error(payload.error ? ERROR_MESSAGE[payload.error] ?? payload.error : "Failed to compute");
      }
      setResult(payload.representativeness);
      router.refresh();
    } catch (computeError) {
      setError(computeError instanceof Error ? computeError.message : "Failed to compute representativeness");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Spatial representativeness</p>
          <p className="text-xs text-muted-foreground">
            Compares the ACS demographics of the tracts respondents came from against the study-area baseline.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void handleCompute()} disabled={isRunning}>
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScatterChart className="h-4 w-4" />}
          {result ? "Recompute" : "Compute"}
        </Button>
      </div>

      {error ? <p className="text-xs text-amber-700 dark:text-amber-300">{error}</p> : null}

      {!result ? (
        <p className="text-xs text-muted-foreground">
          No screening yet. Compute to see whether comments came disproportionately from higher- or lower-need tracts
          than the area as a whole.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {result.respondentCount} of {result.locatedRespondentCount} located respondent
              {result.locatedRespondentCount === 1 ? "" : "s"} mapped across {result.tractCount} tract
              {result.tractCount === 1 ? "" : "s"}
            </span>
            {result.underRepresented.length > 0 ? (
              <span className="text-amber-700 dark:text-amber-300">
                {result.underRepresented.length} group{result.underRepresented.length === 1 ? "" : "s"}{" "}
                under-represented
              </span>
            ) : null}
            <span>Computed {new Date(result.computedAt).toLocaleString()}</span>
          </div>

          <div className="space-y-3">
            {result.metrics.map((metric) => (
              <MetricRow key={metric.key} metric={metric} />
            ))}
          </div>

          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{result.caveat}</p>
        </div>
      )}
    </div>
  );
}
