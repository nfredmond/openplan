"use client";

import { useState } from "react";
import { ArrowDownToLine, CloudOff, Loader2, PenLine, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { stripFactCitationTokens } from "@/lib/grants/narrative-grounding";
import { DraftGroundingLine } from "@/components/reports/report-narrative-draft-panel";

/**
 * Chapter draft assist for the RTP chapter editor.
 *
 * Drafts grounded chapter prose (cycle readiness, portfolio funding,
 * engagement posture, modeling evidence, KB excerpts — all deterministic
 * inputs), shows the grounding stats and every flagged sentence, and offers
 * ONE way into the plan: "Insert into editor", which copies the
 * token-stripped markdown into the chapter's content textarea via `onInsert`.
 * `content_markdown` remains the sole published chapter content — the insert
 * makes the text operator-authored, and the stored draft row flips to
 * `accepted` purely as provenance.
 */

/**
 * The cycle's fiscal-constraint finding, as much of it as this panel shows.
 *
 * A chapter MAY be drafted while the verdict is `not_determined` — that is the
 * recorded decision, and refusing would leave a planner with no starting text
 * for the section they most need help with. What may not happen is the
 * undetermined state reaching the editor quietly. The prose says it, the fact
 * list says it to the model, and this says it to the person about to press
 * insert.
 */
export type FiscalConstraintNotice = {
  verdict: string;
  blockers: Array<{ code: string; detail: string }>;
};

export type RtpChapterDraftRow = {
  id: string;
  draft_markdown: string;
  model: string | null;
  status: string;
  grounding_json?: unknown;
  grounded_sentence_count?: number | null;
  total_sentence_count?: number | null;
  created_at?: string | null;
};

export function RtpChapterDraftAssist({
  rtpCycleId,
  chapterId,
  onInsert,
}: {
  rtpCycleId: string;
  chapterId: string;
  onInsert: (markdown: string) => void;
}) {
  const [draft, setDraft] = useState<RtpChapterDraftRow | null>(null);
  const [fiscalConstraint, setFiscalConstraint] = useState<FiscalConstraintNotice | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftEndpoint = `/api/rtp-cycles/${rtpCycleId}/chapters/${chapterId}/draft`;

  async function handleGenerate() {
    setIsGenerating(true);
    setIsOffline(false);
    setInserted(false);
    setError(null);

    try {
      const response = await fetch(draftEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.status === 503) {
        const payload = (await response.json()) as { error?: string; hint?: string };
        if (payload.error === "ai_offline") {
          setIsOffline(true);
        } else {
          setError(payload.hint ?? payload.error ?? "Drafting is unavailable right now");
        }
        return;
      }

      const payload = (await response.json()) as {
        error?: string;
        draft?: RtpChapterDraftRow;
        fiscalConstraint?: FiscalConstraintNotice | null;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "Failed to draft the chapter narrative");
      }

      setDraft(payload.draft);
      setFiscalConstraint(payload.fiscalConstraint ?? null);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Failed to draft the chapter narrative"
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function reviewDraft(action: "accept" | "dismiss", acceptedMarkdown?: string) {
    if (!draft) return null;
    const response = await fetch(draftEndpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        action === "accept"
          ? { action, draftId: draft.id, acceptedMarkdown }
          : { action, draftId: draft.id }
      ),
    });
    const payload = (await response.json()) as { error?: string; draft?: RtpChapterDraftRow };
    if (!response.ok || !payload.draft) {
      throw new Error(payload.error || "Failed to update the chapter draft");
    }
    return payload.draft;
  }

  async function handleInsert() {
    if (!draft) return;
    setIsReviewing(true);
    setError(null);

    const markdown = stripFactCitationTokens(draft.draft_markdown);
    try {
      // The insert into the editor is the operator action; the accepted row is
      // provenance of that action. Insert first so a provenance hiccup never
      // blocks the writing.
      onInsert(markdown);
      setInserted(true);
      if (draft.status === "draft") {
        const updated = await reviewDraft("accept", markdown);
        if (updated) setDraft(updated);
      }
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : "Failed to record the acceptance"
      );
    } finally {
      setIsReviewing(false);
    }
  }

  async function handleDismiss() {
    if (!draft) return;
    setIsReviewing(true);
    setError(null);
    try {
      const updated = await reviewDraft("dismiss");
      if (updated) setDraft(updated);
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : "Failed to dismiss the chapter draft"
      );
    } finally {
      setIsReviewing(false);
    }
  }

  return (
    <div
      className="rounded-xl border border-border/70 bg-background/60 p-4"
      data-testid="rtp-chapter-draft-assist"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" />
          <div>
            <p className="text-sm font-semibold text-foreground">AI chapter draft assist</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Drafts grounded prose from this cycle&apos;s recorded readiness, portfolio, funding,
              engagement, and modeling evidence. Inserted text lands in the editor below for you to
              edit and save — the chapter content stays operator-authored.
            </p>
          </div>
        </div>
        <StatusBadge tone="warning">AI draft — review before use</StatusBadge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isGenerating || isReviewing}
          onClick={handleGenerate}
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : draft ? (
            <RefreshCw className="h-4 w-4" />
          ) : (
            <PenLine className="h-4 w-4" />
          )}
          {draft ? "Regenerate draft" : "Draft chapter narrative"}
        </Button>
        {draft && draft.status !== "dismissed" ? (
          <Button
            type="button"
            size="sm"
            disabled={isGenerating || isReviewing}
            onClick={handleInsert}
            data-testid="rtp-chapter-draft-insert"
          >
            {isReviewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowDownToLine className="h-4 w-4" />
            )}
            Insert into editor
          </Button>
        ) : null}
        {draft && draft.status === "draft" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isGenerating || isReviewing}
            onClick={handleDismiss}
            data-testid="rtp-chapter-draft-dismiss"
          >
            <X className="h-4 w-4" />
            Dismiss
          </Button>
        ) : null}
      </div>

      {isOffline ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-[color:var(--copper)]/40 bg-[color:var(--copper)]/10 px-3 py-2.5 text-xs text-[color:var(--copper)]">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            AI drafting is offline — no Anthropic API key is configured for this deployment. New
            drafts cannot be generated until the key is set.
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {inserted ? (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="rtp-chapter-draft-inserted">
          Draft inserted into the editor below. Edit it as your own text, then save the chapter.
        </p>
      ) : null}

      {draft ? (
        <div className="mt-3 space-y-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
            AI draft{draft.model ? ` · ${draft.model}` : ""}
            {draft.status !== "draft" ? ` · ${draft.status}` : ""}
          </p>
          <DraftGroundingLine draft={draft} />
          {/*
            THE ALERT SITS ABOVE THE PROSE, NOT BESIDE IT.

            A grounding flag says a sentence lacks a citation, which reads as
            "add a source". It does not say the plan's fiscal finding is
            unsettled, and a planner skimming three procedural flags can keep a
            sentence that looks like standard RTP language. This states the
            finding itself, in the operator's own reading order, before the
            paragraph they are about to insert.
          */}
          {fiscalConstraint && fiscalConstraint.verdict === "not_determined" ? (
            <div
              role="note"
              data-testid="chapter-draft-fiscal-alert"
              className="rounded-xl border-l-2 border-[color:var(--copper)] bg-[color:var(--copper)]/8 px-4 py-3 text-sm"
            >
              <p className="font-semibold text-foreground">
                This plan&rsquo;s fiscal constraint is not determined.
              </p>
              <p className="mt-1.5 leading-6 text-foreground/85">
                Nothing in this draft may state or imply that the plan is fiscally constrained, that
                revenues cover programmed costs, or that a constraint demonstration exists. Say that
                the finding is outstanding, and what is still needed.
              </p>
              {fiscalConstraint.blockers.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground/80">
                  {fiscalConstraint.blockers.map((blocker) => (
                    <li key={blocker.code}>{blocker.detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border/70 bg-background px-4 py-3 text-sm leading-6 text-foreground/90 whitespace-pre-wrap">
            {stripFactCitationTokens(draft.draft_markdown)}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No draft yet for this chapter in this session. Generate one to start from a grounded first
          pass.
        </p>
      )}
    </div>
  );
}
