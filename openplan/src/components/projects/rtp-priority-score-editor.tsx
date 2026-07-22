"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  RTP_PRIORITY_CRITERIA,
  RTP_PRIORITY_LEVELS,
  RTP_PRIORITY_LEVEL_LABEL,
  RTP_PRIORITY_RATING_SCALE,
} from "@/lib/rtp/priority-criteria";
import {
  buildRtpPriorityRationale,
  parsePriorityScores,
  priorityTierLabel,
  priorityTierTone,
  type RtpPriorityScores,
} from "@/lib/rtp/priority-scoring";

function serialize(scores: RtpPriorityScores): string {
  const parsed = parsePriorityScores(scores);
  return Object.keys(parsed)
    .sort()
    .map((key) => `${key}:${parsed[key]}`)
    .join(",");
}

/**
 * Per-RTP-link priority scoring: rate each criterion 0–3, see the live composite
 * score, tier, per-level rollup, and generated "why" narrative, then save. This is
 * the planner-facing surface of the RTP "why" engine.
 */
export function RtpPriorityScoreEditor({
  projectId,
  linkId,
  initialScores,
}: {
  projectId: string;
  linkId: string;
  initialScores: RtpPriorityScores;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<RtpPriorityScores>(initialScores ?? {});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rationale = useMemo(() => buildRtpPriorityRationale(scores), [scores]);
  const dirty = useMemo(() => serialize(scores) !== serialize(initialScores ?? {}), [scores, initialScores]);

  function setRating(key: string, value: number) {
    setScores((prev) => {
      const next = { ...prev };
      if (value <= 0) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/rtp-links`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkId, priorityScores: scores }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to save priority scores");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save priority scores");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border/70 bg-background/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Priority scoring — the &ldquo;why&rdquo;
        </button>
        <StatusBadge tone={priorityTierTone(rationale.summary.tier)}>
          {rationale.summary.composite}/100 · {priorityTierLabel(rationale.summary.tier)}
        </StatusBadge>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{rationale.narrative}</p>

      {open ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {RTP_PRIORITY_LEVELS.map((level) => (
              <span
                key={level}
                className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/30 px-2 py-0.5 text-[0.7rem] text-muted-foreground"
              >
                {RTP_PRIORITY_LEVEL_LABEL[level]}
                <strong className="text-foreground">{rationale.summary.byLevel[level]}/100</strong>
              </span>
            ))}
          </div>

          <ul className="space-y-2">
            {RTP_PRIORITY_CRITERIA.map((criterion) => (
              <li
                key={criterion.key}
                className="grid gap-1.5 border-t border-border/50 pt-2 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    {criterion.label}
                    <span className="ml-1.5 font-normal text-muted-foreground">· {RTP_PRIORITY_LEVEL_LABEL[criterion.level]}</span>
                  </p>
                  <p className="text-[0.7rem] text-muted-foreground">
                    {criterion.description} <span className="italic">({criterion.policyBasis})</span>
                  </p>
                </div>
                <select
                  aria-label={`Rate: ${criterion.label}`}
                  value={scores[criterion.key] ?? 0}
                  onChange={(event) => setRating(criterion.key, Number(event.target.value))}
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {RTP_PRIORITY_RATING_SCALE.map((step) => (
                    <option key={step.value} value={step.value}>
                      {step.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}

          <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save priority scores
          </Button>
        </div>
      ) : null}
    </div>
  );
}
