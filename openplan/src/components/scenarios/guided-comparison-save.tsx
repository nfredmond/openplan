"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type SaveResponse = {
  error?: string;
  repairState?: string;
};

/** Freeze the four current guided outputs through the existing scenario path. */
export function GuidedComparisonSaveButton({
  scenarioSetId,
  baselineEntryId,
  baselineEntryLabel,
  candidateEntryId,
  candidateEntryLabel,
  refresh = false,
}: {
  scenarioSetId: string;
  baselineEntryId: string;
  baselineEntryLabel: string;
  candidateEntryId: string;
  candidateEntryLabel: string;
  refresh?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/scenarios/${scenarioSetId}/spine/comparison-snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baselineEntryId,
          candidateEntryId,
          label: `${candidateEntryLabel} vs ${baselineEntryLabel} — exact guided comparison`,
          summary: "AequilibraE and ActivitySim remain separate across the no-build baseline and build scenario. This snapshot binds all four exact outputs without averaging or selecting a winner.",
          narrative: "Read each method's baseline-versus-build result separately. Preserve any disagreement and the recorded validation outcome; neither method rescues the other.",
          caveats: [
            "This is screening evidence, not calibration or a forecast.",
            "No method averaging, winner selection, default promotion, or holdout access is allowed.",
          ],
          metadata: { kind: "guided_project_comparison" },
          status: "ready",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok) {
        const repair = payload.repairState
          ? ` Repair state: ${payload.repairState.replaceAll("_", " ")}.`
          : "";
        throw new Error(`${payload.error ?? "The exact guided comparison could not be saved."}${repair}`);
      }
      setSaved(true);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The exact guided comparison could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={() => void save()} disabled={saving}>
        {saving ? "Saving exact comparison…" : refresh ? "Save refreshed exact comparison" : "Save exact guided comparison"}
      </Button>
      {saved ? <p className="text-sm text-emerald-700 dark:text-emerald-300">Exact guided comparison saved.</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
