"use client";

/**
 * A BLOCK OF THE PLAN'S OWN TEXT, WAITING IN A CHAPTER.
 *
 * This is the staging row a transcribed block becomes: a
 * `document_narrative_drafts` row against one RTP chapter, badged with the
 * document and page it was copied from, and going nowhere until a person acts.
 *
 * WHAT ACCEPTING DOES AND DOES NOT DO. Accepting records that a planner read
 * this text and stands behind it. It does NOT put the text in the plan —
 * `rtp_cycle_chapters.content_markdown` is written by the chapter editor and by
 * nothing else, which is what keeps published chapter content operator-authored
 * (Nathaniel's Q3 decision, 2026-08-11). The card says so plainly rather than
 * letting "accept" read as "publish", and hands over the text to copy into the
 * editor.
 *
 * THE BADGE STAYS UNTIL A HUMAN ACTS. Until then every surface that shows this
 * text says where it came from — the document, the page, and the note that
 * nobody wrote it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ClipboardCopy, FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  describeTranscribedChapterDraft,
  readTranscribedChapterGrounding,
} from "@/lib/rtp/extraction/chapter-blocks";

export type TranscribedChapterDraftView = {
  id: string;
  status: string;
  draftMarkdown: string;
  acceptedMarkdown: string | null;
  groundingJson: unknown;
};

export function TranscribedChapterDraftCard({
  rtpCycleId,
  chapterId,
  draft,
  documentHref,
  canWrite,
}: {
  rtpCycleId: string;
  chapterId: string;
  draft: TranscribedChapterDraftView;
  documentHref: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(draft.status);
  const [pending, setPending] = useState<null | "accept" | "dismiss">(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const grounding = readTranscribedChapterGrounding(draft.groundingJson);
  const described = grounding ? describeTranscribedChapterDraft(grounding, status) : null;
  const text = draft.acceptedMarkdown ?? draft.draftMarkdown;
  const busy = pending !== null;

  async function review(action: "accept" | "dismiss") {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/chapters/${chapterId}/draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, draftId: draft.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        draft?: { status?: string };
      };
      if (!response.ok) {
        setError(payload.error || "This could not be updated.");
        return;
      }
      setStatus(payload.draft?.status ?? (action === "accept" ? "accepted" : "dismissed"));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This could not be updated.");
    } finally {
      setPending(null);
    }
  }

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // A browser that refuses clipboard access is not a failure to report as
      // one: the text is on the screen and can be selected.
      setError("Your browser would not let OpenPlan copy this. Select the text above and copy it.");
    }
  }

  return (
    <article
      className="space-y-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-4"
      data-testid="transcribed-chapter-draft-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-sky-300/60 bg-sky-50/60 px-2 py-0.5 text-[0.7rem] font-medium text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
          Transcribed — not written by anyone
        </span>
        {described ? (
          <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground">
            <FileText className="h-3 w-3" aria-hidden="true" />
            {documentHref ? (
              <a href={documentHref} className="underline underline-offset-2">
                {described.badge}
              </a>
            ) : (
              described.badge
            )}
          </span>
        ) : null}
        <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{status}</span>
      </div>

      {described ? <p className="text-xs text-muted-foreground">{described.detail}</p> : null}

      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-[0.4rem] border border-border/70 bg-background px-4 py-3 font-sans text-sm leading-6 text-foreground/90">
        {text}
      </pre>

      {copied ? (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
          Copied. Paste it into the chapter editor, edit it as your own text, and save the chapter.
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={copy} disabled={busy}>
          <ClipboardCopy className="mr-1.5 h-4 w-4" />
          Copy the text
        </Button>
        {canWrite && status === "draft" ? (
          <>
            <Button type="button" size="sm" onClick={() => review("accept")} disabled={busy}>
              {pending === "accept" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Accept this text
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => review("dismiss")} disabled={busy}>
              {pending === "dismiss" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-1.5 h-4 w-4" />
              )}
              Set aside
            </Button>
          </>
        ) : null}
      </div>

      {status === "draft" ? (
        <p className="text-[0.7rem] text-muted-foreground">
          Accepting records that you have read this and stand behind it. It does not put it in the
          plan — the chapter&apos;s text is what you write in the chapter editor, so copy this in and
          save the chapter when you want it there.
        </p>
      ) : null}
    </article>
  );
}
