"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ShieldAlert, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";

type BulkItem = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  title: string | null;
  status: string;
  source_type: string;
};

type CategoryOption = {
  id: string;
  label: string;
};

export function EngagementBulkModeration({
  campaignId,
  items,
  categories,
}: {
  campaignId: string;
  items: BulkItem[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const pendingItems = items.filter((i) => i.status === "pending");
  const flaggedItems = items.filter((i) => i.status === "flagged");

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((subset: BulkItem[]) => {
    setSelectedIds(new Set(subset.map((i) => i.id)));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  async function bulkUpdateStatus(newStatus: string) {
    if (selectedIds.size === 0) return;
    setError(null);
    setResult(null);
    setIsProcessing(true);

    let successCount = 0;
    let failCount = 0;

    // Process in serial to avoid overwhelming the API
    for (const itemId of selectedIds) {
      try {
        const response = await fetch(`/api/engagement/campaigns/${campaignId}/items/${itemId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });

        if (response.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    setIsProcessing(false);
    setResult(`Updated ${successCount} item${successCount === 1 ? "" : "s"} to ${titleizeEngagementValue(newStatus)}.${failCount > 0 ? ` ${failCount} failed.` : ""}`);
    setSelectedIds(new Set());
    router.refresh();
  }

  if (pendingItems.length === 0 && flaggedItems.length === 0) {
    return null;
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Bulk moderation</p>
          <h2 className="module-section-title">Quick triage queue</h2>
          <p className="module-section-description">
            Select items and apply status changes in bulk. Showing {pendingItems.length} pending and {flaggedItems.length} flagged items.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <Zap className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => selectAll([...pendingItems, ...flaggedItems])}
        >
          Select all actionable ({pendingItems.length + flaggedItems.length})
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => selectAll(pendingItems)}>
          Select pending ({pendingItems.length})
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => selectAll(flaggedItems)}>
          Select flagged ({flaggedItems.length})
        </Button>
        {selectedIds.size > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
            Clear selection ({selectedIds.size})
          </Button>
        )}
      </div>

      <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-border/70">
        {[...pendingItems, ...flaggedItems].map((item) => (
          <label
            key={item.id}
            className={`flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2 text-sm transition last:border-b-0 hover:bg-accent/30 ${
              selectedIds.has(item.id) ? "bg-primary/5" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => toggleItem(item.id)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            <StatusBadge tone={engagementStatusTone(item.status)} className="shrink-0">
              {titleizeEngagementValue(item.status)}
            </StatusBadge>
            <span className="truncate">
              {item.title || "Untitled"}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {item.category_id ? categories.find((c) => c.id === item.category_id)?.label ?? "Categorized" : "Uncategorized"}
            </span>
          </label>
        ))}
      </div>

      {selectedIds.size > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={isProcessing}
            onClick={() => void bulkUpdateStatus("approved")}
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve {selectedIds.size} selected
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isProcessing}
            onClick={() => void bulkUpdateStatus("flagged")}
          >
            <ShieldAlert className="h-4 w-4" />
            Flag {selectedIds.size} selected
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isProcessing}
            onClick={() => void bulkUpdateStatus("rejected")}
          >
            <Trash2 className="h-4 w-4" />
            Reject {selectedIds.size} selected
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      )}
      {result && (
        <p className="mt-3 text-sm text-[color:var(--pine)]">{result}</p>
      )}
    </article>
  );
}
