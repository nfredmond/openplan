"use client";

import { useState } from "react";
import { Check, CloudOff, Copy, Loader2, PenLine, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";

export type FundingOpportunityNarrativeDraftRow = {
  id: string;
  draft_markdown: string;
  model: string | null;
  source: string;
  created_at: string;
};

function formatCreatedAt(value: string): string {
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

export function FundingOpportunityNarrativeDraftPanel({
  opportunityId,
  initialDraft,
}: {
  opportunityId: string;
  initialDraft: FundingOpportunityNarrativeDraftRow | null;
}) {
  const [draft, setDraft] = useState<FundingOpportunityNarrativeDraftRow | null>(initialDraft);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setIsGenerating(true);
    setIsOffline(false);
    setError(null);

    try {
      const response = await fetch(`/api/funding-opportunities/${opportunityId}/narrative-draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.status === 503) {
        setIsOffline(true);
        return;
      }

      const payload = (await response.json()) as {
        error?: string;
        draft?: FundingOpportunityNarrativeDraftRow;
      };

      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "Failed to draft the narrative");
      }

      setDraft(payload.draft);
    } catch (generateError) {
      setError(
        generateError instanceof Error ? generateError.message : "Failed to draft the narrative"
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleCopy() {
    if (!draft) return;
    try {
      await navigator.clipboard?.writeText(draft.draft_markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the draft to the clipboard");
    }
  }

  return (
    <div className="module-note mt-4 text-sm" data-testid="narrative-draft-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">Grant narrative draft</p>
          <p className="mt-1 text-muted-foreground">
            Drafts a 3-5 paragraph need/readiness narrative grounded in this opportunity, its linked
            project funding summary, and stored modeling evidence. Always operator-reviewed before it
            leaves OpenPlan.
          </p>
        </div>
        <StatusBadge tone="warning">AI draft — review before use</StatusBadge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isGenerating} onClick={handleGenerate}>
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : draft ? (
            <RefreshCw className="h-4 w-4" />
          ) : (
            <PenLine className="h-4 w-4" />
          )}
          {draft ? "Regenerate draft" : "Draft narrative"}
        </Button>
        {draft ? (
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy markdown"}
          </Button>
        ) : null}
      </div>

      {isOffline ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-[color:var(--copper)]/40 bg-[color:var(--copper)]/10 px-3 py-2.5 text-[color:var(--copper)]">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            AI drafting is offline — no Anthropic API key is configured for this deployment. Stored
            drafts remain available; new drafts cannot be generated until the key is set.
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-destructive">{error}</p> : null}

      {draft ? (
        <div className="mt-3 space-y-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
            {draft.source === "ai" ? "AI draft" : "Draft"}
            {draft.model ? ` · ${draft.model}` : ""} · {formatCreatedAt(draft.created_at)}
          </p>
          <div
            className="chapter-markdown rounded-xl border border-border/70 bg-background px-4 py-4 text-sm leading-7 text-foreground/90"
            dangerouslySetInnerHTML={{ __html: renderChapterMarkdownToHtml(draft.draft_markdown) }}
          />
        </div>
      ) : (
        <p className="mt-3 text-muted-foreground">
          No stored draft yet for this opportunity. Generate one to start from a grounded first pass.
        </p>
      )}
    </div>
  );
}
