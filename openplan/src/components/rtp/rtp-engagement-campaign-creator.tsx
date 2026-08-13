"use client";

/**
 * Starting a comment campaign that files its comments against a plan.
 *
 * This is the RTP page's half of campaign creation: same POST, same record, but
 * the plan (and optionally the chapter) is decided by where you are standing,
 * so it is not a question the sheet asks.
 *
 * WHAT SURVIVED THE MOVE TO A GUIDED FLOW. Every field, and the three-state
 * project list in particular: `null` while loading, a real list once read, and
 * an explicit "could not be read" when the fetch failed. A failed read renders
 * as a failed read, NEVER as a workspace with no projects — and it does not
 * block the create, because a project can be linked later from the campaign's
 * own console. That distinction is the reason this component has a
 * `projectsUnavailable` flag at all, and it is preserved exactly.
 *
 * The project list is also RLS-scoped to the caller rather than to this cycle's
 * workspace, so for somebody in several workspaces the workspace name is
 * appended to each option — a wrong pick is then visible before the server
 * refuses it, since the create route requires the project and the cycle to
 * share a workspace.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GuidedFlow, GuidedFlowRow, useGuidedFlow } from "@/components/ui/guided-flow";
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

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35";

function workspaceNameOf(row: ProjectListRow): string | null {
  const relation = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
  return relation?.name ?? null;
}

type RtpCampaignFlowValues = {
  title: string;
  engagementType: (typeof ENGAGEMENT_TYPES)[number];
  status: (typeof ENGAGEMENT_CAMPAIGN_STATUSES)[number];
  rtpCycleChapterId: string;
  projectId: string;
  summary: string;
};

const INITIAL_VALUES: RtpCampaignFlowValues = {
  title: "",
  engagementType: "comment_collection",
  status: "draft",
  rtpCycleChapterId: "",
  projectId: "",
  summary: "",
};

export function RtpEngagementCampaignCreator({ rtpCycleId, chapterOptions }: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [projectsUnavailable, setProjectsUnavailable] = useState(false);

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

  const flow = useGuidedFlow<RtpCampaignFlowValues>({
    id: "rtp-engagement-campaign-creator",
    title: "New campaign for this plan",
    submitLabel: "Create campaign",
    initialValues: INITIAL_VALUES,
    steps: [
      {
        id: "about",
        title: "What are you asking the public about?",
        hint: "Residents see the title. Say it in their words, not the plan's.",
        fields: [
          {
            name: "title",
            label: "Title",
            required: true,
            requiredMessage: "Give the campaign a title — this is what residents see first.",
          },
          { name: "engagementType", label: "Engagement type", required: true },
        ],
        render: (flowState) => (
          <>
            <GuidedFlowRow flow={flowState} name="title" label="Campaign title">
              <Input {...flowState.text("title")} placeholder="What should the 2050 plan build first?" />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flowState}
              name="engagementType"
              label="Engagement type"
              hint="How you are collecting input. It changes what the public page offers."
            >
              <select {...flowState.text("engagementType")} className={SELECT_CLASS}>
                {ENGAGEMENT_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {titleizeEngagementValue(option)}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "target",
        title: "Which part of the plan should the comments land on?",
        hint: "Comments file against the whole plan unless you point them at one chapter.",
        fields: [
          { name: "rtpCycleChapterId", label: "Target chapter" },
          { name: "projectId", label: "Linked project" },
        ],
        render: (flowState) => (
          <>
            <GuidedFlowRow
              flow={flowState}
              name="rtpCycleChapterId"
              label="Target chapter (optional)"
              hint="Pointing at a chapter files comments against that section instead of the whole plan."
            >
              <select {...flowState.text("rtpCycleChapterId")} className={SELECT_CLASS}>
                <option value="">Whole RTP cycle</option>
                {chapterOptions.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flowState}
              name="projectId"
              label="Linked project (optional)"
              hint="If the project has a study area, the campaign's public map opens there. You can set an area for this campaign specifically once it exists."
            >
              {projectsUnavailable ? (
                <>
                  {/* The field still needs its control so the flow can find it,
                      and a disabled empty select is the honest one: the list
                      could not be read, and this is not "no projects". */}
                  <select {...flowState.text("projectId")} className={SELECT_CLASS} disabled>
                    <option value="">Project list unavailable</option>
                  </select>
                  <p className="text-sm text-muted-foreground">
                    The project list could not be read, so a project cannot be picked here right
                    now. The campaign can still be created, and a project can be linked later from
                    the campaign&apos;s own page.
                  </p>
                </>
              ) : (
                <select
                  {...flowState.text("projectId")}
                  className={SELECT_CLASS}
                  disabled={projects === null}
                >
                  <option value="">{projects === null ? "Reading projects…" : "No linked project"}</option>
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "publish",
        title: "Ready for the public, or still a draft?",
        hint: "Draft keeps it to your team. You can change this any time from the campaign's page.",
        fields: [
          { name: "status", label: "Status", required: true },
          { name: "summary", label: "Summary" },
        ],
        render: (flowState) => (
          <>
            <GuidedFlowRow flow={flowState} name="status" label="Status">
              <select {...flowState.text("status")} className={SELECT_CLASS}>
                {ENGAGEMENT_CAMPAIGN_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {titleizeEngagementValue(option)}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flowState}
              name="summary"
              label="Summary (optional)"
              hint="A couple of sentences: what feedback this is collecting, and why it matters."
            >
              <Textarea
                {...flowState.text("summary")}
                rows={4}
                placeholder="Explain what feedback this campaign is collecting and why it matters."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    onSubmit: async (values) => {
      const response = await fetch("/api/engagement/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          summary: values.summary.trim() ? values.summary.trim() : undefined,
          engagementType: values.engagementType,
          status: values.status,
          rtpCycleId,
          rtpCycleChapterId: values.rtpCycleChapterId || undefined,
          projectId: values.projectId || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create engagement campaign");
      }

      router.refresh();
    },
  });

  return (
    /*
      THE ANCHOR IS ON THE SECTION NOW, AND WAS AN ACCIDENT BEFORE.
      The Comments tab claims the prefix `rtp-engagement-` (`_tabs.ts`), and the
      only elements that ever carried it were this form's INPUT IDS
      (`rtp-engagement-title`, …). So a deep link to the Comments tab scrolled
      to a text box, and moving those controls into a sheet took the anchor away
      entirely — caught by `page-tabs-anchors-have-elements`. An anchor should
      land on the section a person is being sent to, so it is declared here.
    */
    <article id="rtp-engagement-campaigns" className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Engagement target</p>
          <h2 className="module-section-title">Ask the public about this plan</h2>
          <p className="module-section-description">
            A campaign started here files its comments against this plan — the whole thing, or one
            chapter of it — so you can answer them chapter by chapter later.
          </p>
        </div>
        <Button type="button" onClick={flow.open}>
          <MessageSquarePlus className="mr-1.5 h-4 w-4" />
          New campaign
        </Button>
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
