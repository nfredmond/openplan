"use client";

import { useMemo, useState } from "react";
import {
  Check,
  CloudOff,
  Loader2,
  PenLine,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  listFlaggedNarrativeSentences,
  parseStoredNarrativeGrounding,
  stripFactCitationTokens,
} from "@/lib/grants/narrative-grounding";

/**
 * Section narrative drafting for the report composer — modeled on the grants
 * narrative draft panel, plus the review actions that panel does not need:
 * a draft here can be ACCEPTED into the next generated packet (as-is only when
 * fully grounded; edited text becomes operator-authored) or dismissed
 * (terminal). Only whitelisted sections are offered; the server enforces the
 * same whitelist and the accept gate.
 */

export type ReportNarrativeDraftRow = {
  id: string;
  section_key: string | null;
  draft_markdown: string;
  model: string | null;
  status: string;
  grounding_json?: unknown;
  grounded_sentence_count?: number | null;
  total_sentence_count?: number | null;
  accepted_markdown?: string | null;
  accepted_at?: string | null;
  created_at?: string | null;
};

export type ReportNarrativeDraftSection = {
  sectionKey: string;
  title: string;
};

function formatCreatedAt(value: string | null | undefined): string {
  if (!value) return "unknown time";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ReportNarrativeDraftPanel({
  reportId,
  sections,
  initialDrafts,
}: {
  reportId: string;
  sections: ReportNarrativeDraftSection[];
  initialDrafts: Record<string, ReportNarrativeDraftRow | null>;
}) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <article id="report-narrative-draft-panel" className="module-section-surface" data-testid="report-narrative-draft-panel">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">AI narrative assist</p>
          <h2 className="module-section-title">Section narrative drafts</h2>
          <p className="module-section-description">
            Draft the summary section as grounded prose, review every flagged sentence, then accept
            or dismiss. Only accepted drafts appear in generated packets, always labeled as
            AI-assisted; everything else in the packet stays deterministic.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/12 text-violet-700 dark:text-violet-300">
          <Sparkles className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 space-y-5">
        {sections.map((section) => (
          <SectionDraftCard
            key={section.sectionKey}
            reportId={reportId}
            section={section}
            initialDraft={initialDrafts[section.sectionKey] ?? null}
          />
        ))}
      </div>
    </article>
  );
}

function SectionDraftCard({
  reportId,
  section,
  initialDraft,
}: {
  reportId: string;
  section: ReportNarrativeDraftSection;
  initialDraft: ReportNarrativeDraftRow | null;
}) {
  const [draft, setDraft] = useState<ReportNarrativeDraftRow | null>(initialDraft);
  const [editText, setEditText] = useState<string>(() =>
    initialDraft && initialDraft.status === "draft"
      ? stripFactCitationTokens(initialDraft.draft_markdown)
      : ""
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setIsGenerating(true);
    setIsOffline(false);
    setError(null);

    try {
      const response = await fetch(`/api/reports/${reportId}/narrative-draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionKey: section.sectionKey }),
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
        draft?: ReportNarrativeDraftRow;
      };

      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "Failed to draft the section narrative");
      }

      setDraft(payload.draft);
      setEditText(stripFactCitationTokens(payload.draft.draft_markdown));
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Failed to draft the section narrative"
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleReview(action: "accept" | "dismiss") {
    if (!draft) return;
    setIsReviewing(true);
    setError(null);

    try {
      const response = await fetch(`/api/reports/${reportId}/narrative-draft/${draft.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "accept"
            ? { action, acceptedMarkdown: editText.trim() || undefined }
            : { action }
        ),
      });

      const payload = (await response.json()) as {
        error?: string;
        draft?: ReportNarrativeDraftRow;
      };

      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "Failed to update the draft");
      }

      setDraft(payload.draft);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to update the draft");
    } finally {
      setIsReviewing(false);
    }
  }

  const statusTone =
    draft?.status === "accepted" ? "success" : draft?.status === "dismissed" ? "neutral" : "warning";
  const statusLabel =
    draft?.status === "accepted"
      ? "Accepted — included in next generation"
      : draft?.status === "dismissed"
        ? "Dismissed"
        : draft
          ? "AI draft — review before accepting"
          : "No draft yet";

  return (
    <div
      className="rounded-xl border border-border/70 bg-background/60 p-4"
      data-testid={`narrative-draft-section-${section.sectionKey}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{section.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Section key <code>{section.sectionKey}</code>
          </p>
        </div>
        <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
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
          {draft ? "Regenerate draft" : "Draft narrative"}
        </Button>
        {draft && draft.status === "draft" ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={isReviewing || isGenerating}
              onClick={() => handleReview("accept")}
              data-testid={`narrative-draft-accept-${section.sectionKey}`}
            >
              {isReviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Accept for packet
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isReviewing || isGenerating}
              onClick={() => handleReview("dismiss")}
              data-testid={`narrative-draft-dismiss-${section.sectionKey}`}
            >
              <X className="h-4 w-4" />
              Dismiss
            </Button>
          </>
        ) : null}
      </div>

      {isOffline ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-[color:var(--copper)]/40 bg-[color:var(--copper)]/10 px-3 py-2.5 text-xs text-[color:var(--copper)]">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            AI drafting is offline — no Anthropic API key is configured for this deployment. Stored
            drafts remain available; new drafts cannot be generated until the key is set.
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {draft ? (
        <div className="mt-3 space-y-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
            AI draft{draft.model ? ` · ${draft.model}` : ""} · {formatCreatedAt(draft.created_at)}
          </p>
          <DraftGroundingLine draft={draft} anchorId={`narrative-grounding-line-${section.sectionKey}`} />
          {draft.status === "draft" ? (
            <>
              <Textarea
                rows={8}
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                aria-label={`Edit ${section.title} draft`}
                data-testid={`narrative-draft-edit-${section.sectionKey}`}
              />
              <p className="text-xs text-muted-foreground">
                Accepting unedited text requires every sentence to pass grounding checks. Editing the
                text makes it operator-authored and accepts on your authority.
              </p>
            </>
          ) : draft.status === "accepted" ? (
            <div className="rounded-xl border border-border/70 bg-background px-4 py-3 text-sm leading-6 text-foreground/90 whitespace-pre-wrap">
              {stripFactCitationTokens(draft.accepted_markdown ?? draft.draft_markdown)}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This draft was dismissed (terminal). Generate a new draft to try again.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No stored draft for this section yet. Generate one to start from a grounded first pass.
        </p>
      )}
    </div>
  );
}

/**
 * Grounding stats + flagged-sentence disclosure for one stored draft row.
 * Exported for reuse by the RTP chapter draft assist, which reviews the same
 * document_narrative_drafts rows.
 */
export function DraftGroundingLine({
  draft,
  anchorId,
}: {
  draft: Pick<
    ReportNarrativeDraftRow,
    "grounding_json" | "grounded_sentence_count" | "total_sentence_count"
  >;
  /**
   * The element id to render, when the caller has a deep link to honour. One
   * of these exists per drafted section, so the id must carry the section's
   * key — the report page's Packet tab claims them by the
   * `narrative-grounding-line-` prefix rather than by a bare name.
   */
  anchorId?: string;
}) {
  const grounding = useMemo(() => parseStoredNarrativeGrounding(draft.grounding_json), [draft]);

  const groundedCount = draft.grounded_sentence_count ?? grounding?.grounded_sentence_count ?? null;
  const totalCount = draft.total_sentence_count ?? grounding?.total_sentence_count ?? null;

  if (groundedCount === null || totalCount === null) {
    return (
      <p id={anchorId} className="text-xs text-muted-foreground" data-testid="narrative-grounding-line">
        Grounding check not recorded for this draft.
      </p>
    );
  }

  const flagged = grounding ? listFlaggedNarrativeSentences(grounding) : [];
  const fullyGrounded = flagged.length === 0 && groundedCount === totalCount;

  return (
    <div
      id={anchorId}
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
