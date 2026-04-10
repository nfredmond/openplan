"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RTP_CYCLE_STATUS_OPTIONS } from "@/lib/rtp/catalog";
import {
  createDefaultTargetedReportSections,
  describeRtpPacketPresetStage,
  resolveRtpPacketPresetStage,
} from "@/lib/reports/catalog";

type LinkedPacketReport = {
  id: string;
  title: string;
};

export function RtpCyclePhaseControls({
  cycle,
  linkedPacketReports,
}: {
  cycle: {
    id: string;
    status: string;
  };
  linkedPacketReports: LinkedPacketReport[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(cycle.status);
  const [applyPacketPreset, setApplyPacketPreset] = useState(linkedPacketReports.length > 0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetStage = useMemo(() => resolveRtpPacketPresetStage(status), [status]);
  const statusChanged = status !== cycle.status;

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const cycleResponse = await fetch(`/api/rtp-cycles/${cycle.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });

      const cyclePayload = (await cycleResponse.json()) as { error?: string };
      if (!cycleResponse.ok) {
        throw new Error(cyclePayload.error || "Failed to update RTP cycle phase");
      }

      if (applyPacketPreset && linkedPacketReports.length > 0) {
        const presetSections = createDefaultTargetedReportSections("board_packet", "rtp_cycle", {
          rtpCycleStatus: status,
        });

        const updateResults = await Promise.allSettled(
          linkedPacketReports.map((report) =>
            fetch(`/api/reports/${report.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                sections: presetSections.map((section, index) => ({
                  sectionKey: section.sectionKey,
                  title: section.title,
                  enabled: section.enabled,
                  sortOrder: index,
                  configJson: section.configJson ?? {},
                })),
              }),
            }).then(async (response) => {
              const payload = (await response.json()) as { error?: string };
              if (!response.ok) {
                throw new Error(payload.error || `Failed to update packet ${report.title}`);
              }
            })
          )
        );

        const failed = updateResults.filter((result) => result.status === "rejected");
        if (failed.length > 0) {
          throw new Error(
            `Cycle phase updated, but ${failed.length} linked packet ${failed.length === 1 ? "record needs" : "records need"} a manual preset reset.`
          );
        }
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update RTP cycle phase");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Phase transition</p>
          <h2 className="module-section-title">Advance cycle status and packet posture</h2>
          <p className="module-section-description">
            Move the RTP cycle into its next phase and optionally push the recommended packet preset to linked RTP packet records.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <WandSparkles className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSave}>
        <div className="space-y-1.5">
          <label htmlFor={`rtp-cycle-phase-${cycle.id}`} className="text-[0.82rem] font-semibold">
            Cycle phase
          </label>
          <select
            id={`rtp-cycle-phase-${cycle.id}`}
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            disabled={isSaving}
          >
            {RTP_CYCLE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recommended packet preset</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{describeRtpPacketPresetStage(presetStage)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {linkedPacketReports.length > 0
              ? `${linkedPacketReports.length} linked RTP packet ${linkedPacketReports.length === 1 ? "record can" : "records can"} be reset to this phase-aligned layout.`
              : "No linked RTP packet records yet. Phase can still be updated now."}
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background px-4 py-4 text-sm text-foreground">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input"
            checked={applyPacketPreset}
            onChange={(event) => setApplyPacketPreset(event.target.checked)}
            disabled={isSaving || linkedPacketReports.length === 0}
          />
          <span>
            <span className="block font-semibold">Apply recommended packet preset to linked RTP packet records</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              This will reset linked packet section layouts to the recommended phase default for <span className="font-medium">{status}</span>.
            </span>
          </span>
        </label>

        {error ? (
          <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving || (!statusChanged && !applyPacketPreset)}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save phase transition
        </Button>
      </form>
    </article>
  );
}
