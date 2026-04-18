"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListTree, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormActions, FormError, FormField, FormLabel } from "@/components/ui/form";
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

      <Form className="mt-5" onSubmit={handleSubmit}>
        <FormField>
          <FormLabel htmlFor="engagement-category-label">Label</FormLabel>
          <Input
            id="engagement-category-label"
            placeholder="Safety"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </FormField>

        <FormField>
          <FormLabel htmlFor="engagement-category-description" optional>
            Description
          </FormLabel>
          <Textarea
            id="engagement-category-description"
            rows={3}
            placeholder="What kinds of comments should land in this category?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

        {error ? <FormError>{error}</FormError> : null}

        <FormActions>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add category
          </Button>
        </FormActions>
      </Form>
    </article>
  );
}
