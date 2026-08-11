/**
 * Work-plan template registry — the machinery, not the content.
 *
 * A WORK-PLAN TEMPLATE IS A DATA ARTIFACT, exactly as a stage-gate template is
 * (`src/lib/stage-gates/template-registry.ts`, which this file deliberately
 * mirrors): an ordered set of deliverables and milestones that standard planning
 * practice puts on a piece of work, each offset in DAYS from one named anchor.
 * Adding a template means adding a JSON artifact and one registration entry —
 * never an edit to a call site, a switch, or a consumer.
 *
 * THE THREE RULES THIS MODULE ENFORCES, AND WHY EACH ONE MATTERS.
 *
 * 1. `createWorkPlanTemplateRegistry` is exported SEPARATELY from any built-in
 *    instance (which lives in `./built-in.ts`, so the content set can grow
 *    without touching this machinery). A future workspace-authored or
 *    database-backed template set gets built into a registry without this file
 *    changing.
 *
 * 2. THE RESOLVER NEVER DEFAULTS. `findForProject` answers `matched`,
 *    `ambiguous`, or `no_template`, and there is deliberately NO
 *    `defaultTemplateId` anywhere in this module — not even an
 *    explicitly-labelled interim one, which is what the stage-gate registry
 *    carries. The difference is what the two artifacts DO. Binding the wrong
 *    stage-gate pack shows a planner the wrong checklist; applying the wrong
 *    work-plan template WRITES twenty dated deliverables into somebody's project
 *    and into their teammates' work queues. A wrong checklist is read; a wrong
 *    work plan is worked. So an unresolved query is an answer the caller must
 *    handle, and the only way a template is ever applied is a person choosing it
 *    by name.
 *
 * 3. `scope_notes` IS FIRST-CLASS AND REQUIRED. Every template is a
 *    standard-practice starting point to be edited, never a statement of what a
 *    given agency must produce, and the artifact says so in its own words rather
 *    than relying on a sentence somewhere in the UI. A template that failed to
 *    load its scope notes would render without exactly the honesty text it was
 *    authored to carry, so a missing or empty `scope_notes` is a registration
 *    failure, not a warning.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not read or write the database, it does
 * not know what a project is, and it holds no template content of its own.
 * Applying a template is `./apply.ts`; the artifacts are `./templates/*.json`.
 *
 * VOCABULARIES ARE THE DATABASE'S. `WORK_PLAN_MILESTONE_TYPES` and
 * `WORK_PLAN_PHASE_CODES` are the CHECK constraints of `project_milestones`
 * (20260321000033, amended by 20260416000053) — proven by
 * `src/test/work-plan-template-registry.test.ts`, which parses the migrations
 * rather than trusting this file. A template naming a value Postgres rejects
 * would fail at apply time, in front of a planner, with a 500.
 */

/**
 * What a template's day offsets are counted from. The planner supplies the DATE
 * for one of these; nothing here invents one.
 *
 * Three, because they are the three moments an agency actually records: the day
 * a consultant is told to start, the day money is awarded, and the day the team
 * first meets. A template declares which of the three its offsets assume, so a
 * plan anchored on award cannot be silently re-based on a kickoff date.
 */
export const WORK_PLAN_ANCHORS = ["notice_to_proceed", "award", "kickoff"] as const;
export type WorkPlanAnchor = (typeof WORK_PLAN_ANCHORS)[number];

export const WORK_PLAN_ANCHOR_LABELS: Record<WorkPlanAnchor, string> = {
  notice_to_proceed: "Notice to proceed",
  award: "Award date",
  kickoff: "Kickoff meeting",
};

/**
 * The broad practice area a template belongs to — used to GROUP the picker, and
 * for nothing else. It is not a filter on who may apply what: a county planning
 * department runs both kinds of work and frequently on the same project.
 */
export const WORK_PLAN_PRACTICE_AREAS = ["transportation", "land_use", "general"] as const;
export type WorkPlanPracticeArea = (typeof WORK_PLAN_PRACTICE_AREAS)[number];

export const WORK_PLAN_PRACTICE_AREA_LABELS: Record<WorkPlanPracticeArea, string> = {
  transportation: "Transportation planning",
  land_use: "Land-use planning",
  general: "Any planning work",
};

/**
 * `project_milestones.milestone_type`, MINUS the one deliberate exclusion below.
 */
export const WORK_PLAN_MILESTONE_TYPES = [
  "authorization",
  "agreement",
  "schedule",
  "hearing",
  "invoice",
  "deliverable",
  "decision",
  "permit",
  "closeout",
  "other",
] as const;
export type WorkPlanMilestoneType = (typeof WORK_PLAN_MILESTONE_TYPES)[number];

/**
 * `obligation` is a real milestone_type (20260416000053) and templates may not
 * use it. An obligation milestone MIRRORS a funding award — it carries
 * `funding_award_id`, it is de-duplicated against that award on `/my-work`, and
 * a partial unique index enforces one per award. A template has no award to
 * mirror, so an obligation milestone authored from a template would be an
 * obligation deadline with no obligation behind it.
 */
export const WORK_PLAN_EXCLUDED_MILESTONE_TYPES = ["obligation"] as const;

/** `project_milestones.phase_code`. */
export const WORK_PLAN_PHASE_CODES = [
  "initiation",
  "procurement",
  "environmental",
  "outreach",
  "programming",
  "ps_e",
  "row_utilities",
  "advertise_award",
  "construction",
  "closeout",
  "other",
] as const;
export type WorkPlanPhaseCode = (typeof WORK_PLAN_PHASE_CODES)[number];

/** The database defaults, restated so `apply.ts` never sends a column it need not. */
export const WORK_PLAN_DEFAULT_MILESTONE_TYPE: WorkPlanMilestoneType = "schedule";
export const WORK_PLAN_DEFAULT_PHASE_CODE: WorkPlanPhaseCode = "initiation";

/**
 * Where a template's assumptions come from, when it has any.
 *
 * ABSENT MEANS JURISDICTION-NEUTRAL, which is what almost every template should
 * be. A template whose deliverables assume one state's environmental or housing
 * statute is NOT neutral and must carry this field — that is how a planner in
 * another state can see, before applying it, that it was written for somewhere
 * else. Same ISO shape as the stage-gate registry so the two read alike.
 */
export type WorkPlanTemplateJurisdiction = {
  country: string;
  /** Omitted for templates that apply nationwide. */
  subdivision?: string;
  label: string;
};

/** What a caller knows about the place a project sits in. `subdivision: null` = not established. */
export type WorkPlanJurisdictionQuery = {
  country: string;
  subdivision?: string | null;
};

/** One deliverable a template asks for. */
export type WorkPlanTemplateDeliverable = {
  /** Stable within the template; used for ordering and for error messages, never written to the database. */
  key: string;
  title: string;
  summary?: string;
  /** Days AFTER the anchor date. 0 = on the anchor day. */
  offset_days: number;
};

/** One milestone a template asks for. */
export type WorkPlanTemplateMilestone = {
  key: string;
  title: string;
  summary?: string;
  offset_days: number;
  milestone_type?: WorkPlanMilestoneType;
  phase_code?: WorkPlanPhaseCode;
};

/** The artifact itself, as authored in JSON. */
export type WorkPlanTemplateDocument = {
  template_id: string;
  template_name: string;
  version: string;
  practice_area: WorkPlanPracticeArea;
  anchor: WorkPlanAnchor;
  /**
   * Project plan types this template is offered for, matched case-insensitively
   * against `projects.plan_type`.
   *
   * AN EMPTY LIST IS LEGAL AND MEANINGFUL: it means "never suggested for any
   * project, only ever chosen by name". The generic starter template uses it, so
   * that a registry with one entry cannot quietly become a default for
   * everything — which is rule 2 of this module made concrete rather than
   * merely written down.
   */
  applies_to_plan_types: string[];
  description?: string;
  /** REQUIRED and non-empty. See rule 3. */
  scope_notes: string[];
  jurisdiction?: WorkPlanTemplateJurisdiction;
  deliverables: WorkPlanTemplateDeliverable[];
  milestones: WorkPlanTemplateMilestone[];
};

/** The validated header of an artifact, in the shape a picker renders. */
export type WorkPlanTemplateDescriptor = {
  templateId: string;
  templateName: string;
  templateVersion: string;
  practiceArea: WorkPlanPracticeArea;
  anchor: WorkPlanAnchor;
  appliesToPlanTypes: readonly string[];
  description?: string;
  scopeNotes: readonly string[];
  jurisdiction?: WorkPlanTemplateJurisdiction;
  deliverableCount: number;
  milestoneCount: number;
  /** Days from the anchor to the last dated item — what a planner needs to sanity-check the anchor date. */
  spanDays: number;
};

export type WorkPlanTemplateEntry = {
  descriptor: WorkPlanTemplateDescriptor;
  document: WorkPlanTemplateDocument;
};

/** What a caller supplies to register a template. The artifact is validated here, so DB-sourced JSON is acceptable. */
export type WorkPlanTemplateRegistration = {
  artifact: unknown;
};

export type WorkPlanTemplateMatch =
  | { kind: "matched"; entry: WorkPlanTemplateEntry }
  | { kind: "ambiguous"; entries: readonly WorkPlanTemplateEntry[] }
  | { kind: "no_template" };

export type WorkPlanTemplateQuery = {
  /** `projects.plan_type` — free text by design (no CHECK), so matching is normalized, never assumed. */
  planType?: string | null;
  jurisdiction?: WorkPlanJurisdictionQuery | null;
};

export type WorkPlanTemplateRegistry = {
  /** Every registered template, in registration order. */
  list: () => readonly WorkPlanTemplateDescriptor[];
  get: (templateId: string) => WorkPlanTemplateEntry | null;
  /** Tri-state, never defaulting. See rule 2. */
  findForProject: (query: WorkPlanTemplateQuery) => WorkPlanTemplateMatch;
};

// ── validation ──────────────────────────────────────────────────────────────

export type WorkPlanTemplateValidation =
  | { ok: true; document: WorkPlanTemplateDocument; errors: readonly string[] }
  | { ok: false; errors: readonly string[] };

function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** A whole number of days, zero or more. Fractions and negatives are authoring errors, not schedules. */
function isOffsetDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3650;
}

function validateJurisdiction(raw: unknown, errors: string[]): WorkPlanTemplateJurisdiction | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push("jurisdiction must be an object when present");
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.country)) errors.push("jurisdiction.country is required");
  if (!isNonEmptyString(record.label)) errors.push("jurisdiction.label is required");
  if (record.subdivision !== undefined && !isNonEmptyString(record.subdivision)) {
    errors.push("jurisdiction.subdivision must be a non-empty string when present");
  }
  if (!isNonEmptyString(record.country) || !isNonEmptyString(record.label)) return undefined;
  return {
    country: record.country.trim().toUpperCase(),
    ...(isNonEmptyString(record.subdivision) ? { subdivision: record.subdivision.trim().toUpperCase() } : {}),
    label: record.label.trim(),
  };
}

type ItemShape = { key: string; title: string; summary?: string; offset_days: number };

function validateItem(raw: unknown, path: string, errors: string[]): ItemShape | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const record = raw as Record<string, unknown>;
  let ok = true;
  if (!isNonEmptyString(record.key)) {
    errors.push(`${path}.key is required`);
    ok = false;
  }
  if (!isNonEmptyString(record.title)) {
    errors.push(`${path}.title is required`);
    ok = false;
  } else if (record.title.trim().length > 160) {
    // project_deliverables.title / project_milestones.title reach the same API
    // bound; a template that exceeded it would fail at apply time.
    errors.push(`${path}.title must be 160 characters or fewer`);
    ok = false;
  }
  if (!isOffsetDays(record.offset_days)) {
    errors.push(`${path}.offset_days must be a whole number of days between 0 and 3650`);
    ok = false;
  }
  if (record.summary !== undefined && !isNonEmptyString(record.summary)) {
    errors.push(`${path}.summary must be a non-empty string when present`);
    ok = false;
  }
  if (!ok) return null;
  return {
    key: (record.key as string).trim(),
    title: (record.title as string).trim(),
    ...(isNonEmptyString(record.summary) ? { summary: record.summary.trim() } : {}),
    offset_days: record.offset_days as number,
  };
}

function assertUniqueKeys(items: readonly { key: string }[], path: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = normalizeKey(item.key);
    if (seen.has(key)) errors.push(`${path} has duplicate key "${item.key}"`);
    seen.add(key);
  }
}

/**
 * Validate one artifact, COLLECTING every problem rather than throwing on the
 * first.
 *
 * That is the whole reason this is a function and not an inline throw: the
 * registry's content test (Lane F's) validates every shipped template at once
 * and a reviewer wants the full list of what is wrong, not the first line of it.
 * Registration below turns the same result into a throw, because a malformed
 * BUILT-IN template is a bug that must stop the build.
 */
export function validateWorkPlanTemplateArtifact(artifact: unknown): WorkPlanTemplateValidation {
  const errors: string[] = [];
  if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
    return { ok: false, errors: ["work-plan template artifact must be an object"] };
  }
  const raw = artifact as Record<string, unknown>;

  for (const field of ["template_id", "template_name", "version"] as const) {
    if (!isNonEmptyString(raw[field])) errors.push(`${field} is required`);
  }

  if (!(WORK_PLAN_PRACTICE_AREAS as readonly unknown[]).includes(raw.practice_area)) {
    errors.push(`practice_area must be one of ${WORK_PLAN_PRACTICE_AREAS.join(", ")}`);
  }
  if (!(WORK_PLAN_ANCHORS as readonly unknown[]).includes(raw.anchor)) {
    errors.push(`anchor must be one of ${WORK_PLAN_ANCHORS.join(", ")}`);
  }

  if (!isStringArray(raw.applies_to_plan_types)) {
    errors.push("applies_to_plan_types must be an array of strings (an empty array is allowed)");
  }

  if (!isStringArray(raw.scope_notes) || raw.scope_notes.length === 0) {
    // Rule 3. Not a warning: a template with no scope notes is a template
    // presenting standard practice as this agency's requirement.
    errors.push("scope_notes is required and must contain at least one note");
  }

  if (raw.description !== undefined && !isNonEmptyString(raw.description)) {
    errors.push("description must be a non-empty string when present");
  }

  const jurisdiction = validateJurisdiction(raw.jurisdiction, errors);

  const deliverablesRaw = Array.isArray(raw.deliverables) ? raw.deliverables : null;
  const milestonesRaw = Array.isArray(raw.milestones) ? raw.milestones : null;
  if (!deliverablesRaw) errors.push("deliverables must be an array");
  if (!milestonesRaw) errors.push("milestones must be an array");
  if ((deliverablesRaw?.length ?? 0) + (milestonesRaw?.length ?? 0) === 0) {
    errors.push("a template must contain at least one deliverable or milestone");
  }

  const deliverables: WorkPlanTemplateDeliverable[] = [];
  (deliverablesRaw ?? []).forEach((entry, index) => {
    const item = validateItem(entry, `deliverables[${index}]`, errors);
    if (item) deliverables.push(item);
  });

  const milestones: WorkPlanTemplateMilestone[] = [];
  (milestonesRaw ?? []).forEach((entry, index) => {
    const item = validateItem(entry, `milestones[${index}]`, errors);
    if (!item) return;
    const record = entry as Record<string, unknown>;
    const path = `milestones[${index}]`;
    let vocabularyOk = true;
    if (record.milestone_type !== undefined) {
      if ((WORK_PLAN_EXCLUDED_MILESTONE_TYPES as readonly unknown[]).includes(record.milestone_type)) {
        errors.push(`${path}.milestone_type "${String(record.milestone_type)}" may not be authored by a template`);
        vocabularyOk = false;
      } else if (!(WORK_PLAN_MILESTONE_TYPES as readonly unknown[]).includes(record.milestone_type)) {
        errors.push(`${path}.milestone_type must be one of ${WORK_PLAN_MILESTONE_TYPES.join(", ")}`);
        vocabularyOk = false;
      }
    }
    if (record.phase_code !== undefined && !(WORK_PLAN_PHASE_CODES as readonly unknown[]).includes(record.phase_code)) {
      errors.push(`${path}.phase_code must be one of ${WORK_PLAN_PHASE_CODES.join(", ")}`);
      vocabularyOk = false;
    }
    if (!vocabularyOk) return;
    milestones.push({
      ...item,
      ...(record.milestone_type !== undefined ? { milestone_type: record.milestone_type as WorkPlanMilestoneType } : {}),
      ...(record.phase_code !== undefined ? { phase_code: record.phase_code as WorkPlanPhaseCode } : {}),
    });
  });

  assertUniqueKeys(deliverables, "deliverables", errors);
  assertUniqueKeys(milestones, "milestones", errors);

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    document: {
      template_id: (raw.template_id as string).trim(),
      template_name: (raw.template_name as string).trim(),
      version: (raw.version as string).trim(),
      practice_area: raw.practice_area as WorkPlanPracticeArea,
      anchor: raw.anchor as WorkPlanAnchor,
      applies_to_plan_types: (raw.applies_to_plan_types as string[]).map((entry) => entry.trim()),
      ...(isNonEmptyString(raw.description) ? { description: raw.description.trim() } : {}),
      scope_notes: (raw.scope_notes as string[]).map((note) => note.trim()),
      ...(jurisdiction ? { jurisdiction } : {}),
      deliverables,
      milestones,
    },
  };
}

function describeDocument(document: WorkPlanTemplateDocument): WorkPlanTemplateDescriptor {
  const offsets = [...document.deliverables, ...document.milestones].map((item) => item.offset_days);
  return {
    templateId: document.template_id,
    templateName: document.template_name,
    templateVersion: document.version,
    practiceArea: document.practice_area,
    anchor: document.anchor,
    appliesToPlanTypes: document.applies_to_plan_types,
    ...(document.description ? { description: document.description } : {}),
    scopeNotes: document.scope_notes,
    ...(document.jurisdiction ? { jurisdiction: document.jurisdiction } : {}),
    deliverableCount: document.deliverables.length,
    milestoneCount: document.milestones.length,
    spanDays: offsets.length > 0 ? Math.max(...offsets) : 0,
  };
}

/**
 * Build a registry from registrations.
 *
 * Every failure here is a registration bug rather than a runtime condition, so
 * they throw: a registry that silently dropped a malformed or duplicate template
 * would leave a picker offering a template id nothing can resolve.
 */
export function createWorkPlanTemplateRegistry(
  registrations: readonly WorkPlanTemplateRegistration[]
): WorkPlanTemplateRegistry {
  const entries = new Map<string, WorkPlanTemplateEntry>();
  const descriptors: WorkPlanTemplateDescriptor[] = [];

  for (const registration of registrations) {
    const validation = validateWorkPlanTemplateArtifact(registration.artifact);
    if (!validation.ok) {
      throw new Error(`Invalid work-plan template artifact: ${validation.errors.join("; ")}`);
    }
    const { document } = validation;
    if (entries.has(document.template_id)) {
      throw new Error(`Duplicate work-plan template registration: ${document.template_id}`);
    }
    const descriptor = describeDocument(document);
    descriptors.push(descriptor);
    entries.set(document.template_id, { descriptor, document });
  }

  /**
   * Candidates for a query, most specific jurisdiction tier only.
   *
   * The two rules are the stage-gate registry's, for the same reason: a
   * jurisdiction-scoped template covers ONLY a project whose subdivision it
   * names, and when the caller cannot say which subdivision a project is in,
   * only jurisdiction-NEUTRAL templates are candidates. Offering a California
   * template to a project whose state is unknown is the substitution this
   * registry exists to prevent.
   */
  function candidates(query: WorkPlanTemplateQuery): readonly WorkPlanTemplateEntry[] {
    const planType = normalizeKey(query.planType);
    if (!planType) return [];

    const byPlanType = descriptors.filter((descriptor) =>
      descriptor.appliesToPlanTypes.some((entry) => normalizeKey(entry) === planType)
    );

    const country = normalizeKey(query.jurisdiction?.country).toUpperCase();
    const subdivision = normalizeKey(query.jurisdiction?.subdivision).toUpperCase();

    const neutral = byPlanType.filter((descriptor) => !descriptor.jurisdiction);
    const scoped = byPlanType.filter(
      (descriptor) =>
        descriptor.jurisdiction &&
        country &&
        descriptor.jurisdiction.country.toUpperCase() === country &&
        (descriptor.jurisdiction.subdivision
          ? Boolean(subdivision) && descriptor.jurisdiction.subdivision.toUpperCase() === subdivision
          : true)
    );

    const tier = scoped.length > 0 ? scoped : neutral;
    return tier
      .map((descriptor) => entries.get(descriptor.templateId))
      .filter((entry): entry is WorkPlanTemplateEntry => Boolean(entry));
  }

  return {
    list: () => descriptors,
    get: (templateId) => entries.get(templateId) ?? null,
    findForProject: (query) => {
      const covering = candidates(query);
      if (covering.length === 0) return { kind: "no_template" };
      if (covering.length === 1) return { kind: "matched", entry: covering[0] };
      return { kind: "ambiguous", entries: covering };
    },
  };
}
