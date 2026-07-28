// Shared types for the grant program catalog's jurisdiction registry.
//
// The catalog entries themselves live in sibling bundle modules keyed by
// jurisdiction (`us-federal.ts`, `us-ca.ts`, ...) and are registered in
// `./index.ts`. Nothing here names a place — these types stay
// jurisdiction-neutral so any state or country can carry its programs in a
// bundle of its own.

export type GrantProgramLevel = "federal" | "state";

/**
 * Evidence families the grant workbench can assemble from workspace data for
 * AI drafting support: the project/opportunity record, the funding stack, the
 * modeling packet digest, the screening benefit-cost analysis, the engagement
 * synthesis, and Knowledge Base excerpts. These name OpenPlan's own evidence
 * builders — never a jurisdiction or a data source outside the workspace.
 */
export type GrantApplicationEvidenceKind =
  | "project"
  | "funding"
  | "modeling"
  | "bca"
  | "engagement"
  | "kb";

export const GRANT_APPLICATION_EVIDENCE_KINDS: readonly GrantApplicationEvidenceKind[] = [
  "project",
  "funding",
  "modeling",
  "bca",
  "engagement",
  "kb",
];

/**
 * One section of a program's application, as that program's applications are
 * actually structured. Templates SEED an opportunity's application workspace;
 * every opportunity also supports fully custom sections, so any funder
 * anywhere works without a catalog entry. Guidance is orientation only and is
 * phrased to send the operator to the current NOFO/guidelines — the current
 * call always controls, and programs restructure between cycles.
 */
export type GrantApplicationSectionTemplate = {
  /** Stable kebab-case key, unique within the entry. */
  key: string;
  title: string;
  /** Orientation guidance — always defers to the current NOFO/guidelines. */
  guidance: string;
  /** Workspace evidence families that usually matter for this section. */
  suggestedEvidence: readonly GrantApplicationEvidenceKind[];
  /**
   * Whether AI drafting support may be offered for this section. Defaults to
   * true when omitted. Budget figures, cost estimates, fee schedules, and
   * certifications are never AI-drafted — those sections set false, and the
   * drafting route refuses them outright.
   */
  aiDraftingEnabled?: boolean;
};

/** One item on a program's application attachment checklist. */
export type GrantApplicationAttachmentTemplate = {
  /** Stable kebab-case key, unique within the entry. */
  key: string;
  title: string;
  /** What the item is and where to verify the controlling requirement. */
  guidance: string;
  /** Whether the program's applications generally require this item. */
  required: boolean;
};

export type GrantProgramCatalogEntry = {
  /** Stable unique key for the catalog entry. */
  key: string;
  /** Program name as an operator would track it. */
  name: string;
  /** Who administers the program (as encountered by a California applicant). */
  administeringAgency: string;
  level: GrantProgramLevel;
  /** Who typically applies from a small/rural CA agency perspective. */
  typicalApplicants: string;
  /** Short list of eligible project types. */
  eligibleProjectTypes: string[];
  /** Timing guidance — no hard dates; always says where to verify. */
  cycleNote: string;
  /** Local match posture guidance — verify against current guidelines. */
  matchRequirement: string;
  /** Official program page. */
  url: string;
  /** 2-3 sentence orientation summary. */
  summary: string;
  /**
   * How benefit-cost analysis figures into this program's selection process,
   * when it materially does. Screening guidance only — the current NOFO or
   * program guidelines control what an application must contain.
   */
  bcaNote?: string;
  /**
   * How this program's applications are typically structured, as seed
   * templates for the application workbench. Structure shifts between cycles —
   * verify against the current NOFO/call before relying on it.
   */
  applicationSections?: readonly GrantApplicationSectionTemplate[];
  /** Attachment checklist this program's applications typically require. */
  requiredAttachments?: readonly GrantApplicationAttachmentTemplate[];
};

/**
 * One jurisdiction's slice of the grant program catalog. Bundles are the unit
 * of registration: adding another state or country means authoring a sibling
 * bundle module and registering it in `./index.ts` — call sites never change.
 */
export type GrantProgramBundle = {
  /** Stable registry key, jurisdiction-style: "us" (federal), "us-ca", … */
  key: string;
  /** Operator-facing label, e.g. "US federal programs". */
  label: string;
  programs: readonly GrantProgramCatalogEntry[];
};
