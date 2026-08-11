"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function WorkPlanTemplateApplier({
  projects,
  templates,
}: {
  projects: readonly WorkPlanApplierProject[];
  templates: readonly WorkPlanTemplateDescriptor[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [anchorDate, setAnchorDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const template = useMemo(
    () => templates.find((entry) => entry.templateId === templateId) ?? null,
    [templateId, templates]
  );

  const ready = Boolean(projectId) && Boolean(template) && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate);

  async function handleApply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !template) return;
    setError(null);
    setResult(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/work-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: template.templateId, anchorDate }),
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
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "The work plan could not be applied.");
    } finally {
      setSaving(false);
    }
  }

  if (projects.length === 0) {
    return null;
  }

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

      <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handleApply}>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-foreground">Project</span>
          <select
            className="h-9 rounded-[0.5rem] border border-border bg-background px-2 text-sm"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Choose a project…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-foreground">Template</span>
          <select
            className="h-9 rounded-[0.5rem] border border-border bg-background px-2 text-sm"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">Choose a template…</option>
            {templates.map((entry) => (
              <option key={entry.templateId} value={entry.templateId}>
                {entry.templateName} — {WORK_PLAN_PRACTICE_AREA_LABELS[entry.practiceArea]}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-foreground">
            {template ? WORK_PLAN_ANCHOR_LABELS[template.anchor] : "Anchor date"}
          </span>
          <Input
            type="date"
            value={anchorDate}
            onChange={(event) => setAnchorDate(event.target.value)}
            aria-describedby="work-plan-anchor-help"
          />
          <span id="work-plan-anchor-help" className="text-xs text-muted-foreground">
            {template
              ? `Every date is counted forward from this day — the last one lands ${template.spanDays} days later.`
              : "Choose a template first; each one counts its dates from a different real-world event."}
          </span>
        </label>

        {template ? (
          <div className="md:col-span-3 rounded-[0.5rem] border border-border/70 bg-background/70 px-3 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Before you apply this
            </p>
            {template.description ? (
              <p className="mt-1.5 text-sm leading-relaxed text-foreground">{template.description}</p>
            ) : null}
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              {template.scopeNotes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {template.deliverableCount} deliverable{template.deliverableCount === 1 ? "" : "s"} and{" "}
              {template.milestoneCount} milestone{template.milestoneCount === 1 ? "" : "s"} will be created,
              unassigned.
              {template.jurisdiction
                ? ` Written for ${template.jurisdiction.label} — check it against your own rules before using it elsewhere.`
                : " No jurisdiction is assumed."}
            </p>
          </div>
        ) : null}

        <div className="md:col-span-3 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!ready || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
            Apply work plan
          </Button>
          {!ready ? (
            <span className="text-xs text-muted-foreground">
              Choose a project, a template and the date its schedule starts from.
            </span>
          ) : null}
        </div>
      </form>

      {error ? (
        <p className="mt-3 rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-[0.5rem] border border-emerald-300/70 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="font-medium">
            {result.templateName}: {result.createdDeliverables} deliverable
            {result.createdDeliverables === 1 ? "" : "s"} and {result.createdMilestones} milestone
            {result.createdMilestones === 1 ? "" : "s"} created. Open the project to edit the dates and assign
            the work.
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
