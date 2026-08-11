"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ENGAGEMENT_CAMPAIGN_STATUSES, ENGAGEMENT_TYPES, titleizeEngagementValue } from "@/lib/engagement/catalog";

type ChapterOption = {
  id: string;
  title: string;
};

type ProjectOption = {
  id: string;
  name: string;
};

/**
 * The raw shape GET /api/projects answers with. `workspaces` is a joined
 * relation, which supabase-js returns as an object or a one-element array
 * depending on the relationship metadata — both are handled below.
 */
type ProjectListRow = {
  id: string;
  name: string;
  workspace_id: string;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type Props = {
  rtpCycleId: string;
  chapterOptions: ChapterOption[];
};

function workspaceNameOf(row: ProjectListRow): string | null {
  const relation = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
  return relation?.name ?? null;
}

export function RtpEngagementCampaignCreator({ rtpCycleId, chapterOptions }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [engagementType, setEngagementType] = useState<(typeof ENGAGEMENT_TYPES)[number]>("comment_collection");
  const [status, setStatus] = useState<(typeof ENGAGEMENT_CAMPAIGN_STATUSES)[number]>("draft");
  const [rtpCycleChapterId, setRtpCycleChapterId] = useState("");
  const [projectId, setProjectId] = useState("");
  // Three states, deliberately: null while loading, a real list once read, and
  // `projectsUnavailable` when the read failed. A failed read renders as "the
  // list could not be read", never as a workspace with no projects — and the
  // campaign can still be created and linked to a project later from its own
  // console, so the failure does not block the create.
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [projectsUnavailable, setProjectsUnavailable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/projects");
        if (!response.ok) {
          if (!cancelled) setProjectsUnavailable(true);
          return;
        }
        const body = (await response.json()) as { projects?: ProjectListRow[] };
        const rows = body.projects ?? [];
        // The list is RLS-scoped to the caller, not to this cycle's workspace.
        // For a member of several workspaces the workspace name is appended so
        // a wrong pick is visible before the server refuses it — the create
        // route enforces that the project and the cycle share a workspace.
        const workspaceCount = new Set(rows.map((row) => row.workspace_id)).size;
        if (!cancelled) {
          setProjects(
            rows.map((row) => {
              const workspaceName = workspaceNameOf(row);
              return {
                id: row.id,
                name: workspaceCount > 1 && workspaceName ? `${row.name} — ${workspaceName}` : row.name,
              };
            })
          );
        }
      } catch {
        if (!cancelled) setProjectsUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/engagement/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          summary: summary.trim() ? summary.trim() : undefined,
          engagementType,
          status,
          rtpCycleId,
          rtpCycleChapterId: rtpCycleChapterId || undefined,
          projectId: projectId || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create engagement campaign");
      }

      setTitle("");
      setSummary("");
      setEngagementType("comment_collection");
      setStatus("draft");
      setRtpCycleChapterId("");
      setProjectId("");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create engagement campaign");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Engagement target</p>
          <h2 className="module-section-title">Create RTP-linked engagement campaign</h2>
          <p className="module-section-description">
            Point a campaign at the full RTP cycle or a specific chapter so comments can land on explicit plan sections later.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <MessageSquarePlus className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="rtp-engagement-title" className="text-[0.82rem] font-semibold">
            Campaign title
          </label>
          <Input id="rtp-engagement-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="rtp-engagement-type" className="text-[0.82rem] font-semibold">
              Engagement type
            </label>
            <select
              id="rtp-engagement-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={engagementType}
              onChange={(event) => setEngagementType(event.target.value as (typeof ENGAGEMENT_TYPES)[number])}
            >
              {ENGAGEMENT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {titleizeEngagementValue(option)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rtp-engagement-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="rtp-engagement-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof ENGAGEMENT_CAMPAIGN_STATUSES)[number])}
            >
              {ENGAGEMENT_CAMPAIGN_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {titleizeEngagementValue(option)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rtp-engagement-chapter" className="text-[0.82rem] font-semibold">
            Target chapter (optional)
          </label>
          <select
            id="rtp-engagement-chapter"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={rtpCycleChapterId}
            onChange={(event) => setRtpCycleChapterId(event.target.value)}
          >
            <option value="">Whole RTP cycle</option>
            {chapterOptions.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rtp-engagement-project" className="text-[0.82rem] font-semibold">
            Linked project
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          {projectsUnavailable ? (
            <p className="text-sm text-muted-foreground">
              The project list could not be read, so a project cannot be picked here right now. The
              campaign can still be created, and a project can be linked later from the
              campaign&apos;s own page.
            </p>
          ) : (
            <>
              <select
                id="rtp-engagement-project"
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={projects === null}
              >
                <option value="">{projects === null ? "Reading projects…" : "No linked project"}</option>
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {/*
                The same consequence note the engagement-side creator carries:
                linking a project is also where the public map opens, unless the
                campaign is later given an area of its own.
              */}
              <p className="text-[0.72rem] text-muted-foreground">
                If the project has a study area, the campaign&apos;s public map opens there. You can
                set an area for this campaign specifically once it exists.
              </p>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rtp-engagement-summary" className="text-[0.82rem] font-semibold">
            Summary
          </label>
          <Textarea
            id="rtp-engagement-summary"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Explain what feedback this campaign is collecting and why it matters."
          />
        </div>

        {error ? (
          <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving || !title.trim()}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
          Create RTP engagement target
        </Button>
      </form>
    </article>
  );
}
