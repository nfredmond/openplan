"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import {
  WORK_PLAN_ANCHOR_LABELS,
  WORK_PLAN_PRACTICE_AREA_LABELS,
  type WorkPlanTemplateDescriptor,
} from "@/lib/work-plans/template-registry";

/** What this panel is for, in the sentence a planner reads first. */
const APPLIER_HELP =
  "A template writes the deliverables and milestones a piece of work normally carries, dated from one day you supply. Nothing is assigned to anyone, and every record is an ordinary project record you can edit or delete afterwards.";

/**
 * Apply a starter work plan to a project.
 *
 * WHAT A PLANNER CHOOSES, AND WHAT THEY DO NOT. Three inputs: the project, the
 * template, and the date the template's day offsets count from. Everything else
 * — every due date, every milestone phase — is computed by the route from those
 * three. There is no assignee field here and none in the route: a template names
 * the work, and who does it is a judgement about a colleague's week that an
 * artifact cannot hold.
 *
 * THE ANCHOR DATE IS REQUIRED AND HAS NO DEFAULT. Pre-filling today's date would
 * be the single most damaging convenience on this screen: a plan anchored on the
 * day someone happened to click is a schedule nobody agreed to, and it lands
 * immediately in teammates' deadline queues and reminder digests. So the button
 * stays disabled until a date is typed, and the field says which real-world
 * event the template counts from.
 *
 * THE SCOPE NOTES ARE SHOWN BEFORE APPLYING, NOT AFTER. Every template declares
 * that it is a standard-practice starting point to edit; that sentence is worth
 * nothing on a confirmation screen, so it renders as soon as a template is
 * selected and above the button that acts on it.
 */

export type WorkPlanApplierProject = { id: string; name: string };

type ApplyResult = {
  templateName: string;
  createdDeliverables: number;
  createdMilestones: number;
  skippedDeliverableTitles: string[];
  skippedMilestoneTitles: string[];
};

type ApplierValues = {
  projectId: string;
  templateId: string;
  anchorDate: string;
};

const selectClassName = "module-select";

/** Module-level so the steps memo depends on `templates` and nothing else. */
function findTemplate(
  templates: readonly WorkPlanTemplateDescriptor[],
  templateId: string
): WorkPlanTemplateDescriptor | null {
  return templates.find((entry) => entry.templateId === templateId) ?? null;
}

export function WorkPlanTemplateApplier({
  projects,
  templates,
}: {
  projects: readonly WorkPlanApplierProject[];
  templates: readonly WorkPlanTemplateDescriptor[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<ApplyResult | null>(null);

  const steps = useMemo<GuidedFlowStep<ApplierValues>[]>(
    () => [
      {
        id: "what",
        title: "Which project, and which template?",
        hint: "A template writes the deliverables and milestones this kind of work normally carries.",
        fields: [
          {
            name: "projectId",
            label: "a project",
            required: true,
            requiredMessage: "Choose the project this work plan is for.",
          },
          {
            name: "templateId",
            label: "a template",
            required: true,
            requiredMessage: "Choose the template to apply.",
          },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="projectId" label="Project">
              <select className={selectClassName} {...flow.text("projectId")}>
                <option value="">Choose a project…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="templateId" label="Template">
              <select className={selectClassName} {...flow.text("templateId")}>
                <option value="">Choose a template…</option>
                {templates.map((entry) => (
                  <option key={entry.templateId} value={entry.templateId}>
                    {entry.templateName} — {WORK_PLAN_PRACTICE_AREA_LABELS[entry.practiceArea]}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "when",
        title: "What day does its schedule start from?",
        hint: "Every date in the template is counted forward from this one.",
        fields: [
          {
            name: "anchorDate",
            label: "a start date",
            required: true,
            requiredMessage: "Give the day this template's dates are counted from.",
          },
        ],
        check: (values) => {
          // A BACKSTOP, and honestly labelled as one. The inline form gated its
          // submit on this shape. A `type="date"` input only ever yields "" or
          // a real `YYYY-MM-DD`, so in practice the required check above is
          // what rejects a bad date — a mutation removing this line kills no
          // test, and pretending otherwise with a contrived case would be
          // worse than saying so.
          if (!/^\d{4}-\d{2}-\d{2}$/.test(values.anchorDate)) {
            return { field: "anchorDate", message: "Give the date as a real calendar day." };
          }
          return null;
        },
        render: (flow) => {
          const template = findTemplate(templates, flow.values.templateId);
          return (
            <>
              <GuidedFlowRow
                flow={flow}
                name="anchorDate"
                label={template ? WORK_PLAN_ANCHOR_LABELS[template.anchor] : "Anchor date"}
                hint={
                  template
                    ? `Every date is counted forward from this day — the last one lands ${template.spanDays} days later.`
                    : "Choose a template first; each one counts its dates from a different real-world event."
                }
              >
                <Input {...flow.text("anchorDate")} type="date" />
              </GuidedFlowRow>

              {/*
                THE CONSENT PANEL, KEPT WHOLE. This is what a planner reads
                before creating a dozen records at once: what the template is
                for, what it will make, and whose rules it was written against.
                It moved from below the form to the step that submits, which is
                the last thing seen before the records exist.
              */}
              {template ? (
                <div className="rounded-[0.5rem] border border-border/70 bg-background/70 px-3 py-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Before you apply this
                  </p>
                  {template.description ? (
                    <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                      {template.description}
                    </p>
                  ) : null}
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                    {template.scopeNotes.map((note) => (
                      <li key={note}>• {note}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {template.deliverableCount} deliverable
                    {template.deliverableCount === 1 ? "" : "s"} and {template.milestoneCount}{" "}
                    milestone{template.milestoneCount === 1 ? "" : "s"} will be created, unassigned.
                    {template.jurisdiction
                      ? ` Written for ${template.jurisdiction.label} — check it against your own rules before using it elsewhere.`
                      : " No jurisdiction is assumed."}
                  </p>
                </div>
              ) : null}
            </>
          );
        },
      },
    ],
    [projects, templates]
  );

  const flow = useGuidedFlow<ApplierValues>({
    id: "apply-work-plan",
    title: "Apply a work-plan template",
    submitLabel: "Apply work plan",
    initialValues: { projectId: "", templateId: "", anchorDate: "" },
    steps,
    onSubmit: async (values) => {
      const template = findTemplate(templates, values.templateId);
      if (!template) throw new Error("Choose the template to apply.");

      const response = await fetch(`/api/projects/${values.projectId}/work-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: template.templateId, anchorDate: values.anchorDate }),
      });
      const data = (await response.json()) as {
        error?: string;
        details?: string;
        createdDeliverables?: number;
        createdMilestones?: number;
        skippedDeliverableTitles?: string[];
        skippedMilestoneTitles?: string[];
      };
      if (!response.ok) {
        throw new Error(data.details || data.error || "The work plan could not be applied.");
      }
      setResult({
        templateName: template.templateName,
        createdDeliverables: data.createdDeliverables ?? 0,
        createdMilestones: data.createdMilestones ?? 0,
        skippedDeliverableTitles: data.skippedDeliverableTitles ?? [],
        skippedMilestoneTitles: data.skippedMilestoneTitles ?? [],
      });
      router.refresh();
    },
  });

  const skipped = result
    ? result.skippedDeliverableTitles.length + result.skippedMilestoneTitles.length
    : 0;

  return (
    <article className="module-section-surface" id="work-plan-templates">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Work plans</p>
          <h2 className="module-section-title">Start a project from a work-plan template</h2>
        </div>
        <span className="module-record-chip">
          <ClipboardList className="h-3.5 w-3.5" />
          <span>Templates</span>
          <strong>{templates.length}</strong>
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{APPLIER_HELP}</p>

      <div className="mt-4">
        <Button
          type="button"
          onClick={() => {
            setResult(null);
            flow.open();
          }}
          data-testid="work-plan-applier-open"
        >
          <CalendarDays className="mr-2 h-4 w-4" />
          {/* Distinct from the flow's own submit, which is "Apply work plan".
              Two buttons with one name is ambiguous on screen as well as to a
              test — the trigger opens the questions, the submit does the work. */}
          Apply a template
        </Button>
      </div>

      <GuidedFlow flow={flow} />

      {/*
        THE RESULT STAYS ON THE PANEL. It is the only place a planner learns
        what was created AND what was skipped as already existing, and the flow
        closes on success — so it cannot live inside the flow.
      */}
      {result ? (
        <div
          className="mt-3 rounded-[0.5rem] border border-emerald-300/70 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
          data-testid="work-plan-applied"
        >
          <p className="font-medium">
            {result.templateName}: {result.createdDeliverables} deliverable
            {result.createdDeliverables === 1 ? "" : "s"} and {result.createdMilestones} milestone
            {result.createdMilestones === 1 ? "" : "s"} created. Open the project to edit the dates
            and assign the work.
          </p>
          {skipped > 0 ? (
            <p className="mt-1 text-xs leading-relaxed">
              {skipped} record{skipped === 1 ? "" : "s"} already existed under the same title and{" "}
              {skipped === 1 ? "was" : "were"} not duplicated:{" "}
              {[...result.skippedDeliverableTitles, ...result.skippedMilestoneTitles].join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
