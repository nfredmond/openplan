"use client";

/**
 * ONE VERBATIM BLOCK OF AN ADOPTED PLAN, WAITING FOR A CHAPTER.
 *
 * The card shows the plan's own sentence, the page it is printed on, and a way
 * to open the document — and then asks a person one question: which chapter of
 * the plan you are writing is this text for?
 *
 * NOTHING HERE MATCHES TEXT TO A CHAPTER. The select starts empty and staging
 * is refused until somebody picks. A default would be a machine deciding which
 * of an adopted plan's paragraphs become the next plan's policy, which is
 * authorship however good the guess is. Q6's rule for projects — the document
 * names it, the person binds it — is the same rule, applied to prose.
 *
 * THERE IS NO "STAGE ALL". Each block is one decision and one click, on
 * purpose: a button that emptied this queue would put forty paragraphs into a
 * public plan on one press.
 *
 * NO SCORE. The card shows the words and the page, which are the two things a
 * planner can actually check.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The request field, spelled here rather than imported.
 *
 * `lib/rtp/extraction/acceptance.ts` owns the name and every server route takes
 * it from there — but that module reaches `next/headers` through the Supabase
 * server client, so importing it into a client component fails the production
 * build outright. (The financial review card spells it inline for the same
 * reason.) A literal in two places drifts, so the drift is caught rather than
 * trusted: `rtp-transcribed-chapter-cards.test.tsx` imports the real constant
 * and asserts that THIS card posts under it.
 */
const FROM_EXTRACTION_CANDIDATE_FIELD = "fromExtractionCandidateId";

export type TranscribedBlockChapterOption = { id: string; title: string };

export type TranscribedBlockCandidateView = {
  id: string;
  page: number;
  quote: string;
  /** Set when this block cannot be staged at all, in the words the planner reads. */
  blockedReason: string | null;
};

export function TranscribedChapterBlockCard({
  rtpCycleId,
  candidate,
  chapters,
  documentTitle,
  documentHref,
  canWrite,
}: {
  rtpCycleId: string;
  candidate: TranscribedBlockCandidateView;
  chapters: readonly TranscribedBlockChapterOption[];
  documentTitle: string;
  /** Members only; null when the source document could not be resolved. */
  documentHref: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [chapterId, setChapterId] = useState("");
  const [pending, setPending] = useState<null | "stage" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<null | "staged" | "set_aside">(null);

  const busy = pending !== null;

  async function stage() {
    if (!chapterId) {
      setError("Choose which chapter of your plan this text belongs in.");
      return;
    }
    setPending("stage");
    setError(null);
    try {
      const response = await fetch(
        `/api/rtp-cycles/${rtpCycleId}/chapters/${chapterId}/transcribed-blocks`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [FROM_EXTRACTION_CANDIDATE_FIELD]: candidate.id }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
        extractionCandidate?: { recorded?: boolean; warning?: string };
      };
      if (!response.ok) {
        setError(
          [payload.error, payload.details].filter(Boolean).join(" ") ||
            "This passage could not be staged."
        );
        return;
      }
      if (payload.extractionCandidate && payload.extractionCandidate.recorded === false) {
        setError(payload.extractionCandidate.warning ?? null);
      }
      setOutcome("staged");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This passage could not be staged.");
    } finally {
      setPending(null);
    }
  }

  async function setAside() {
    setPending("reject");
    setError(null);
    try {
      const response = await fetch(
        `/api/rtp-cycles/${rtpCycleId}/extraction-candidates/${candidate.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reject" }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!response.ok) {
        setError(
          [payload.error, payload.details].filter(Boolean).join(" ") || "This could not be set aside."
        );
        return;
      }
      setOutcome("set_aside");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This could not be set aside.");
    } finally {
      setPending(null);
    }
  }

  return (
    <article
      className="space-y-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-4"
      data-testid="transcribed-chapter-block-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
          The plan&apos;s own words
        </span>
        <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground">
          <FileText className="h-3 w-3" aria-hidden="true" />
          {documentHref ? (
            <a href={documentHref} className="underline underline-offset-2">
              {documentTitle}, page {candidate.page}
            </a>
          ) : (
            <>
              {documentTitle}, page {candidate.page}
            </>
          )}
        </span>
      </div>

      {/* THE DOCUMENT'S OWN WORDS. The reason this card can be trusted at all. */}
      <blockquote className="border-l-2 border-border/70 pl-3 text-sm italic text-foreground">
        {candidate.quote}
      </blockquote>

      {candidate.blockedReason ? (
        <p className="rounded-[0.4rem] border border-amber-300/60 bg-amber-50/40 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          {candidate.blockedReason}
        </p>
      ) : null}

      {outcome === "staged" ? (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
          Put into the chapter&apos;s waiting text, citing page {candidate.page}. It is not in the plan
          yet — accept it below and put it into the chapter editor.
        </p>
      ) : null}
      {outcome === "set_aside" ? (
        <p className="text-xs font-medium text-muted-foreground">
          Set aside. Nothing was added to any chapter.
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      {canWrite && outcome === null ? (
        <div className="flex flex-wrap items-end gap-2">
          {candidate.blockedReason ? null : (
            <label className="space-y-1 text-xs">
              <span className="block font-medium text-foreground">Which chapter is this for?</span>
              <select
                className="h-9 w-full min-w-[16rem] rounded-[0.4rem] border border-border bg-background px-2 text-sm"
                value={chapterId}
                onChange={(event) => setChapterId(event.target.value)}
                disabled={busy || chapters.length === 0}
                aria-label="Which chapter is this for?"
              >
                <option value="">Choose a chapter</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {candidate.blockedReason ? null : (
            <Button type="button" size="sm" onClick={stage} disabled={busy}>
              {pending === "stage" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Put into this chapter
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={setAside} disabled={busy}>
            {pending === "reject" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <X className="mr-1.5 h-4 w-4" />
            )}
            Set aside
          </Button>
        </div>
      ) : null}

      {!canWrite ? (
        <p className="text-xs text-muted-foreground">
          You can read what was copied out of this document. Putting it into a chapter, or setting it
          aside, needs permission to change plans.
        </p>
      ) : null}
    </article>
  );
}
