"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListTree, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function EngagementCategoryCreator({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/categories`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, description }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create engagement category");
      }

      setLabel("");
      setDescription("");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create engagement category");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Categories</p>
          <h2 className="module-section-title">Add intake categories</h2>
          <p className="module-section-description">
            Keep the taxonomy light. V1 is about routable review structure, not exhaustive survey logic.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <ListTree className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="engagement-category-label" className="text-[0.82rem] font-semibold">
            Label
          </label>
          <Input
            id="engagement-category-label"
            placeholder="Safety"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="engagement-category-description" className="text-[0.82rem] font-semibold">
            Description
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Textarea
            id="engagement-category-description"
            rows={3}
            placeholder="What kinds of comments should land in this category?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {error ? (
          <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add category
        </Button>
      </form>
    </article>
  );
}
