"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Radar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  formatAerialMissionTypeLabel,
  formatAerialMissionStatusLabel,
  type AerialMissionType,
  type AerialMissionStatus,
} from "@/lib/aerial/catalog";

const MISSION_TYPES: AerialMissionType[] = ["corridor_survey", "site_inspection", "aoi_capture", "general"];
const MISSION_STATUSES: AerialMissionStatus[] = ["planned", "active", "complete", "cancelled"];

export function AerialMissionCreator({
  projectId,
  titleLabel = "Log aerial mission",
  description,
}: {
  projectId: string;
  titleLabel?: string;
  description?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [missionType, setMissionType] = useState<AerialMissionType>("corridor_survey");
  const [status, setStatus] = useState<AerialMissionStatus>("planned");
  const [geographyLabel, setGeographyLabel] = useState("");
  const [collectedAt, setCollectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/aerial/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          title,
          missionType,
          status,
          geographyLabel: geographyLabel || undefined,
          collectedAt: collectedAt ? new Date(collectedAt).toISOString() : undefined,
          notes: notes || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create aerial mission");
      }

      setTitle("");
      setMissionType("corridor_survey");
      setStatus("planned");
      setGeographyLabel("");
      setCollectedAt("");
      setNotes("");
      setMessage("Mission logged.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create aerial mission");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Radar className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Aerial mission</p>
          <h3 className="text-sm font-semibold text-foreground">{titleLabel}</h3>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mission title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="SR 49 corridor lidar capture"
            required
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mission type</label>
            <select
              className="module-select"
              value={missionType}
              onChange={(e) => setMissionType(e.target.value as AerialMissionType)}
            >
              {MISSION_TYPES.map((t) => (
                <option key={t} value={t}>{formatAerialMissionTypeLabel(t)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</label>
            <select
              className="module-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as AerialMissionStatus)}
            >
              {MISSION_STATUSES.map((s) => (
                <option key={s} value={s}>{formatAerialMissionStatusLabel(s)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Geography label</label>
            <Input
              value={geographyLabel}
              onChange={(e) => setGeographyLabel(e.target.value)}
              placeholder="Nevada County, Segment A"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Collection date</label>
            <Input
              type="datetime-local"
              value={collectedAt}
              onChange={(e) => setCollectedAt(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notes</label>
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Flight conditions, coverage area, known gaps, or follow-up requirements."
          />
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
          Log mission
        </Button>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </article>
  );
}
