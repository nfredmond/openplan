/**
 * Turning a work-plan template into project records.
 *
 * PURE. No I/O, no clock, no client — the route does the reading and writing, so
 * that every rule below can be tested by calling a function rather than by
 * mocking a database. The one input that could have been a hidden dependency,
 * "today", deliberately is not one: the anchor date comes from the PLANNER.
 *
 * THREE RULES, EACH OF WHICH IS A DECISION RATHER THAN AN IMPLEMENTATION DETAIL.
 *
 * 1. NO ASSIGNEE, EVER. Nothing here can emit `assignee_user_id`, and the route
 *    has no field to carry one. A template names the WORK, and who does the work
 *    is a judgement about a named colleague's week that no artifact can hold —
 *    the same argument that refused registering an assignment action for the
 *    Planner Agent (see the header of `api/projects/[projectId]/records`). It
 *    matters more here than there: applying a template writes many records at
 *    once, so a template that could assign would fill a person's queue and their
 *    reminder digest in a single click. `owner_label` is left empty for the same
 *    reason — it is the external-party lane, and a template does not know which
 *    consultant an agency hired.
 *
 * 2. DATES ARE COMPUTED IN UTC FROM A PLAIN CALENDAR DATE. `due_date` and
 *    `target_date` are `DATE` columns, and a planner entering the 3rd must get
 *    the 3rd. Parsing "2026-08-03" with the local-time constructor and adding
 *    days would land on the 2nd for anyone west of UTC — the same shift
 *    `formatWorkDeadlineDate` guards against on the way out.
 *
 * 3. A TITLE THIS PROJECT ALREADY HAS IS SKIPPED, NOT DUPLICATED, and the skip
 *    is REPORTED. Applying a template twice — a double click, a retried request,
 *    a planner re-applying after editing — would otherwise leave two of every
 *    deliverable, and cleaning that up by hand is worse work than the template
 *    saved. The comparison is on the trimmed, case-folded title within the same
 *    project and the same record kind, which is what a person would call "the
 *    same one". It is not an idempotency key and does not pretend to be: a
 *    planner who renamed a deliverable gets a fresh copy, which is why the count
 *    of skipped items is returned for the screen to state out loud.
 */

import {
  WORK_PLAN_DEFAULT_MILESTONE_TYPE,
  WORK_PLAN_DEFAULT_PHASE_CODE,
  type WorkPlanTemplateDocument,
} from "@/lib/work-plans/template-registry";

/** A plain calendar date, the shape a `DATE` column round-trips unchanged. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a `YYYY-MM-DD` anchor date, or null when it is not one.
 *
 * Rejects a date that does not exist (2026-02-30) as well as one that is
 * misspelled: `Date.UTC` would roll it forward into March, and a work plan
 * quietly anchored a day or two from where a planner put it is worse than a
 * refusal they can see.
 */
export function parseAnchorDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value.trim())) return null;
  const [year, month, day] = value.trim().split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/** The anchor date plus a whole number of days, as `YYYY-MM-DD`. */
export function addDaysUtc(anchor: Date, offsetDays: number): string {
  const shifted = new Date(anchor.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** How a title is compared when deciding whether this project already has it. */
export function normalizeRecordTitle(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Insert-ready `project_deliverables` columns. Note what is absent: assignee_user_id, owner_label, status. */
export type WorkPlanDeliverableInsert = {
  project_id: string;
  title: string;
  summary: string | null;
  due_date: string;
  created_by: string;
};

/** Insert-ready `project_milestones` columns. */
export type WorkPlanMilestoneInsert = {
  project_id: string;
  title: string;
  summary: string | null;
  milestone_type: string;
  phase_code: string;
  target_date: string;
  created_by: string;
};

export type WorkPlanApplicationPlan = {
  templateId: string;
  anchorDate: string;
  deliverables: WorkPlanDeliverableInsert[];
  milestones: WorkPlanMilestoneInsert[];
  /** Titles this project already carried, so the screen can say why the counts are short. */
  skippedDeliverableTitles: string[];
  skippedMilestoneTitles: string[];
};

export type BuildWorkPlanApplicationOptions = {
  document: WorkPlanTemplateDocument;
  projectId: string;
  createdBy: string;
  /** Already validated by `parseAnchorDate`. */
  anchor: Date;
  /** Titles the project already has, per kind, exactly as read from the database. */
  existingDeliverableTitles: readonly (string | null)[];
  existingMilestoneTitles: readonly (string | null)[];
};

/**
 * The rows a template would write, given an anchor date and what the project
 * already has. Writes nothing; the caller decides whether to.
 */
export function buildWorkPlanApplication(
  options: BuildWorkPlanApplicationOptions
): WorkPlanApplicationPlan {
  const { document, projectId, createdBy, anchor } = options;
  const anchorDate = addDaysUtc(anchor, 0);

  const existingDeliverables = new Set(options.existingDeliverableTitles.map(normalizeRecordTitle));
  const existingMilestones = new Set(options.existingMilestoneTitles.map(normalizeRecordTitle));

  const deliverables: WorkPlanDeliverableInsert[] = [];
  const skippedDeliverableTitles: string[] = [];
  for (const item of document.deliverables) {
    if (existingDeliverables.has(normalizeRecordTitle(item.title))) {
      skippedDeliverableTitles.push(item.title);
      continue;
    }
    // Added to the seen set as we go, so a template that repeated a title
    // internally cannot write it twice in one application either.
    existingDeliverables.add(normalizeRecordTitle(item.title));
    deliverables.push({
      project_id: projectId,
      title: item.title,
      summary: item.summary ?? null,
      due_date: addDaysUtc(anchor, item.offset_days),
      created_by: createdBy,
    });
  }

  const milestones: WorkPlanMilestoneInsert[] = [];
  const skippedMilestoneTitles: string[] = [];
  for (const item of document.milestones) {
    if (existingMilestones.has(normalizeRecordTitle(item.title))) {
      skippedMilestoneTitles.push(item.title);
      continue;
    }
    existingMilestones.add(normalizeRecordTitle(item.title));
    milestones.push({
      project_id: projectId,
      title: item.title,
      summary: item.summary ?? null,
      // The database's own defaults, restated rather than omitted so that a
      // template which sets neither still lands in a phase a planner can see.
      milestone_type: item.milestone_type ?? WORK_PLAN_DEFAULT_MILESTONE_TYPE,
      phase_code: item.phase_code ?? WORK_PLAN_DEFAULT_PHASE_CODE,
      target_date: addDaysUtc(anchor, item.offset_days),
      created_by: createdBy,
    });
  }

  return {
    templateId: document.template_id,
    anchorDate,
    deliverables,
    milestones,
    skippedDeliverableTitles,
    skippedMilestoneTitles,
  };
}
