"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, MessageSquareText } from "lucide-react";
import type { CorridorEngagementSummary } from "@/lib/engagement/corridor-join";

/**
 * The engagement<->modeling wedge on a succeeded run: approved public comments
 * that fall within the run's corridor, aggregated by sentiment + category, with
 * the nearest comments. No PPGIS competitor ties resident input to a model
 * corridor like this. Sentiment comes from the E1 AI synthesis (nothing new is
 * inferred here); comments with no synthesized sentiment are counted "unknown".
 */
type Props = {
  modelId: string;
  modelRunId: string;
};

const SENTIMENT_TONE: Record<string, string> = {
  negative: "text-red-700 dark:text-red-300",
  positive: "text-emerald-700 dark:text-emerald-300",
  mixed: "text-amber-700 dark:text-amber-300",
  neutral: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

export function ModelRunEngagementPanel({ modelId, modelRunId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CorridorEngagementSummary | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function handleToggle() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (!nextOpen || loaded || isLoading) return;

    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch(`/api/models/${modelId}/runs/${modelRunId}/engagement`, { cache: "no-store" });
      const payload = (await response.json()) as {
        summary?: CorridorEngagementSummary | null;
        reason?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Failed to load corridor engagement");
      setSummary(payload.summary ?? null);
      setReason(payload.reason ?? null);
      setLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load corridor engagement");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="rounded-[0.5rem] border border-border/60 bg-muted/25">
      <button
        type="button"
        onClick={() => void handleToggle()}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessageSquareText className="h-4 w-4" /> Public comments in this corridor
        </span>
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {isOpen ? (
        <div className="space-y-3 border-t border-border/60 px-4 py-3">
          {isLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Joining engagement to the corridor…
            </p>
          ) : error ? (
            <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
          ) : reason === "no_corridor_geometry" ? (
            <p className="text-xs text-muted-foreground">This run has no corridor geometry to join against.</p>
          ) : !summary || summary.total === 0 ? (
            <p className="text-xs text-muted-foreground">No approved public comments fall within this corridor.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                <span className="font-semibold">{summary.total}</span> approved comment
                {summary.total === 1 ? "" : "s"} within the corridor
                {summary.negativeSharePct !== null ? (
                  <>
                    {" · "}
                    <span className={SENTIMENT_TONE.negative}>{summary.negativeSharePct}% negative</span>
                    <span className="text-xs text-muted-foreground"> (of classified)</span>
                  </>
                ) : null}
              </p>

              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                {(["negative", "mixed", "neutral", "positive", "unknown"] as const).map((s) =>
                  summary.bySentiment[s] > 0 ? (
                    <span key={s}>
                      <span className={SENTIMENT_TONE[s]}>{summary.bySentiment[s]}</span> {s}
                    </span>
                  ) : null
                )}
              </div>

              {summary.byCategory.length > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {summary.byCategory.slice(0, 6).map((c) => `${c.label} (${c.count})`).join(" · ")}
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nearest comments</p>
                {summary.nearest.map((n) => (
                  <div key={n.id} className="border-l-2 border-border/60 pl-3">
                    <p className="text-xs leading-relaxed text-foreground">{n.snippet || "(no text)"}</p>
                    <p className="text-[0.68rem] text-muted-foreground">
                      {n.categoryLabel ? `${n.categoryLabel} · ` : ""}
                      <span className={SENTIMENT_TONE[n.sentiment]}>{n.sentiment}</span>
                      {n.distanceMeters !== null ? ` · ${n.distanceMeters} m` : ""}
                      {n.votes > 0 ? ` · ▲ ${n.votes}` : ""}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                Approved public comments spatially joined to this run&apos;s corridor (PostGIS). Sentiment is from
                the campaign&apos;s AI synthesis; unclassified comments are counted separately. Screening-grade.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
