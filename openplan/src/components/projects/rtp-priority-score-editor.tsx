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
import { formatRtpModelingEvidenceLine, type RtpModelingEvidence } from "@/lib/rtp/modeling-evidence";

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
  availableRuns,
  initialEvidenceRunId,
  modelingEvidence,
}: {
  projectId: string;
  linkId: string;
  initialScores: RtpPriorityScores;
  availableRuns: Array<{ id: string; title: string; engineKey: string }>;
  initialEvidenceRunId: string | null;
  modelingEvidence: RtpModelingEvidence | null;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<RtpPriorityScores>(initialScores ?? {});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceRunId, setEvidenceRunId] = useState(initialEvidenceRunId ?? "");
  const [savingEvidence, setSavingEvidence] = useState(false);

  async function saveEvidenceRun(runId: string | null) {
    setSavingEvidence(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/rtp-links`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkId, evidenceModelRunId: runId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to link the model run");
      router.refresh();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to link the model run");
    } finally {
      setSavingEvidence(false);
    }
  }

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

          <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
            <label
              htmlFor={`evidence-run-${linkId}`}
              className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Representative model run (VMT/GHG evidence)
            </label>
            <select
              id={`evidence-run-${linkId}`}
              value={evidenceRunId}
              onChange={(event) => {
                const next = event.target.value;
                setEvidenceRunId(next);
                void saveEvidenceRun(next || null);
              }}
              disabled={savingEvidence}
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">No run linked — VMT/GHG scored by planner judgment</option>
              {availableRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.title}
                </option>
              ))}
            </select>
            {modelingEvidence ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{modelingEvidence.runTitle ?? "Linked run"}:</span>{" "}
                {formatRtpModelingEvidenceLine(modelingEvidence)}
              </p>
            ) : (
              <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
                Link a run to show its screening-grade VMT/GHG next to those criteria. The run is named with its numbers — it informs the score, it doesn&apos;t set it.
              </p>
            )}
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
