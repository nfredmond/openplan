"use client";

/**
 * Starting a public comment campaign, as three questions.
 *
 * WHY THIS IS A SHEET. `/engagement` is the catalogue of campaigns you already
 * run. A five-control form for making another one used to sit permanently open
 * above that list. Creating a campaign is episodic and ends; the list is what
 * the page is for.
 *
 * WHAT SURVIVED THE MOVE. Every field and every consequence note:
 *   - the template picker, and its prefill of engagement type and summary —
 *     prefill, NOT lock, exactly as before: both stay editable and what the
 *     planner types is what the server keeps;
 *   - the template's own description, and the count of starter categories and
 *     draft survey questions it creates, with the sentence saying the questions
 *     arrive as DRAFTS and nothing reaches the public until somebody publishes
 *     them (a settled decision — the model never publishes to residents);
 *   - the linked-project note about where the public map will open, still
 *     written conditionally because this form cannot know whether the chosen
 *     project has a study area.
 *
 * WHY A PARTIALLY-APPLIED TEMPLATE CLOSES THE SHEET INSTEAD OF HOLDING IT OPEN.
 * The old form kept the planner on the page with the warning, which was right:
 * the campaign EXISTS and its starter content does not, and pushing them
 * straight into a console that looks blank explains nothing. But a guided flow
 * that stays open after a successful write is a flow whose Create button can be
 * pressed a second time — and the second press makes a second campaign. So the
 * sheet closes, and the warning lands on the page underneath it, where it
 * stays. Same words, same refresh, no way to double-create.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StateBlock } from "@/components/ui/state-block";
import { GuidedFlow, GuidedFlowRow, useGuidedFlow } from "@/components/ui/guided-flow";
import { ENGAGEMENT_TYPES, titleizeEngagementValue } from "@/lib/engagement/catalog";
import { CAMPAIGN_TEMPLATES, getCampaignTemplate } from "@/lib/engagement/campaign-templates";

type ProjectOption = {
  id: string;
  name: string;
};

type CreateResponse = {
  campaignId: string;
  error?: string;
  template?: {
    id: string;
    applied: boolean;
    error?: string;
  };
};

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35";

type CampaignFlowValues = {
  templateId: string;
  projectId: string;
  title: string;
  engagementType: (typeof ENGAGEMENT_TYPES)[number];
  summary: string;
};

const INITIAL_VALUES: CampaignFlowValues = {
  templateId: "",
  projectId: "",
  title: "",
  engagementType: "comment_collection",
  summary: "",
};

export function EngagementCampaignCreator({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  // A campaign that WAS created but whose starter content was not. It belongs
  // on the page, not in the sheet: the sheet is gone by the time it matters.
  const [partialTemplateNotice, setPartialTemplateNotice] = useState<string | null>(null);

  const flow = useGuidedFlow<CampaignFlowValues>({
    id: "engagement-campaign-creator",
    title: "New campaign",
    submitLabel: "Create campaign",
    initialValues: INITIAL_VALUES,
    steps: [
      {
        id: "template",
        title: "Do you want a ready-made starting point?",
        hint: "A template fills in some questions and categories for you. You can change all of it afterwards.",
        fields: [{ name: "templateId", label: "Template" }],
        render: (flowState) => {
          const selectedTemplate = flowState.values.templateId
            ? getCampaignTemplate(flowState.values.templateId)
            : null;
          return (
            <GuidedFlowRow flow={flowState} name="templateId" label="Start from a template (optional)">
              <select
                {...flowState.fieldProps("templateId")}
                className={SELECT_CLASS}
                value={flowState.values.templateId}
                onChange={(event) => {
                  const nextTemplateId = event.target.value;
                  const template = nextTemplateId ? getCampaignTemplate(nextTemplateId) : null;
                  // Prefill, not lock: both fields stay editable, and what the
                  // planner types is what the server keeps.
                  flowState.setValues(
                    template
                      ? {
                          templateId: nextTemplateId,
                          engagementType: template.engagementType,
                          summary: template.suggestedSummary,
                        }
                      : { templateId: nextTemplateId }
                  );
                }}
              >
                <option value="">Start from scratch</option>
                {CAMPAIGN_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
              {selectedTemplate ? (
                <div className="rounded-[0.5rem] border border-input bg-muted/40 px-4 py-3 text-[0.78rem] text-muted-foreground">
                  <p>{selectedTemplate.description}</p>
                  <p className="mt-1.5">
                    Creates {selectedTemplate.categories.length} starter categories and{" "}
                    {selectedTemplate.questions.length} survey questions. The questions arrive as
                    drafts — nothing is shown to the public until you publish it from the survey
                    builder.
                  </p>
                </div>
              ) : null}
            </GuidedFlowRow>
          );
        },
      },
      {
        id: "about",
        title: "What is this campaign called, and what kind is it?",
        hint: "Residents see the title. Say what you are asking about, in their words.",
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
            <GuidedFlowRow flow={flowState} name="title" label="Title">
              <Input
                {...flowState.text("title")}
                placeholder="Downtown safety listening campaign"
              />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flowState}
              name="engagementType"
              label="Engagement type"
              hint="How you are collecting input. It changes what the public page offers."
            >
              <select {...flowState.text("engagementType")} className={SELECT_CLASS}>
                {ENGAGEMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {titleizeEngagementValue(value)}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "context",
        title: "Which project is this about, and what are you asking for?",
        hint: "Both optional. A campaign can stand on its own and be linked to a project later.",
        fields: [
          { name: "projectId", label: "Linked project" },
          { name: "summary", label: "Summary" },
        ],
        render: (flowState) => (
          <>
            <GuidedFlowRow
              flow={flowState}
              name="projectId"
              label="Linked project (optional)"
              hint="If the project has a study area, the campaign's public map opens there. You can set an area for this campaign specifically once it exists."
            >
              <select {...flowState.text("projectId")} className={SELECT_CLASS}>
                <option value="">No linked project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flowState}
              name="summary"
              label="Summary (optional)"
              hint="A couple of sentences: what input you are collecting, and what you will do with it."
            >
              <Textarea
                {...flowState.text("summary")}
                rows={4}
                placeholder="What kind of input is this campaign collecting, and how will operators use it?"
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    onSubmit: async (values) => {
      setPartialTemplateNotice(null);

      const response = await fetch("/api/engagement/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: values.projectId || undefined,
          templateId: values.templateId || undefined,
          title: values.title,
          summary: values.summary,
          engagementType: values.engagementType,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create engagement campaign");
      }

      if (payload.template && !payload.template.applied) {
        // The campaign exists; the template's starter content does not, or not
        // all of it. Say so on the page and stay on the catalogue, rather than
        // landing on a console that looks like a blank campaign.
        setPartialTemplateNotice(
          `The campaign was created, but the template could not be fully applied` +
            `${payload.template.error ? `: ${payload.template.error}` : "."} ` +
            `Open the campaign to add its categories and survey questions manually.`
        );
        router.refresh();
        return;
      }

      router.refresh();
      // `created=1` lets the campaign console surface its create-success state:
      // where the public link will live and that submissions land in moderation.
      router.push(`/engagement/${payload.campaignId}?created=1`);
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New engagement campaign</h2>
          <p className="module-section-description">
            A campaign is one round of asking the public something. Set it up here, then collect
            comments against it — everything residents send lands in moderation first.
          </p>
        </div>
        <Button type="button" onClick={flow.open}>
          <FilePlus2 className="mr-1.5 h-4 w-4" />
          New campaign
        </Button>
      </div>

      {partialTemplateNotice ? (
        <div className="mt-4">
          <StateBlock
            title="The campaign was created — its starter content was not"
            description={partialTemplateNotice}
            tone="warning"
            compact
          />
        </div>
      ) : null}

      <GuidedFlow flow={flow} />
    </article>
  );
}
