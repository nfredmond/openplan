"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModerationQueueView, ModerationSeverity } from "@/lib/engagement/ai-moderation-shared";
import { MODERATION_CAVEAT } from "@/lib/engagement/ai-moderation-shared";

const SEVERITY_TONE: Record<ModerationSeverity, string> = {
  high: "text-red-700 dark:text-red-300",
  medium: "text-amber-700 dark:text-amber-300",
  low: "text-muted-foreground",
  none: "text-muted-foreground",
};

const FLAG_LABEL: Record<string, string> = {
  toxicity: "Toxicity",
  pii: "Personal info",
  off_topic: "Off-topic",
  spam: "Spam",
};

// The flagged-item shape and the queue assembly live in ai-moderation-shared.ts,
// beside the vocabulary the scan writes. Re-exported so this component stays the
// one import path for anything rendering moderation.
export type { ModeratedItem } from "@/lib/engagement/ai-moderation-shared";

export function AiModerationPanel({
  campaignId,
  queue,
}: {
  campaignId: string;
  queue: ModerationQueueView;
}) {
  const { queueItemCount: queueCount, flagged, lastSource, unreadableAssessmentCount } = queue;
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handleScan() {
    setError(null);
    setNote(null);
    setIsRunning(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/moderation-scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload = (await response.json()) as {
        error?: string;
        moderation?: { source: string; flagged_count: number; item_count: number };
      };
      if (!response.ok || !payload.moderation) {
        throw new Error(payload.error || "Failed to run moderation scan");
      }
      setNote(
        `Scanned ${payload.moderation.item_count} queued comment${payload.moderation.item_count === 1 ? "" : "s"}; ${payload.moderation.flagged_count} flagged${payload.moderation.source === "deterministic-fallback" ? " (AI offline — heuristic PII/spam only)" : ""}.`
      );
      router.refresh();
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Failed to run moderation scan");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">AI moderation assist</p>
          <p className="text-xs text-muted-foreground">
            Flags possible toxicity, personal info, off-topic, or spam across the {queueCount} comment
            {queueCount === 1 ? "" : "s"} still awaiting review — with a rationale. Never auto-rejects.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void handleScan()} disabled={isRunning}>
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
          Run scan
        </Button>
      </div>

      {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}

      {/* An assessment this build cannot interpret is an unknown, and saying
          "nothing is flagged" over the top of one would be a clean bill of
          health issued by a parse failure. Disclosed above the list so it is
          read whether or not anything else was flagged. */}
      {unreadableAssessmentCount > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {unreadableAssessmentCount} queued comment{unreadableAssessmentCount === 1 ? " carries" : "s carry"} a stored
          assessment this version cannot read, so {unreadableAssessmentCount === 1 ? "it is" : "they are"} not
          summarized here. Re-run the scan to refresh {unreadableAssessmentCount === 1 ? "it" : "them"}.
        </p>
      ) : null}

      {flagged.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--pine)]" />
          {unreadableAssessmentCount > 0
            ? "Nothing else in the queue is flagged."
            : lastSource
              ? "No queued comments are currently flagged."
              : "Run a scan to flag comments that may need a closer look."}
        </p>
      ) : (
        <div className="space-y-2">
          {flagged.map((item) => (
            <div key={item.id} className="border-l-2 border-border/60 pl-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-xs leading-relaxed text-foreground">“{item.snippet}”</p>
                <p className="text-xs whitespace-nowrap">
                  <span className={SEVERITY_TONE[item.moderation.severity]}>
                    {item.moderation.flags.map((f) => FLAG_LABEL[f] ?? f).join(", ")}
                  </span>
                </p>
              </div>
              <p className="mt-0.5 text-[0.7rem] leading-relaxed text-muted-foreground">{item.moderation.rationale}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{MODERATION_CAVEAT}</p>
    </div>
  );
}
