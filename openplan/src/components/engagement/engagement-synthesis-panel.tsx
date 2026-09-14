"use client";

import { ShieldAlert } from "lucide-react";
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
  initialSynthesis: EngagementSynthesis | null;
  initialSynthesizedAt: string | null;
};

/** Inspect the earlier mutable-format record without regenerating or assigning it new provenance. */
export function EngagementSynthesisPanel({ initialSynthesis: synthesis, initialSynthesizedAt: synthesizedAt }: Props) {
  const isOffline = synthesis?.source === "deterministic-fallback";
  const grounded = synthesis?.grounding;
  const displayNarrative = synthesis ? stripFactCitationTokens(synthesis.narrative) : "";
  const flaggedSentences = grounded ? listFlaggedNarrativeSentences(grounded) : [];

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-foreground">Earlier synthesis summary</p>
      <p className="text-xs text-muted-foreground">
        Read-only historical output from the retired generator. It could include at most 300 approved comments,
        omit survey answers and shorten comment text. Complete source coverage, current relevance and staff
        approval are not established. Citation markers alone do not establish accuracy.
      </p>
      <p className="text-xs text-muted-foreground">
        For new work, use retained synthesis sources and staff reviews in Analysis. These preserve selected
        contributions and reasoned corrections; they do not generate AI themes or approve findings.
      </p>

      {!synthesis ? (
        <p className="text-xs text-muted-foreground">
          No earlier synthesis summary is saved.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Stored sentiment label:{" "}
              <span className={SENTIMENT_TONE[synthesis.overall_sentiment]}>
                {SENTIMENT_LABEL[synthesis.overall_sentiment]}
              </span>
            </span>
            <span>
              {grounded?.grounded_sentence_count ?? 0}/{grounded?.total_sentence_count ?? 0} stored sentences carry citations
            </span>
            {isOffline ? (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5" /> Historical category grouping; neutral labels were not a sentiment assessment
              </span>
            ) : null}
            {synthesizedAt ? <span>Recorded {new Date(synthesizedAt).toLocaleString()}</span> : null}
          </div>

          <p className="text-xs text-muted-foreground">
            Stored counts: {synthesis.analyzed_item_count} analyzed of {synthesis.item_count} supplied comments.
          </p>
          <p className="text-xs text-muted-foreground">
            These counts do not establish coverage of the full consultation.
          </p>
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
            <details id="synthesis-flagged-sentences" data-testid="synthesis-flagged-sentences">
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

          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">Original record caveat: {synthesis.caveat}</p>
        </div>
      )}
    </div>
  );
}
