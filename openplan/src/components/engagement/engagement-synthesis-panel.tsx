"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listFlaggedNarrativeSentences, stripFactCitationTokens } from "@/lib/grants/narrative-grounding";
import type { EngagementSynthesis, EngagementSentiment } from "@/lib/engagement/ai-synthesis";

const SENTIMENT_LABEL: Record<EngagementSentiment, string> = {
  positive: "Positive",
  mixed: "Mixed",
  neutral: "Neutral",
  negative: "Negative",
};

const SENTIMENT_TONE: Record<EngagementSentiment, string> = {
  positive: "text-emerald-700 dark:text-emerald-300",
  mixed: "text-amber-700 dark:text-amber-300",
  neutral: "text-muted-foreground",
  negative: "text-red-700 dark:text-red-300",
};

type Props = {
  campaignId: string;
  approvedItemCount: number;
  initialSynthesis: EngagementSynthesis | null;
  initialSynthesizedAt: string | null;
};

export function EngagementSynthesisPanel({
  campaignId,
  approvedItemCount,
  initialSynthesis,
  initialSynthesizedAt,
}: Props) {
  const router = useRouter();
  const [synthesis, setSynthesis] = useState<EngagementSynthesis | null>(initialSynthesis);
  const [synthesizedAt, setSynthesizedAt] = useState<string | null>(initialSynthesizedAt);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setIsRunning(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/synthesis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload = (await response.json()) as {
        error?: string;
        synthesis?: EngagementSynthesis;
        synthesizedAt?: string;
      };
      if (!response.ok || !payload.synthesis) {
        throw new Error(payload.error || "Failed to synthesize engagement");
      }
      setSynthesis(payload.synthesis);
      setSynthesizedAt(payload.synthesizedAt ?? new Date().toISOString());
      router.refresh();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to synthesize engagement");
    } finally {
      setIsRunning(false);
    }
  }

  const isOffline = synthesis?.source === "deterministic-fallback";
  const grounded = synthesis?.grounding;
  const displayNarrative = synthesis ? stripFactCitationTokens(synthesis.narrative) : "";
  const flaggedSentences = grounded ? listFlaggedNarrativeSentences(grounded) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">AI synthesis</p>
          <p className="text-xs text-muted-foreground">
            Themes, sentiment, and a source-cited narrative over {approvedItemCount} approved comment
            {approvedItemCount === 1 ? "" : "s"}.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void handleGenerate()} disabled={isRunning}>
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {synthesis ? "Regenerate" : "Generate"}
        </Button>
      </div>

      {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}

      {!synthesis ? (
        <p className="text-xs text-muted-foreground">
          No synthesis yet. Generate one to cluster the approved comments into themes with a cited summary.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Overall sentiment:{" "}
              <span className={SENTIMENT_TONE[synthesis.overall_sentiment]}>
                {SENTIMENT_LABEL[synthesis.overall_sentiment]}
              </span>
            </span>
            <span>
              {grounded?.grounded_sentence_count ?? 0}/{grounded?.total_sentence_count ?? 0} sentences cited
            </span>
            {isOffline ? (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5" /> AI offline — deterministic summary
              </span>
            ) : null}
            {synthesizedAt ? <span>Generated {new Date(synthesizedAt).toLocaleString()}</span> : null}
          </div>

          {synthesis.themes.length > 0 ? (
            <div className="space-y-2">
              {synthesis.themes.map((theme, index) => (
                <div key={`${theme.label}-${index}`} className="border-l-2 border-border/60 pl-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{theme.label}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className={SENTIMENT_TONE[theme.sentiment]}>{SENTIMENT_LABEL[theme.sentiment]}</span>
                      {" · "}
                      {theme.item_count} comment{theme.item_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  {theme.summary ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {stripFactCitationTokens(theme.summary)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {displayNarrative ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Narrative</p>
              {displayNarrative.split("\n").filter(Boolean).map((para, index) => (
                <p key={index} className="text-sm leading-relaxed text-foreground">
                  {para}
                </p>
              ))}
            </div>
          ) : null}

          {flaggedSentences.length > 0 ? (
            <details data-testid="synthesis-flagged-sentences">
              <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline">
                <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
                {flaggedSentences.length} sentence{flaggedSentences.length === 1 ? "" : "s"} flagged for review
              </summary>
              <ul className="mt-2 space-y-1.5 border-l-2 border-amber-500/40 pl-3 text-xs text-muted-foreground">
                {flaggedSentences.map((sentence, index) => (
                  <li key={index}>
                    <span className="text-foreground/80">{stripFactCitationTokens(sentence.text)}</span>{" "}
                    <span className="text-[0.68rem] uppercase tracking-wide">
                      {sentence.reason === "missing_citation"
                        ? "— no citation"
                        : sentence.reason === "unfaithful_citation"
                          ? `— figures not in cited comments: ${sentence.unfaithful_claims.join(", ")}`
                          : `— unknown fact ids: ${sentence.unknown_fact_ids.join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{synthesis.caveat}</p>
        </div>
      )}
    </div>
  );
}
