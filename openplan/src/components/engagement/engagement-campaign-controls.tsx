"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ENGAGEMENT_CAMPAIGN_STATUSES, ENGAGEMENT_TYPES, titleizeEngagementValue } from "@/lib/engagement/catalog";

type ProjectOption = {
  id: string;
  name: string;
};

type Campaign = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  project_id: string | null;
};

export function EngagementCampaignControls({
  campaign,
  projects,
}: {
  campaign: Campaign;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(campaign.title);
  const [summary, setSummary] = useState(campaign.summary ?? "");
  const [status, setStatus] = useState(campaign.status);
  const [engagementType, setEngagementType] = useState(campaign.engagement_type);
  const [projectId, setProjectId] = useState(campaign.project_id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          summary: summary || null,
          status,
          engagementType,
          projectId: projectId || null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update engagement campaign");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update engagement campaign");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Controls</p>
          <h2 className="module-section-title">Campaign metadata</h2>
          <p className="module-section-description">
            Keep the campaign title, linkage, and status explicit so intake review stays auditable.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Settings2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="campaign-control-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input id="campaign-control-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="campaign-control-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="campaign-control-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {ENGAGEMENT_CAMPAIGN_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {titleizeEngagementValue(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="campaign-control-type" className="text-[0.82rem] font-semibold">
              Engagement type
            </label>
            <select
              id="campaign-control-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={engagementType}
              onChange={(event) => setEngagementType(event.target.value)}
            >
              {ENGAGEMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {titleizeEngagementValue(value)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="campaign-control-project" className="text-[0.82rem] font-semibold">
            Linked project
          </label>
          <select
            id="campaign-control-project"
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
          <label htmlFor="campaign-control-summary" className="text-[0.82rem] font-semibold">
            Summary
          </label>
          <Textarea
            id="campaign-control-summary"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        {error ? (
          <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save campaign
        </Button>
      </form>
    </article>
  );
}
