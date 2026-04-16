"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Search, ShieldAlert, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ENGAGEMENT_ITEM_SOURCE_TYPES,
  ENGAGEMENT_ITEM_STATUSES,
  engagementStatusTone,
  titleizeEngagementValue,
} from "@/lib/engagement/catalog";
import { StatusBadge } from "@/components/ui/status-badge";

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
  latitude?: number | null;
  longitude?: number | null;
  updated_at: string;
};

type RegistryCounts = {
  totalItems: number;
  uncategorizedItems: number;
  geographyCoverage: {
    geolocatedItems: number;
  };
  moderationQueue: {
    actionableCount: number;
    pendingCount: number;
    flaggedCount: number;
  };
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function parseCoordinateInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function ItemRow({
  item,
  categories,
}: {
  item: ItemRecord;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(item.title ?? "");
  const [body, setBody] = useState(item.body);
  const [submittedBy, setSubmittedBy] = useState(item.submitted_by ?? "");
  const [sourceType, setSourceType] = useState(item.source_type);
  const [status, setStatus] = useState(item.status);
  const [categoryId, setCategoryId] = useState(item.category_id ?? "");
  const [moderationNotes, setModerationNotes] = useState(item.moderation_notes ?? "");
  const [latitude, setLatitude] = useState(item.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(item.longitude?.toString() ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitItem(nextStatus?: string) {
    const nextLatitude = parseCoordinateInput(latitude);
    const nextLongitude = parseCoordinateInput(longitude);

    if (Number.isNaN(nextLatitude) || Number.isNaN(nextLongitude)) {
      setError("Latitude and longitude must be valid numbers when provided.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${item.campaign_id}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title || null,
          body,
          submittedBy: submittedBy || null,
          sourceType,
          status: nextStatus ?? status,
          categoryId: categoryId || null,
          moderationNotes: moderationNotes || null,
          latitude: nextLatitude,
          longitude: nextLongitude,
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

  async function handleSave() {
    setError(null);
    await submitItem();
  }

  async function handleQuickStatus(nextStatus: string) {
    setError(null);
    setStatus(nextStatus);
    await submitItem(nextStatus);
  }

  return (
    <div className="module-record-row">
      <div className="module-record-head">
        <div className="module-record-main">
          <div className="module-record-kicker">
            <StatusBadge tone={engagementStatusTone(status)}>{titleizeEngagementValue(status)}</StatusBadge>
            <StatusBadge tone="info">{titleizeEngagementValue(sourceType)}</StatusBadge>
            {categoryId ? (
              <StatusBadge tone="neutral">{categories.find((category) => category.id === categoryId)?.label ?? "Category"}</StatusBadge>
            ) : (
              <StatusBadge tone="warning">Uncategorized</StatusBadge>
            )}
            {(latitude || longitude) && <StatusBadge tone="neutral">Geolocated</StatusBadge>}
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="module-record-title text-[1rem]">{title || "Untitled feedback item"}</h3>
              <p className="module-record-stamp">Updated {fmtDateTime(item.updated_at)}</p>
            </div>
            <p className="module-record-summary whitespace-pre-wrap">{body}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-title-${item.id}`}>
            Title
          </label>
          <Input id={`engagement-item-title-${item.id}`} value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-submitter-${item.id}`}>
            Submitter/source label
          </label>
          <Input
            id={`engagement-item-submitter-${item.id}`}
            value={submittedBy}
            onChange={(event) => setSubmittedBy(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-body-${item.id}`}>
          Body
        </label>
        <Textarea
          id={`engagement-item-body-${item.id}`}
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[0.95fr_0.95fr_1.1fr]">
        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-category-${item.id}`}>
            Category
          </label>
          <select
            id={`engagement-item-category-${item.id}`}
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
          <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-status-${item.id}`}>
            Status
          </label>
          <select
            id={`engagement-item-status-${item.id}`}
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
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-source-${item.id}`}>
            Source type
          </label>
          <select
            id={`engagement-item-source-${item.id}`}
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
          >
            {ENGAGEMENT_ITEM_SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {titleizeEngagementValue(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-latitude-${item.id}`}>
            Latitude
          </label>
          <Input
            id={`engagement-item-latitude-${item.id}`}
            inputMode="decimal"
            placeholder="optional"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-longitude-${item.id}`}>
            Longitude
          </label>
          <Input
            id={`engagement-item-longitude-${item.id}`}
            inputMode="decimal"
            placeholder="optional"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <label className="text-[0.78rem] font-semibold" htmlFor={`engagement-item-notes-${item.id}`}>
          Moderation notes
        </label>
        <Textarea
          id={`engagement-item-notes-${item.id}`}
          className="min-h-24"
          value={moderationNotes}
          onChange={(event) => setModerationNotes(event.target.value)}
        />
      </div>

      <div className="mt-3 module-record-meta">
        <span className="module-record-chip">Submitter {submittedBy || "Unknown"}</span>
        <span className="module-record-chip">Source {titleizeEngagementValue(sourceType)}</span>
        <span className="module-record-chip">Category {categories.find((category) => category.id === categoryId)?.label ?? "Uncategorized"}</span>
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={status === "approved" ? "default" : "outline"} disabled={isSubmitting} onClick={() => handleQuickStatus("approved")}>
          <CheckCircle2 className="h-4 w-4" />
          Approve
        </Button>
        <Button type="button" size="sm" variant={status === "flagged" ? "secondary" : "outline"} disabled={isSubmitting} onClick={() => handleQuickStatus("flagged")}>
          <ShieldAlert className="h-4 w-4" />
          Flag
        </Button>
        <Button type="button" size="sm" variant={status === "pending" ? "ghost" : "outline"} disabled={isSubmitting} onClick={() => handleQuickStatus("pending")}>
          Return to pending
        </Button>
        <Button type="button" disabled={isSubmitting} onClick={handleSave}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save item
        </Button>
      </div>
    </div>
  );
}

export function EngagementItemRegistry({
  items,
  categories,
  counts,
}: {
  items: ItemRecord[];
  categories: CategoryOption[];
  counts: RegistryCounts;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);

  const filteredItems = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (sourceFilter !== "all" && item.source_type !== sourceFilter) return false;
      if (categoryFilter === "uncategorized" && item.category_id) return false;
      if (categoryFilter !== "all" && categoryFilter !== "uncategorized" && item.category_id !== categoryFilter) return false;

      if (reviewFilter === "needs_review" && !["pending", "flagged"].includes(item.status)) return false;
      if (reviewFilter === "uncategorized" && item.category_id) return false;
      if (reviewFilter === "geolocated" && !(typeof item.latitude === "number" && typeof item.longitude === "number")) return false;
      if (reviewFilter === "with_notes" && !item.moderation_notes?.trim()) return false;

      if (!normalizedQuery) return true;

      const searchable = [item.title, item.body, item.submitted_by, item.status, item.source_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedQuery);
    });
  }, [categoryFilter, deferredQuery, items, reviewFilter, sourceFilter, statusFilter]);

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Moderation</p>
          <h2 className="module-section-title">Recent intake registry</h2>
          <p className="module-section-description">
            Operators can update classification, moderation state, source metadata, and geolocation from the same review surface.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="module-summary-card">
          <p className="module-summary-label">Loaded for review</p>
          <p className="module-summary-value">{items.length}</p>
          <p className="module-summary-detail">{counts.totalItems} total campaign items, newest first.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Actionable</p>
          <p className="module-summary-value">{counts.moderationQueue.actionableCount}</p>
          <p className="module-summary-detail">
            {counts.moderationQueue.pendingCount} pending, {counts.moderationQueue.flaggedCount} flagged.
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Needs category</p>
          <p className="module-summary-value">{counts.uncategorizedItems}</p>
          <p className="module-summary-detail">Uncategorized items still weaken reporting readiness.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Map signal</p>
          <p className="module-summary-value">{counts.geographyCoverage.geolocatedItems}</p>
          <p className="module-summary-detail">Items with latitude/longitude already attached.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-[1.1fr_repeat(4,minmax(0,0.8fr))]">
        <label className="space-y-1.5">
          <span className="text-[0.78rem] font-semibold">Search</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Title, body, submitter, source" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </label>

        <label className="space-y-1.5">
          <span className="text-[0.78rem] font-semibold">Status</span>
          <select
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            {ENGAGEMENT_ITEM_STATUSES.map((value) => (
              <option key={value} value={value}>
                {titleizeEngagementValue(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-[0.78rem] font-semibold">Source</span>
          <select
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option value="all">All sources</option>
            {ENGAGEMENT_ITEM_SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {titleizeEngagementValue(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-[0.78rem] font-semibold">Category</span>
          <select
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-[0.78rem] font-semibold">Review focus</span>
          <select
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={reviewFilter}
            onChange={(event) => setReviewFilter(event.target.value)}
          >
            <option value="all">Everything</option>
            <option value="needs_review">Pending + flagged</option>
            <option value="uncategorized">Needs category</option>
            <option value="geolocated">Geolocated</option>
            <option value="with_notes">Has moderation notes</option>
          </select>
        </label>
      </div>

      <div className="mt-4 module-record-meta">
        <span className="module-record-chip">
          <Tags className="h-3.5 w-3.5" />
          {filteredItems.length} matching
        </span>
        {statusFilter !== "all" ? <span className="module-record-chip">Status {titleizeEngagementValue(statusFilter)}</span> : null}
        {reviewFilter === "needs_review" ? <span className="module-record-chip">Focused on review queue</span> : null}
        {categoryFilter === "uncategorized" ? <span className="module-record-chip">Needs category</span> : null}
      </div>

      <div className="mt-5 space-y-4">
        {filteredItems.map((item) => (
          <ItemRow key={item.id} item={item} categories={categories} />
        ))}
        {filteredItems.length === 0 ? (
          <div className="rounded-[0.5rem] border border-dashed border-border/80 bg-background/70 px-5 py-6 text-sm text-muted-foreground">
            No items match the current moderation filters.
          </div>
        ) : null}
      </div>
    </article>
  );
}
