"use client";

import { useMemo } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import {
  listFlaggedNarrativeSentences,
  parseStoredNarrativeGrounding,
  stripFactCitationTokens,
} from "@/lib/grants/narrative-grounding";

/**
 * The grounding summary line rendered under every stored AI draft: how many
 * sentences cite verifiable workspace facts, with the flagged sentences behind
 * a disclosure for operator review. Shared by the whole-opportunity narrative
 * panel and the per-section application workspace so the two surfaces can
 * never drift in how they present the same stored verdict.
 */
export function NarrativeGroundingSummaryLine({
  groundingJson,
  groundedCount: groundedCountProp,
  totalCount: totalCountProp,
}: {
  groundingJson: unknown;
  groundedCount: number | null;
  totalCount: number | null;
}) {
  const grounding = useMemo(() => parseStoredNarrativeGrounding(groundingJson), [groundingJson]);

  const groundedCount = groundedCountProp ?? grounding?.grounded_sentence_count ?? null;
  const totalCount = totalCountProp ?? grounding?.total_sentence_count ?? null;

  if (groundedCount === null || totalCount === null) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="narrative-grounding-line">
        Grounding check not recorded for this draft (generated before citation validation).
      </p>
    );
  }

  const flagged = grounding ? listFlaggedNarrativeSentences(grounding) : [];
  const fullyGrounded = flagged.length === 0 && groundedCount === totalCount;

  return (
    <div
      className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs"
      data-testid="narrative-grounding-line"
    >
      <p className="flex items-center gap-1.5 font-medium text-foreground/90">
        {fullyGrounded ? (
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[color:var(--pine)]" />
        ) : (
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[color:var(--copper)]" />
        )}
        {groundedCount} of {totalCount} sentences cite verifiable workspace facts
      </p>
      {flagged.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline">
            {flagged.length} sentence{flagged.length === 1 ? "" : "s"} flagged for operator review
          </summary>
          <ul className="mt-2 space-y-1.5 border-l-2 border-[color:var(--copper)]/40 pl-3">
            {flagged.map((sentence, index) => (
              <li key={index} className="text-muted-foreground">
                <span className="text-foreground/80">{stripFactCitationTokens(sentence.text)}</span>{" "}
                <span className="text-[0.68rem] uppercase tracking-wide">
                  {sentence.reason === "missing_citation"
                    ? "— no citation"
                    : sentence.reason === "unfaithful_citation"
                      ? `— figure${sentence.unfaithful_claims.length === 1 ? "" : "s"} not in cited facts: ${sentence.unfaithful_claims.join(", ")}`
                      : `— unknown fact id${sentence.unknown_fact_ids.length === 1 ? "" : "s"}: ${sentence.unknown_fact_ids.join(", ")}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
