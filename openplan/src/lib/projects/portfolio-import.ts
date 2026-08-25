import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import {
  PROJECT_DELIVERY_PHASES,
  PROJECT_STATUSES,
  projectDeliveryPhaseSchema,
  projectNameSchema,
  projectPlanTypeSchema,
  projectStatusSchema,
  projectSummarySchema,
  type ProjectDeliveryPhase,
  type ProjectStatus,
} from "@/lib/projects/project-record-fields";

export const PORTFOLIO_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const PORTFOLIO_IMPORT_MAX_ROWS = 2_000;
export const PORTFOLIO_IMPORT_VERSION = 1;

export const PORTFOLIO_COST_SCALES = ["ones", "thousands", "millions"] as const;
export type PortfolioCostScale = (typeof PORTFOLIO_COST_SCALES)[number];

export type PortfolioImportMapping = {
  name: number;
  sourceId?: number;
  description?: number;
  estimatedCost?: number;
  sourceLocation?: number;
};

export type PortfolioImportDefaults = {
  planType: string;
  status: ProjectStatus;
  deliveryPhase: ProjectDeliveryPhase;
  cost?: {
    currency: string;
    scale: PortfolioCostScale;
    priceYear: number;
  };
};

export type PortfolioImportRowReview = {
  rowNumber: number;
  decision: "skip" | "create";
  confirmNameMatch?: boolean;
  planType?: string;
  status?: ProjectStatus;
  deliveryPhase?: ProjectDeliveryPhase;
};

export type PortfolioImportIssue = {
  code:
    | "column_count"
    | "description_too_long"
    | "duplicate_source_id"
    | "invalid_cost"
    | "invalid_delivery_phase"
    | "invalid_name"
    | "invalid_plan_type"
    | "invalid_status"
    | "location_too_long"
    | "name_match"
    | "name_match_confirmation_required"
    | "source_id_too_long";
  message: string;
};

export type PortfolioImportRow = {
  rowNumber: number;
  fingerprint: string;
  name: string;
  sourceId: string | null;
  description: string | null;
  sourceLocationText: string | null;
  estimatedCost: {
    amount: string;
    currency: string;
    priceYear: number;
  } | null;
  planType: string;
  status: ProjectStatus;
  deliveryPhase: ProjectDeliveryPhase;
  decision: "skip" | "create";
  confirmNameMatch: boolean;
  state: "clean" | "warning" | "blocked" | "created_before";
  canCreate: boolean;
  errors: PortfolioImportIssue[];
  warnings: PortfolioImportIssue[];
  matchingProjectIds: string[];
  previouslyCreatedProjectId: string | null;
};

export type PortfolioImportReview = {
  sourceHash: string;
  previewHash: string;
  byteLength: number;
  headers: string[];
  duplicateHeaders: Array<{ header: string; indexes: number[] }>;
  rows: PortfolioImportRow[];
  counts: {
    rows: number;
    selectedForCreate: number;
    skipped: number;
    conflicted: number;
    invalid: number;
    previouslyCreated: number;
  };
};

export type ExistingProjectName = { id: string; name: string };
export type PreviouslyCreatedImportRow = {
  sourceHash: string;
  rowNumber: number;
  rowFingerprint: string;
  projectId: string;
};

export class PortfolioImportError extends Error {
  constructor(
    public readonly code:
      | "csv_parse"
      | "duplicate_mapping"
      | "empty_csv"
      | "invalid_defaults"
      | "invalid_mapping"
      | "invalid_utf8"
      | "missing_cost_defaults"
      | "missing_header"
      | "row_limit"
      | "size_limit",
    message: string
  ) {
    super(message);
    this.name = "PortfolioImportError";
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Exact normalized-name comparisons catch case and spacing changes, not fuzzy guesses. */
export function normalizePortfolioProjectName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function normalizeSourceId(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function trimOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function scaledDecimal(raw: string, scale: PortfolioCostScale): string | null {
  const value = raw.trim();
  // No commas, signs, currency marks, exponent notation, or locale guessing.
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;

  const [whole, fraction = ""] = value.split(".");
  if ((whole + fraction).length > 30) return null;
  if (/^0+$/.test(whole + fraction)) return null;

  const shift = scale === "ones" ? 0 : scale === "thousands" ? 3 : 6;
  const digits = `${whole}${fraction}`;
  const decimalAt = whole.length + shift;
  let scaled: string;
  if (decimalAt >= digits.length) {
    scaled = digits + "0".repeat(decimalAt - digits.length);
  } else if (decimalAt <= 0) {
    scaled = `0.${"0".repeat(-decimalAt)}${digits}`;
  } else {
    scaled = `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  }

  if (!scaled.includes(".")) return scaled.replace(/^0+(?=\d)/, "");
  const [scaledWhole, scaledFraction] = scaled.split(".");
  const normalizedWhole = scaledWhole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = scaledFraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function validateMapping(mapping: PortfolioImportMapping, headerCount: number): void {
  const entries = Object.entries(mapping).filter((entry): entry is [string, number] => entry[1] !== undefined);
  for (const [, index] of entries) {
    if (!Number.isInteger(index) || index < 0 || index >= headerCount) {
      throw new PortfolioImportError(
        "invalid_mapping",
        "Every mapped field must identify a column index from the stored CSV header."
      );
    }
  }
  if (new Set(entries.map(([, index]) => index)).size !== entries.length) {
    throw new PortfolioImportError(
      "duplicate_mapping",
      "One CSV column cannot supply more than one project field. Choose a distinct column for each mapping."
    );
  }
}

function validateDefaults(mapping: PortfolioImportMapping, defaults: PortfolioImportDefaults): void {
  if (
    !projectPlanTypeSchema.safeParse(defaults.planType).success ||
    !projectStatusSchema.safeParse(defaults.status).success ||
    !projectDeliveryPhaseSchema.safeParse(defaults.deliveryPhase).success
  ) {
    throw new PortfolioImportError(
      "invalid_defaults",
      `Choose a project type, one of these statuses (${PROJECT_STATUSES.join(", ")}), and one of these delivery phases (${PROJECT_DELIVERY_PHASES.join(", ")}).`
    );
  }

  if (mapping.estimatedCost === undefined) return;
  const cost = defaults.cost;
  if (
    !cost ||
    !/^[A-Z]{3}$/.test(cost.currency) ||
    !PORTFOLIO_COST_SCALES.includes(cost.scale) ||
    !Number.isInteger(cost.priceYear) ||
    cost.priceYear < 1800 ||
    cost.priceYear > 3000
  ) {
    throw new PortfolioImportError(
      "missing_cost_defaults",
      "A mapped cost requires an explicit three-letter currency, scale, and price year."
    );
  }
}

function findDuplicateHeaders(headers: string[]): Array<{ header: string; indexes: number[] }> {
  const indexes = new Map<string, number[]>();
  headers.forEach((header, index) => {
    const normalized = header.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    if (!normalized) return;
    indexes.set(normalized, [...(indexes.get(normalized) ?? []), index]);
  });
  return [...indexes.entries()]
    .filter(([, positions]) => positions.length > 1)
    .map(([header, positions]) => ({ header, indexes: positions }));
}

function issue(code: PortfolioImportIssue["code"], message: string): PortfolioImportIssue {
  return { code, message };
}

/**
 * Parse and review the exact stored bytes used by both preview and commit.
 * Location strings stop at `sourceLocationText`; this module has no geography field to populate.
 */
export function reviewPortfolioImport(input: {
  bytes: Uint8Array;
  mapping: PortfolioImportMapping;
  defaults: PortfolioImportDefaults;
  rowReviews?: PortfolioImportRowReview[];
  existingProjects?: ExistingProjectName[];
  previouslyCreatedRows?: PreviouslyCreatedImportRow[];
}): PortfolioImportReview {
  if (input.bytes.byteLength > PORTFOLIO_IMPORT_MAX_BYTES) {
    throw new PortfolioImportError("size_limit", "Portfolio CSV files may be at most 10 MiB.");
  }
  if (input.bytes.byteLength === 0) {
    throw new PortfolioImportError("empty_csv", "The stored CSV is empty.");
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    throw new PortfolioImportError("invalid_utf8", "The CSV must use UTF-8 text encoding.");
  }

  let records: string[][];
  try {
    records = parseCsv(decoded, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      max_record_size: PORTFOLIO_IMPORT_MAX_BYTES,
    }) as string[][];
  } catch (error) {
    throw new PortfolioImportError(
      "csv_parse",
      `The stored file could not be read as CSV: ${error instanceof Error ? error.message : "unknown parse error"}`
    );
  }

  if (records.length === 0) {
    throw new PortfolioImportError("missing_header", "The CSV must include a header row.");
  }
  const headers = records[0].map((header) => String(header ?? "").trim());
  if (headers.length === 0 || headers.every((header) => !header)) {
    throw new PortfolioImportError("missing_header", "The CSV header row must name at least one column.");
  }
  const dataRows = records.slice(1);
  if (dataRows.length === 0) {
    throw new PortfolioImportError("empty_csv", "The CSV has a header but no project rows to review.");
  }
  if (dataRows.length > PORTFOLIO_IMPORT_MAX_ROWS) {
    throw new PortfolioImportError(
      "row_limit",
      `Portfolio CSV files may contain at most ${PORTFOLIO_IMPORT_MAX_ROWS.toLocaleString("en-US")} project rows.`
    );
  }

  validateMapping(input.mapping, headers.length);
  validateDefaults(input.mapping, input.defaults);

  const reviewRowNumbers = (input.rowReviews ?? []).map((review) => review.rowNumber);
  if (
    new Set(reviewRowNumbers).size !== reviewRowNumbers.length ||
    reviewRowNumbers.some((rowNumber) => rowNumber < 2 || rowNumber > dataRows.length + 1)
  ) {
    throw new PortfolioImportError(
      "invalid_mapping",
      "Each row decision must identify one distinct row in the stored CSV."
    );
  }
  const reviews = new Map((input.rowReviews ?? []).map((review) => [review.rowNumber, review]));
  const existingByName = new Map<string, string[]>();
  for (const project of input.existingProjects ?? []) {
    const normalized = normalizePortfolioProjectName(project.name);
    existingByName.set(normalized, [...(existingByName.get(normalized) ?? []), project.id]);
  }
  const priorByIdentity = new Map(
    (input.previouslyCreatedRows ?? []).map((row) => [
      `${row.sourceHash}:${row.rowNumber}:${row.rowFingerprint}`,
      row.projectId,
    ])
  );
  const sourceHash = sha256(input.bytes);

  const rows = dataRows.map((record, index): PortfolioImportRow => {
    const rowNumber = index + 2;
    const raw = record.map((cell) => String(cell ?? ""));
    const fingerprint = sha256(JSON.stringify(raw));
    const rowReview = reviews.get(rowNumber);
    const name = raw[input.mapping.name]?.trim() ?? "";
    const sourceId = input.mapping.sourceId === undefined ? null : trimOrNull(raw[input.mapping.sourceId]);
    const description = input.mapping.description === undefined ? null : trimOrNull(raw[input.mapping.description]);
    const sourceLocationText =
      input.mapping.sourceLocation === undefined ? null : trimOrNull(raw[input.mapping.sourceLocation]);
    const planType = rowReview?.planType?.trim() || input.defaults.planType.trim();
    const status = rowReview?.status ?? input.defaults.status;
    const deliveryPhase = rowReview?.deliveryPhase ?? input.defaults.deliveryPhase;
    const errors: PortfolioImportIssue[] = [];
    const warnings: PortfolioImportIssue[] = [];

    if (raw.length !== headers.length) {
      errors.push(
        issue(
          "column_count",
          `This row has ${raw.length} column${raw.length === 1 ? "" : "s"}; the header has ${headers.length}.`
        )
      );
    }
    if (!projectNameSchema.safeParse(name).success) {
      errors.push(issue("invalid_name", "Project name is required and may contain at most 120 characters."));
    }
    if (description !== null && !projectSummarySchema.safeParse(description).success) {
      errors.push(issue("description_too_long", "Description may contain at most 2,000 characters."));
    }
    if (sourceId !== null && sourceId.length > 200) {
      errors.push(issue("source_id_too_long", "Source ID may contain at most 200 characters."));
    }
    if (sourceLocationText !== null && sourceLocationText.length > 2_000) {
      errors.push(issue("location_too_long", "Source-location text may contain at most 2,000 characters."));
    }
    if (!projectPlanTypeSchema.safeParse(planType).success) {
      errors.push(issue("invalid_plan_type", "Project type is required and may contain at most 80 characters."));
    }
    if (!projectStatusSchema.safeParse(status).success) {
      errors.push(issue("invalid_status", "Choose a supported OpenPlan project status."));
    }
    if (!projectDeliveryPhaseSchema.safeParse(deliveryPhase).success) {
      errors.push(issue("invalid_delivery_phase", "Choose a supported OpenPlan delivery phase."));
    }

    let estimatedCost: PortfolioImportRow["estimatedCost"] = null;
    if (input.mapping.estimatedCost !== undefined) {
      const rawCost = raw[input.mapping.estimatedCost]?.trim() ?? "";
      const scaled = scaledDecimal(rawCost, input.defaults.cost!.scale);
      if (scaled === null) {
        errors.push(
          issue(
            "invalid_cost",
            "Cost must be one positive decimal value with no commas, currency marks, signs, or exponent notation."
          )
        );
      } else {
        estimatedCost = {
          amount: scaled,
          currency: input.defaults.cost!.currency,
          priceYear: input.defaults.cost!.priceYear,
        };
      }
    }

    const matchingProjectIds = name ? [...(existingByName.get(normalizePortfolioProjectName(name)) ?? [])].sort() : [];
    if (matchingProjectIds.length > 0) {
      warnings.push(
        issue(
          "name_match",
          "A project with this normalized name already exists. This import will never update it."
        )
      );
    }

    const previouslyCreatedProjectId =
      priorByIdentity.get(`${sourceHash}:${rowNumber}:${fingerprint}`) ?? null;
    const confirmNameMatch = Boolean(rowReview?.confirmNameMatch);
    let decision = rowReview?.decision ?? "skip";
    if (previouslyCreatedProjectId) decision = "skip";
    if (decision === "create" && matchingProjectIds.length > 0 && !confirmNameMatch) {
      warnings.push(
        issue(
          "name_match_confirmation_required",
          "Confirm this row individually before creating another project with the same normalized name."
        )
      );
    }

    const state = previouslyCreatedProjectId
      ? "created_before"
      : errors.length > 0
        ? "blocked"
        : warnings.length > 0
          ? "warning"
          : "clean";
    const canCreate =
      !previouslyCreatedProjectId &&
      errors.length === 0 &&
      (matchingProjectIds.length === 0 || confirmNameMatch);

    return {
      rowNumber,
      fingerprint,
      name,
      sourceId,
      description,
      sourceLocationText,
      estimatedCost,
      planType,
      status,
      deliveryPhase,
      decision,
      confirmNameMatch,
      state,
      canCreate,
      errors,
      warnings,
      matchingProjectIds,
      previouslyCreatedProjectId,
    };
  });

  const sourceIdGroups = new Map<string, PortfolioImportRow[]>();
  for (const row of rows) {
    if (!row.sourceId) continue;
    const normalized = normalizeSourceId(row.sourceId);
    sourceIdGroups.set(normalized, [...(sourceIdGroups.get(normalized) ?? []), row]);
  }
  for (const group of sourceIdGroups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.errors.push(
        issue(
          "duplicate_source_id",
          "This source ID appears on more than one CSV row. The rows may be phases or funding lines, so none will be created."
        )
      );
      row.state = "blocked";
      row.canCreate = false;
      row.decision = "skip";
    }
  }

  const previewShape = {
    version: PORTFOLIO_IMPORT_VERSION,
    sourceHash,
    mapping: input.mapping,
    defaults: input.defaults,
    rows: rows.map((row) => ({
      rowNumber: row.rowNumber,
      fingerprint: row.fingerprint,
      name: row.name,
      sourceId: row.sourceId,
      description: row.description,
      sourceLocationText: row.sourceLocationText,
      estimatedCost: row.estimatedCost,
      planType: row.planType,
      status: row.status,
      deliveryPhase: row.deliveryPhase,
      decision: row.decision,
      confirmNameMatch: row.confirmNameMatch,
      state: row.state,
      canCreate: row.canCreate,
      errorCodes: row.errors.map((entry) => entry.code),
      warningCodes: row.warnings.map((entry) => entry.code),
      matchingProjectIds: row.matchingProjectIds,
      previouslyCreatedProjectId: row.previouslyCreatedProjectId,
    })),
  };

  return {
    sourceHash,
    previewHash: sha256(JSON.stringify(previewShape)),
    byteLength: input.bytes.byteLength,
    headers,
    duplicateHeaders: findDuplicateHeaders(headers),
    rows,
    counts: {
      rows: rows.length,
      selectedForCreate: rows.filter((row) => row.decision === "create" && row.canCreate).length,
      skipped: rows.filter((row) => row.decision === "skip" && row.state !== "created_before").length,
      conflicted: rows.filter((row) => row.errors.some((entry) => entry.code === "duplicate_source_id")).length,
      invalid: rows.filter(
        (row) => row.errors.length > 0 && !row.errors.some((entry) => entry.code === "duplicate_source_id")
      ).length,
      previouslyCreated: rows.filter((row) => row.state === "created_before").length,
    },
  };
}
