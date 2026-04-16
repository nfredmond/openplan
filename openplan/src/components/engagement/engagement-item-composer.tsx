"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ENGAGEMENT_ITEM_SOURCE_TYPES,
  ENGAGEMENT_ITEM_STATUSES,
  titleizeEngagementValue,
} from "@/lib/engagement/catalog";

type CategoryOption = {
  id: string;
  label: string;
};

export function EngagementItemComposer({
  campaignId,
  categories,
}: {
  campaignId: string;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [sourceType, setSourceType] = useState<(typeof ENGAGEMENT_ITEM_SOURCE_TYPES)[number]>("internal");
  const [status, setStatus] = useState<(typeof ENGAGEMENT_ITEM_STATUSES)[number]>("pending");
  const [moderationNotes, setModerationNotes] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedLatitude = latitude.trim() ? Number(latitude) : undefined;
    const parsedLongitude = longitude.trim() ? Number(longitude) : undefined;

    if ((latitude.trim() && Number.isNaN(parsedLatitude)) || (longitude.trim() && Number.isNaN(parsedLongitude))) {
      setError("Latitude and longitude must be valid numbers when provided.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId: categoryId || undefined,
          title,
          body,
          submittedBy,
          sourceType,
          status,
          moderationNotes,
          latitude: parsedLatitude,
          longitude: parsedLongitude,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create engagement item");
      }

      setCategoryId("");
      setTitle("");
      setBody("");
      setSubmittedBy("");
      setSourceType("internal");
      setStatus("pending");
      setModerationNotes("");
      setLatitude("");
      setLongitude("");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create engagement item");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Intake</p>
          <h2 className="module-section-title">Register feedback item</h2>
          <p className="module-section-description">
            This is the internal registry path for meeting notes, inbox triage, and manually-entered public input.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-copper/12 text-[color:var(--copper)]">
          <MessageSquarePlus className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="engagement-item-category" className="text-[0.82rem] font-semibold">
              Category
            </label>
            <select
              id="engagement-item-category"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
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
            <label htmlFor="engagement-item-submitter" className="text-[0.82rem] font-semibold">
              Submitter/source label
            </label>
            <Input
              id="engagement-item-submitter"
              placeholder="Workshop attendee / inbox / staff note"
              value={submittedBy}
              onChange={(event) => setSubmittedBy(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="engagement-item-title" className="text-[0.82rem] font-semibold">
            Title
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Input
            id="engagement-item-title"
            placeholder="Unsafe crossing near school pickup"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="engagement-item-body" className="text-[0.82rem] font-semibold">
            Body
          </label>
          <Textarea
            id="engagement-item-body"
            rows={5}
            placeholder="Record the actual input, meeting observation, or moderated intake note."
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="engagement-item-source" className="text-[0.82rem] font-semibold">
              Source type
            </label>
            <select
              id="engagement-item-source"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as (typeof ENGAGEMENT_ITEM_SOURCE_TYPES)[number])}
            >
              {ENGAGEMENT_ITEM_SOURCE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {titleizeEngagementValue(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="engagement-item-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="engagement-item-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof ENGAGEMENT_ITEM_STATUSES)[number])}
            >
              {ENGAGEMENT_ITEM_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {titleizeEngagementValue(value)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="engagement-item-notes" className="text-[0.82rem] font-semibold">
            Moderation notes
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Textarea
            id="engagement-item-notes"
            rows={3}
            placeholder="Internal-only moderation or classification notes."
            value={moderationNotes}
            onChange={(event) => setModerationNotes(event.target.value)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="engagement-item-latitude" className="text-[0.82rem] font-semibold">
              Latitude
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="engagement-item-latitude"
              inputMode="decimal"
              placeholder="34.1234"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="engagement-item-longitude" className="text-[0.82rem] font-semibold">
              Longitude
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="engagement-item-longitude"
              inputMode="decimal"
              placeholder="-118.1234"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </div>
        </div>

        {error ? (
          <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add item
        </Button>
      </form>
    </article>
  );
}
