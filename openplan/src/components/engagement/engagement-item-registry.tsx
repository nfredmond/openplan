"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ENGAGEMENT_ITEM_STATUSES, engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";

type CategoryOption = {
  id: string;
  label: string;
};

type ItemRecord = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  title: string | null;
  body: string;
  submitted_by: string | null;
  status: string;
  source_type: string;
  moderation_notes: string | null;
  updated_at: string;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function ItemRow({
  item,
  categories,
}: {
  item: ItemRecord;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(item.status);
  const [categoryId, setCategoryId] = useState(item.category_id ?? "");
  const [moderationNotes, setModerationNotes] = useState(item.moderation_notes ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${item.campaign_id}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          categoryId: categoryId || null,
          moderationNotes: moderationNotes || null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update engagement item");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update engagement item");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="module-record-row">
      <div className="module-record-head">
        <div className="module-record-main">
          <div className="module-record-kicker">
            <StatusBadge tone={engagementStatusTone(item.status)}>{titleizeEngagementValue(item.status)}</StatusBadge>
            <StatusBadge tone="info">{titleizeEngagementValue(item.source_type)}</StatusBadge>
            {item.category_id ? (
              <StatusBadge tone="neutral">{categories.find((category) => category.id === item.category_id)?.label ?? "Category"}</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Uncategorized</StatusBadge>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="module-record-title text-[1rem]">{item.title || "Untitled feedback item"}</h3>
              <p className="module-record-stamp">Updated {fmtDateTime(item.updated_at)}</p>
            </div>
            <p className="module-record-summary whitespace-pre-wrap">{item.body}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[0.9fr_1.1fr_auto]">
        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold">Category</label>
          <select
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold">Moderation notes</label>
          <textarea
            className="min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={moderationNotes}
            onChange={(event) => setModerationNotes(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold">Status</label>
          <select
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {ENGAGEMENT_ITEM_STATUSES.map((value) => (
              <option key={value} value={value}>
                {titleizeEngagementValue(value)}
              </option>
            ))}
          </select>

          <Button type="button" disabled={isSubmitting} onClick={handleSave}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>

      <div className="mt-3 module-record-meta">
        <span className="module-record-chip">Submitter {item.submitted_by || "Unknown"}</span>
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function EngagementItemRegistry({
  items,
  categories,
}: {
  items: ItemRecord[];
  categories: CategoryOption[];
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Moderation</p>
          <h2 className="module-section-title">Recent intake registry</h2>
          <p className="module-section-description">
            This first pass keeps moderation narrow: status, category assignment, and internal notes.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} categories={categories} />
        ))}
      </div>
    </article>
  );
}
