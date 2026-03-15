"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ENGAGEMENT_TYPES, titleizeEngagementValue } from "@/lib/engagement/catalog";

type ProjectOption = {
  id: string;
  name: string;
};

type CreateResponse = {
  campaignId: string;
  error?: string;
};

export function EngagementCampaignCreator({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [engagementType, setEngagementType] = useState<(typeof ENGAGEMENT_TYPES)[number]>("comment_collection");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/engagement/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: projectId || undefined,
          title,
          summary,
          engagementType,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create engagement campaign");
      }

      router.refresh();
      router.push(`/engagement/${payload.campaignId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create engagement campaign");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New engagement campaign</h2>
          <p className="module-section-description">
            Register an operator-facing campaign first. Categories and moderated intake items can then accumulate against
            a stable project-linked record.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <FilePlus2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="engagement-project" className="text-[0.82rem] font-semibold">
            Linked project
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <select
            id="engagement-project"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No linked project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="engagement-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input
            id="engagement-title"
            placeholder="Downtown safety listening campaign"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="engagement-type" className="text-[0.82rem] font-semibold">
            Engagement type
          </label>
          <select
            id="engagement-type"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={engagementType}
            onChange={(event) => setEngagementType(event.target.value as (typeof ENGAGEMENT_TYPES)[number])}
          >
            {ENGAGEMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {titleizeEngagementValue(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="engagement-summary" className="text-[0.82rem] font-semibold">
            Summary
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Textarea
            id="engagement-summary"
            rows={4}
            placeholder="What kind of input is this campaign collecting, and how will operators use it?"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        {error ? (
          <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create campaign
        </Button>
      </form>
    </article>
  );
}
