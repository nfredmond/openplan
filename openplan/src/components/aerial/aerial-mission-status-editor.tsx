"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatAerialMissionStatusLabel, type AerialMissionStatus } from "@/lib/aerial/catalog";
import { StatusBadge } from "@/components/ui/status-badge";
import { aerialMissionStatusTone } from "@/lib/aerial/catalog";

const STATUSES: AerialMissionStatus[] = ["planned", "active", "complete", "cancelled"];

export function AerialMissionStatusEditor({
  missionId,
  currentStatus,
}: {
  missionId: string;
  currentStatus: AerialMissionStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AerialMissionStatus>(currentStatus);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: AerialMissionStatus) {
    if (next === status) return;
    setError(null);

    const previous = status;
    setStatus(next);

    try {
      const response = await fetch(`/api/aerial/missions/${missionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Update failed");
      startTransition(() => router.refresh());
    } catch {
      setStatus(previous);
      setError("Failed to update status");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusBadge tone={isPending ? "neutral" : aerialMissionStatusTone(status)}>
          {formatAerialMissionStatusLabel(status)}
        </StatusBadge>
        <select
          className="h-6 rounded-[0.25rem] border border-border/60 bg-background px-1.5 text-[0.7rem] text-muted-foreground outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
          value={status}
          disabled={isPending}
          onChange={(e) => handleChange(e.target.value as AerialMissionStatus)}
          aria-label="Update mission status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{formatAerialMissionStatusLabel(s)}</option>
          ))}
        </select>
      </div>
      {error ? <p className="text-[0.7rem] text-destructive">{error}</p> : null}
    </div>
  );
}
