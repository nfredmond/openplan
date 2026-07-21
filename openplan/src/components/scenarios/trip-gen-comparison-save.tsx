"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitCompareArrows, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildTripGenComparisonPayload,
  type TripGenComparisonKpiRow,
} from "@/lib/scenarios/trip-gen-comparison";

type TripGenRunRef = {
  modelId: string;
  modelRunId: string;
};

type TripGenComparisonSaveButtonProps = {
  scenarioSetId: string;
  baselineEntryId: string;
  baselineEntryLabel: string;
  candidateEntryId: string;
  candidateEntryLabel: string;
  baselineRun: TripGenRunRef;
  candidateRun: TripGenRunRef;
};

async function fetchTripGenKpis(run: TripGenRunRef): Promise<TripGenComparisonKpiRow[]> {
  const response = await fetch(`/api/models/${run.modelId}/runs/${run.modelRunId}/kpis`);
  const payload = (await response.json()) as {
    error?: string;
    kpis?: Array<TripGenComparisonKpiRow & { kpi_category?: string | null }>;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Failed to load trip-generation KPIs");
  }

  return (payload.kpis ?? []).filter((kpi) => kpi.kpi_category === "ite_trip_generation");
}

/**
 * Saves a baseline-vs-candidate ITE trip-generation KPI comparison through the
 * EXISTING spine route (`/spine/comparison-snapshots`). The saved snapshot —
 * including the screening caveats — is rendered by the page's existing "Saved
 * comparison snapshots" section, so this component only writes and refreshes.
 */
export function TripGenComparisonSaveButton({
  scenarioSetId,
  baselineEntryId,
  baselineEntryLabel,
  candidateEntryId,
  candidateEntryLabel,
  baselineRun,
  candidateRun,
}: TripGenComparisonSaveButtonProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setIsSaving(true);

    try {
      const [baselineKpis, candidateKpis] = await Promise.all([
        fetchTripGenKpis(baselineRun),
        fetchTripGenKpis(candidateRun),
      ]);

      const payload = buildTripGenComparisonPayload({
        baselineEntry: { id: baselineEntryId, label: baselineEntryLabel },
        candidateEntry: { id: candidateEntryId, label: candidateEntryLabel },
        baselineKpis,
        candidateKpis,
        label: `Trip generation — ${candidateEntryLabel} vs ${baselineEntryLabel}`,
      });

      if (payload.indicatorDeltas.length === 0) {
        throw new Error(
          "Both runs need registered trip-generation KPIs before a comparison can be saved."
        );
      }

      const response = await fetch(`/api/scenarios/${scenarioSetId}/spine/comparison-snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responsePayload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(responsePayload.error || "Failed to save trip-generation comparison");
      }

      setSaved(true);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save trip-generation comparison"
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void handleSave()}
        disabled={isSaving || saved}
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
        {saved ? "Comparison saved" : "Save trip-gen comparison"}
      </Button>
      <p aria-live="polite" className="text-xs">
        {saved ? (
          <span className="text-emerald-600 dark:text-emerald-300">
            Comparison snapshot saved with screening caveats. It now appears under saved comparison snapshots.
          </span>
        ) : error ? (
          <span className="text-red-600 dark:text-red-300">{error}</span>
        ) : null}
      </p>
    </div>
  );
}
