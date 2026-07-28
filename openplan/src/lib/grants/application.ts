/**
 * Grant application assembly: the pure types, parsers, seed builders, and
 * status machines behind migration 20260727000014_grant_application_assembly.
 *
 * An opportunity's application is a set of SECTIONS (seeded from a catalog
 * template by explicit key, or fully custom), an append-only per-section AI
 * DRAFT history, and an ATTACHMENT checklist. Everything here is
 * deterministic and side-effect free — the API routes own I/O.
 *
 * Two invariants this module encodes:
 *  - Budget figures, cost estimates, fee schedules, and certifications are
 *    never AI-drafted: `ai_drafting_enabled` travels with each section row so
 *    the refusal survives catalog drift and covers custom sections.
 *  - Catalog templates only SEED. Matching is by explicit catalog key, never
 *    inferred, and any opportunity works with custom sections alone — a
 *    funder outside the catalog is a first-class case, anywhere.
 */

import {
  GRANT_APPLICATION_EVIDENCE_KINDS,
  GRANT_PROGRAM_CATALOG,
  type GrantApplicationEvidenceKind,
  type GrantProgramCatalogEntry,
} from "@/lib/grants/program-catalog";

// ---------------------------------------------------------------------------
// Vocabularies (mirror the migration's CHECK constraints exactly)
// ---------------------------------------------------------------------------

export const APPLICATION_SECTION_STATUSES = [
  "not_started",
  "drafting",
  "operator_review",
  "final",
] as const;
export type ApplicationSectionStatus = (typeof APPLICATION_SECTION_STATUSES)[number];

export const APPLICATION_SECTION_SOURCES = ["catalog", "custom"] as const;
export type ApplicationSectionSource = (typeof APPLICATION_SECTION_SOURCES)[number];

export const APPLICATION_ATTACHMENT_STATUSES = [
  "missing",
  "in_progress",
  "attached",
  "not_applicable",
] as const;
export type ApplicationAttachmentStatus = (typeof APPLICATION_ATTACHMENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Pending-schema tolerance (routes answer 503 + the migration to apply)
// ---------------------------------------------------------------------------

export const APPLICATION_ASSEMBLY_MIGRATION = "20260727000014_grant_application_assembly";

export const APPLICATION_PENDING_SCHEMA_ERROR = `This deployment's database predates the grant application assembly tables. Apply migration ${APPLICATION_ASSEMBLY_MIGRATION}, then retry.`;

/** PostgREST/Postgres shapes for "the assembly tables are not migrated yet". */
export function looksLikePendingAssemblySchema(message: string | null | undefined): boolean {
  return /could not find the table|relation .* does not exist|schema cache/i.test(message ?? "");
}

// ---------------------------------------------------------------------------
// Row shapes (as read back through the untyped Supabase client)
// ---------------------------------------------------------------------------

/** Canonical select column lists (the untyped client never checks these). */
export const APPLICATION_SECTION_SELECT =
  "id, workspace_id, opportunity_id, section_key, title, guidance, sort_order, source, suggested_evidence, ai_drafting_enabled, status, final_markdown, finalized_from_draft_id, updated_by, created_at, updated_at";

export const APPLICATION_ATTACHMENT_SELECT =
  "id, workspace_id, opportunity_id, attachment_key, title, guidance, required, status, kb_document_id, report_artifact_id, note, sort_order, updated_by, created_at, updated_at";

export type ApplicationSectionRow = {
  id: string;
  workspace_id: string;
  opportunity_id: string;
  section_key: string;
  title: string;
  guidance: string | null;
  sort_order: number;
  source: ApplicationSectionSource;
  suggested_evidence: GrantApplicationEvidenceKind[];
  ai_drafting_enabled: boolean;
  status: ApplicationSectionStatus;
  final_markdown: string | null;
  finalized_from_draft_id: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationAttachmentRow = {
  id: string;
  workspace_id: string;
  opportunity_id: string;
  attachment_key: string;
  title: string;
  guidance: string | null;
  required: boolean;
  status: ApplicationAttachmentStatus;
  kb_document_id: string | null;
  report_artifact_id: string | null;
  note: string | null;
  sort_order: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationSectionDraftRow = {
  id: string;
  workspace_id: string;
  opportunity_id: string;
  section_id: string;
  draft_markdown: string;
  model: string | null;
  grounding_json: unknown;
  grounded_sentence_count: number | null;
  total_sentence_count: number | null;
  revision_of: string | null;
  revision_instructions: string | null;
  created_by: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Catalog lookup + seed builders
// ---------------------------------------------------------------------------

/** Find a catalog entry by its explicit key. Matching is never inferred. */
export function findGrantProgramCatalogEntry(
  catalogKey: string
): GrantProgramCatalogEntry | null {
  const trimmed = catalogKey.trim();
  if (!trimmed) return null;
  return GRANT_PROGRAM_CATALOG.find((entry) => entry.key === trimmed) ?? null;
}

/** Insert-payload shape for one seeded/custom section (ids added by the route). */
export type ApplicationSectionSeed = {
  section_key: string;
  title: string;
  guidance: string | null;
  sort_order: number;
  source: ApplicationSectionSource;
  suggested_evidence: GrantApplicationEvidenceKind[];
  ai_drafting_enabled: boolean;
};

/** Insert-payload shape for one seeded/custom attachment (ids added by the route). */
export type ApplicationAttachmentSeed = {
  attachment_key: string;
  title: string;
  guidance: string | null;
  required: boolean;
  sort_order: number;
};

/** Build section insert payloads from a catalog entry's templates, in order. */
export function buildCatalogSectionSeeds(
  entry: GrantProgramCatalogEntry
): ApplicationSectionSeed[] {
  return (entry.applicationSections ?? []).map((template, index) => ({
    section_key: template.key,
    title: template.title,
    guidance: template.guidance,
    sort_order: index,
    source: "catalog",
    suggested_evidence: [...template.suggestedEvidence],
    // Omitted means draftable; only an explicit false forbids AI drafting.
    ai_drafting_enabled: template.aiDraftingEnabled !== false,
  }));
}

/** Build attachment insert payloads from a catalog entry's checklist, in order. */
export function buildCatalogAttachmentSeeds(
  entry: GrantProgramCatalogEntry
): ApplicationAttachmentSeed[] {
  return (entry.requiredAttachments ?? []).map((template, index) => ({
    attachment_key: template.key,
    title: template.title,
    guidance: template.guidance,
    required: template.required,
    sort_order: index,
  }));
}

// ---------------------------------------------------------------------------
// Status machines
// ---------------------------------------------------------------------------

/**
 * Section lifecycle. Finalization (→ 'final') is allowed from any state but
 * carries its own gate in the route: final_markdown must exist, and an
 * UNEDITED AI draft may only be committed when `isNarrativeExportable` passes.
 * The only exit from 'final' is reopening to operator_review — finalized text
 * is never silently degraded back to a draft state.
 */
const SECTION_STATUS_TRANSITIONS: Record<
  ApplicationSectionStatus,
  readonly ApplicationSectionStatus[]
> = {
  not_started: ["drafting", "operator_review", "final"],
  drafting: ["operator_review", "final"],
  operator_review: ["drafting", "final"],
  final: ["operator_review"],
};

export function canTransitionSectionStatus(
  from: ApplicationSectionStatus,
  to: ApplicationSectionStatus
): boolean {
  if (from === to) return true; // idempotent no-op
  return SECTION_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Attachment checklist states. Every move between distinct states is a
 * legitimate operator correction (an attached item can be detached, an
 * inapplicable item can become applicable) — the map exists so any future
 * tightening happens here, in one place, instead of scattered in routes.
 */
const ATTACHMENT_STATUS_TRANSITIONS: Record<
  ApplicationAttachmentStatus,
  readonly ApplicationAttachmentStatus[]
> = {
  missing: ["in_progress", "attached", "not_applicable"],
  in_progress: ["missing", "attached", "not_applicable"],
  attached: ["missing", "in_progress", "not_applicable"],
  not_applicable: ["missing", "in_progress", "attached"],
};

export function canTransitionAttachmentStatus(
  from: ApplicationAttachmentStatus,
  to: ApplicationAttachmentStatus
): boolean {
  if (from === to) return true; // idempotent no-op
  return ATTACHMENT_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Defensive parsers (stored rows come back through an untyped client)
// ---------------------------------------------------------------------------

function isEvidenceKind(value: unknown): value is GrantApplicationEvidenceKind {
  return (
    typeof value === "string" &&
    (GRANT_APPLICATION_EVIDENCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Parse a stored suggested_evidence value. Unknown entries are dropped, not
 * errors — an older client must not break on a newer evidence family, and a
 * malformed value degrades to "no emphasis" (the full fact list), never to a
 * crash.
 */
export function parseSuggestedEvidence(value: unknown): GrantApplicationEvidenceKind[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEvidenceKind);
}

function isSectionStatus(value: unknown): value is ApplicationSectionStatus {
  return (
    typeof value === "string" &&
    (APPLICATION_SECTION_STATUSES as readonly string[]).includes(value)
  );
}

function isSectionSource(value: unknown): value is ApplicationSectionSource {
  return (
    typeof value === "string" &&
    (APPLICATION_SECTION_SOURCES as readonly string[]).includes(value)
  );
}

function isAttachmentStatus(value: unknown): value is ApplicationAttachmentStatus {
  return (
    typeof value === "string" &&
    (APPLICATION_ATTACHMENT_STATUSES as readonly string[]).includes(value)
  );
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Defensively parse a stored section row; null for malformed payloads. */
export function parseApplicationSectionRow(value: unknown): ApplicationSectionRow | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.workspace_id !== "string" ||
    typeof record.opportunity_id !== "string" ||
    typeof record.section_key !== "string" ||
    typeof record.title !== "string"
  ) {
    return null;
  }
  if (!isSectionStatus(record.status) || !isSectionSource(record.source)) return null;

  return {
    id: record.id,
    workspace_id: record.workspace_id,
    opportunity_id: record.opportunity_id,
    section_key: record.section_key,
    title: record.title,
    guidance: asOptionalString(record.guidance),
    sort_order: typeof record.sort_order === "number" ? record.sort_order : 0,
    source: record.source,
    suggested_evidence: parseSuggestedEvidence(record.suggested_evidence),
    // Missing/malformed parses as NOT draftable: the never-AI rule fails
    // closed, so a degraded row can refuse drafting but never permit it.
    ai_drafting_enabled: record.ai_drafting_enabled === true,
    status: record.status,
    final_markdown: asOptionalString(record.final_markdown),
    finalized_from_draft_id: asOptionalString(record.finalized_from_draft_id),
    updated_by: asOptionalString(record.updated_by),
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    updated_at: typeof record.updated_at === "string" ? record.updated_at : "",
  };
}

/** Defensively parse a stored attachment row; null for malformed payloads. */
export function parseApplicationAttachmentRow(
  value: unknown
): ApplicationAttachmentRow | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.workspace_id !== "string" ||
    typeof record.opportunity_id !== "string" ||
    typeof record.attachment_key !== "string" ||
    typeof record.title !== "string"
  ) {
    return null;
  }
  if (!isAttachmentStatus(record.status)) return null;

  return {
    id: record.id,
    workspace_id: record.workspace_id,
    opportunity_id: record.opportunity_id,
    attachment_key: record.attachment_key,
    title: record.title,
    guidance: asOptionalString(record.guidance),
    required: record.required === true,
    status: record.status,
    kb_document_id: asOptionalString(record.kb_document_id),
    report_artifact_id: asOptionalString(record.report_artifact_id),
    note: asOptionalString(record.note),
    sort_order: typeof record.sort_order === "number" ? record.sort_order : 0,
    updated_by: asOptionalString(record.updated_by),
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    updated_at: typeof record.updated_at === "string" ? record.updated_at : "",
  };
}
