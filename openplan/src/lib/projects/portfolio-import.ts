import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import {
  PORTFOLIO_IMPORT_MAX_BYTES,
  PORTFOLIO_IMPORT_MAX_ROWS,
  inspectPortfolioWorkbook,
  readPortfolioSheet,
  type PortfolioCell,
  type PortfolioSourceFormat,
  type PortfolioWorksheetManifest,
} from "@/lib/projects/portfolio-workbook";
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

export { PORTFOLIO_IMPORT_MAX_BYTES, PORTFOLIO_IMPORT_MAX_ROWS } from "@/lib/projects/portfolio-workbook";
export const PORTFOLIO_IMPORT_VERSION = 1;
export const PORTFOLIO_WORKBOOK_IMPORT_VERSION = 2;

export const PORTFOLIO_COST_SCALES = ["ones", "thousands", "millions"] as const;
export type PortfolioCostScale = (typeof PORTFOLIO_COST_SCALES)[number];

export type PortfolioImportMapping = {
  name: number;
  sourceId?: number;
  description?: number;
  estimatedCost?: number;
  costCurrency?: number;
  costPriceYear?: number;
  planType?: number;
  status?: number;
  deliveryPhase?: number;
  sourceLocation?: number;
};

export type PortfolioImportDefaults = {
  planType: string;
  status: ProjectStatus;
  deliveryPhase: ProjectDeliveryPhase;
  cost?: {
    currency: string;
    scale: PortfolioCostScale;
    priceYear: number | null;
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
    | "unknown_price_year"
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
    priceYear: number | null;
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
    (cost.priceYear !== null && (
      !Number.isInteger(cost.priceYear) || cost.priceYear < 1800 || cost.priceYear > 3000
    ))
  ) {
    throw new PortfolioImportError(
      "missing_cost_defaults",
      "A mapped cost requires an explicit three-letter currency and scale; price year must be a valid year or unknown."
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
        if (estimatedCost.priceYear === null) {
          warnings.push(issue("unknown_price_year", "Cost price year is unknown; do not treat this estimate as current-year prices."));
        }
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

export type PortfolioSheetConfiguration = {
  worksheetIndex: number;
  headerRow: number;
  mapping: PortfolioImportMapping;
  defaults: PortfolioImportDefaults;
};

export type PortfolioWorkbookRowReview = Omit<PortfolioImportRowReview, "rowNumber"> & {
  worksheetIndex: number;
  rowNumber: number;
  confirmFormula?: boolean;
};

export type PreviouslyCreatedWorkbookRow = PreviouslyCreatedImportRow & {
  worksheetIndex: number;
};

export type PortfolioWorkbookIssue = {
  code:
    | PortfolioImportIssue["code"]
    | "batch_name_match"
    | "formula_confirmation_required"
    | "formula_error"
    | "formula_missing_value"
    | "formula_value"
    | "unsupported_cell";
  message: string;
};

export type PortfolioWorkbookImportRow = Omit<
  PortfolioImportRow,
  "errors" | "warnings" | "confirmNameMatch"
> & {
  worksheetIndex: number;
  worksheetName: string;
  headerRow: number;
  formulaFields: string[];
  confirmNameMatch: boolean;
  confirmFormula: boolean;
  matchingBatchRows: Array<{ worksheetIndex: number; rowNumber: number }>;
  errors: PortfolioWorkbookIssue[];
  warnings: PortfolioWorkbookIssue[];
};

export type PortfolioSheetReview = {
  worksheetIndex: number;
  worksheetName: string;
  headerRow: number;
  headers: string[];
  duplicateHeaders: Array<{ header: string; indexes: number[] }>;
};

export type PortfolioWorkbookReview = {
  version: 2;
  format: PortfolioSourceFormat;
  sourceHash: string;
  previewHash: string;
  byteLength: number;
  worksheets: PortfolioWorksheetManifest[];
  sheets: PortfolioSheetReview[];
  configurations: PortfolioSheetConfiguration[];
  rows: PortfolioWorkbookImportRow[];
  formulaWarnings: Array<{
    worksheetIndex: number;
    rowNumber: number;
    fields: string[];
  }>;
  counts: PortfolioImportReview["counts"];
};

type MappedField = keyof PortfolioImportMapping;

function workbookIssue(
  code: PortfolioWorkbookIssue["code"],
  message: string
): PortfolioWorkbookIssue {
  return { code, message };
}

function decimalFromNumber(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const raw = String(value);
  if (!/[eE]/.test(raw)) return raw;
  const [mantissa, exponentText] = raw.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent)) return null;
  const negative = mantissa.startsWith("-");
  if (negative) return null;
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = `${whole}${fraction}`;
  const decimalAt = whole.length + exponent;
  if (decimalAt <= 0) return `0.${"0".repeat(-decimalAt)}${digits}`;
  if (decimalAt >= digits.length) return `${digits}${"0".repeat(decimalAt - digits.length)}`;
  return `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
}

function mappedCellText(
  cell: PortfolioCell | undefined,
  field: MappedField,
  errors: PortfolioWorkbookIssue[],
  formulaFields: string[]
): string {
  const value = cell ?? {
    type: "blank" as const,
    value: null,
    display: "",
    formula: false,
    formulaHash: null,
    formulaResult: "none" as const,
  };
  if (value.formula) {
    formulaFields.push(field);
    if (value.formulaResult === "missing") {
      errors.push(workbookIssue("formula_missing_value", `${field} uses a formula with no cached result.`));
    } else if (value.formulaResult === "error") {
      errors.push(workbookIssue("formula_error", `${field} uses a formula whose cached result is an error.`));
    }
  }
  if (value.type === "blank") return "";
  if (value.type === "text" || value.type === "number") return String(value.value ?? "");
  errors.push(workbookIssue("unsupported_cell", `${field} is a ${value.type} cell and cannot be imported.`));
  return "";
}

function mappedCost(
  cell: PortfolioCell | undefined,
  defaults: PortfolioImportDefaults,
  errors: PortfolioWorkbookIssue[],
  formulaFields: string[],
  mappedCurrency?: PortfolioCell,
  mappedPriceYear?: PortfolioCell
): PortfolioImportRow["estimatedCost"] {
  const value = cell ?? {
    type: "blank" as const,
    value: null,
    display: "",
    formula: false,
    formulaHash: null,
    formulaResult: "none" as const,
  };
  const currencyText = mappedCurrency === undefined
    ? defaults.cost!.currency
    : mappedCellText(mappedCurrency, "costCurrency", errors, formulaFields).trim();
  const priceYearText = mappedPriceYear === undefined
    ? (defaults.cost!.priceYear === null ? "" : String(defaults.cost!.priceYear))
    : mappedCellText(mappedPriceYear, "costPriceYear", errors, formulaFields).trim();

  if (value.formula) {
    formulaFields.push("estimatedCost");
    if (value.formulaResult === "missing") {
      errors.push(workbookIssue("formula_missing_value", "estimatedCost uses a formula with no cached result."));
      return null;
    }
    if (value.formulaResult === "error") {
      errors.push(workbookIssue("formula_error", "estimatedCost uses a formula whose cached result is an error."));
      return null;
    }
  }
  if (value.type === "blank" || value.value === null || value.value === "") {
    if ((mappedCurrency !== undefined && currencyText) || (mappedPriceYear !== undefined && priceYearText)) {
      errors.push(workbookIssue("invalid_cost", "Cost currency and price year cannot be supplied without an estimated cost."));
    }
    return null;
  }
  const raw = value.type === "number"
    ? decimalFromNumber(Number(value.value))
    : value.type === "text"
      ? String(value.value ?? "")
      : null;
  const scaled = raw === null ? null : scaledDecimal(raw, defaults.cost!.scale);
  if (scaled === null) {
    errors.push(
      workbookIssue(
        value.type === "boolean" || value.type === "date" || value.type === "error" || value.type === "unsupported"
          ? "unsupported_cell"
          : "invalid_cost",
        "Cost must be a positive numeric cell or strict decimal text without marks, separators, signs, or exponent notation."
      )
    );
    return null;
  }
  if (!/^[A-Z]{3}$/.test(currencyText)) {
    errors.push(workbookIssue("invalid_cost", "Cost currency must be an explicit three-letter uppercase code."));
    return null;
  }
  if (priceYearText === "") return { amount: scaled, currency: currencyText, priceYear: null };
  if (!/^\d{4}$/.test(priceYearText)) {
    errors.push(workbookIssue("invalid_cost", "Cost price year must be one whole year from 1800 through 3000."));
    return null;
  }
  const priceYear = Number(priceYearText);
  if (!Number.isInteger(priceYear) || priceYear < 1800 || priceYear > 3000) {
    errors.push(workbookIssue("invalid_cost", "Cost price year must be one whole year from 1800 through 3000."));
    return null;
  }
  return {
    amount: scaled,
    currency: currencyText,
    priceYear,
  };
}

function canonicalCell(cell: PortfolioCell): Record<string, unknown> {
  return {
    type: cell.type,
    value: cell.value,
    formula: cell.formula,
    formulaHash: cell.formulaHash,
    formulaResult: cell.formulaResult,
  };
}

/** Review one CSV or an ordered, multi-sheet workbook batch from the stored bytes. */
export async function reviewPortfolioWorkbook(input: {
  bytes: Uint8Array;
  filename: string | null;
  contentType: string | null;
  configurations: PortfolioSheetConfiguration[];
  rowReviews?: PortfolioWorkbookRowReview[];
  existingProjects?: ExistingProjectName[];
  previouslyCreatedRows?: PreviouslyCreatedWorkbookRow[];
}): Promise<PortfolioWorkbookReview> {
  const inspection = await inspectPortfolioWorkbook(input);
  if (input.configurations.length === 0) {
    throw new PortfolioImportError("invalid_mapping", "Select at least one worksheet before previewing rows.");
  }
  const indexes = input.configurations.map((configuration) => configuration.worksheetIndex);
  if (
    new Set(indexes).size !== indexes.length ||
    indexes.some((index, position) => position > 0 && index <= indexes[position - 1])
  ) {
    throw new PortfolioImportError(
      "invalid_mapping",
      "Selected worksheets must be distinct and ordered by their physical worksheet index."
    );
  }

  const reviewKeys = (input.rowReviews ?? []).map((review) => `${review.worksheetIndex}:${review.rowNumber}`);
  if (new Set(reviewKeys).size !== reviewKeys.length) {
    throw new PortfolioImportError("invalid_mapping", "Each row decision must identify one distinct worksheet row.");
  }
  const reviews = new Map((input.rowReviews ?? []).map((review) => [`${review.worksheetIndex}:${review.rowNumber}`, review]));
  const existingByName = new Map<string, string[]>();
  for (const project of input.existingProjects ?? []) {
    const normalized = normalizePortfolioProjectName(project.name);
    existingByName.set(normalized, [...(existingByName.get(normalized) ?? []), project.id]);
  }
  const priorByIdentity = new Map(
    (input.previouslyCreatedRows ?? []).map((row) => [
      `${row.sourceHash}:${row.worksheetIndex}:${row.rowNumber}:${row.rowFingerprint}`,
      row.projectId,
    ])
  );

  const rows: PortfolioWorkbookImportRow[] = [];
  const sheets: PortfolioSheetReview[] = [];
  for (const configuration of input.configurations) {
    const manifest = inspection.worksheets.find((sheet) => sheet.index === configuration.worksheetIndex);
    if (!manifest) throw new PortfolioImportError("invalid_mapping", "A selected worksheet is not present in the stored source.");
    const remainingRowBudget = PORTFOLIO_IMPORT_MAX_ROWS - rows.length;
    if (remainingRowBudget < 1) {
      throw new PortfolioImportError("row_limit", "Selected worksheets contain more than 2,000 project rows.");
    }
    const physicalRowsAfterHeader = Math.max(0, manifest.rowCount - configuration.headerRow);
    if (physicalRowsAfterHeader > remainingRowBudget) {
      throw new PortfolioImportError(
        "row_limit",
        "Selected worksheets extend beyond the 2,000-row review boundary. Split the source into smaller reviewed batches."
      );
    }
    const parsed = await readPortfolioSheet({
      ...input,
      worksheetIndex: configuration.worksheetIndex,
      headerRow: configuration.headerRow,
      rowLimit: Math.max(1, physicalRowsAfterHeader),
    });
    if (parsed.headers.length === 0 || parsed.headers.every((header) => !header)) {
      throw new PortfolioImportError("missing_header", `Worksheet ${configuration.worksheetIndex + 1} has no named header cells on the chosen row.`);
    }
    validateMapping(configuration.mapping, parsed.headers.length);
    validateDefaults(configuration.mapping, configuration.defaults);
    sheets.push({
      worksheetIndex: parsed.worksheetIndex,
      worksheetName: parsed.worksheetName,
      headerRow: parsed.headerRow,
      headers: parsed.headers,
      duplicateHeaders: findDuplicateHeaders(parsed.headers),
    });

    for (const sourceRow of parsed.rows) {
      const key = `${configuration.worksheetIndex}:${sourceRow.rowNumber}`;
      const rowReview = reviews.get(key);
      const errors: PortfolioWorkbookIssue[] = [];
      const warnings: PortfolioWorkbookIssue[] = [];
      const formulaFields: string[] = [];
      const get = (field: MappedField) => {
        const index = configuration.mapping[field];
        return index === undefined ? undefined : sourceRow.cells[index];
      };
      const name = mappedCellText(get("name"), "name", errors, formulaFields).trim();
      const sourceIdRaw = configuration.mapping.sourceId === undefined
        ? ""
        : mappedCellText(get("sourceId"), "sourceId", errors, formulaFields);
      const descriptionRaw = configuration.mapping.description === undefined
        ? ""
        : mappedCellText(get("description"), "description", errors, formulaFields);
      const locationRaw = configuration.mapping.sourceLocation === undefined
        ? ""
        : mappedCellText(get("sourceLocation"), "sourceLocation", errors, formulaFields);
      const sourceId = trimOrNull(sourceIdRaw);
      const description = trimOrNull(descriptionRaw);
      const sourceLocationText = trimOrNull(locationRaw);
      const mappedPlanType = configuration.mapping.planType === undefined
        ? configuration.defaults.planType
        : mappedCellText(get("planType"), "planType", errors, formulaFields);
      const mappedStatus = configuration.mapping.status === undefined
        ? configuration.defaults.status
        : mappedCellText(get("status"), "status", errors, formulaFields);
      const mappedDeliveryPhase = configuration.mapping.deliveryPhase === undefined
        ? configuration.defaults.deliveryPhase
        : mappedCellText(get("deliveryPhase"), "deliveryPhase", errors, formulaFields);
      const planType = rowReview?.planType?.trim() || mappedPlanType.trim();
      const status = (rowReview?.status ?? mappedStatus.trim()) as ProjectStatus;
      const deliveryPhase = (rowReview?.deliveryPhase ?? mappedDeliveryPhase.trim()) as ProjectDeliveryPhase;
      if (!projectNameSchema.safeParse(name).success) errors.push(workbookIssue("invalid_name", "Project name is required and may contain at most 120 characters."));
      if (description !== null && !projectSummarySchema.safeParse(description).success) errors.push(workbookIssue("description_too_long", "Description may contain at most 2,000 characters."));
      if (sourceId !== null && sourceId.length > 200) errors.push(workbookIssue("source_id_too_long", "Source ID may contain at most 200 characters."));
      if (sourceLocationText !== null && sourceLocationText.length > 2_000) errors.push(workbookIssue("location_too_long", "Source-location text may contain at most 2,000 characters."));
      if (!projectPlanTypeSchema.safeParse(planType).success) errors.push(workbookIssue("invalid_plan_type", "Project type is required and may contain at most 80 characters."));
      if (!projectStatusSchema.safeParse(status).success) errors.push(workbookIssue("invalid_status", "Choose a supported OpenPlan project status."));
      if (!projectDeliveryPhaseSchema.safeParse(deliveryPhase).success) errors.push(workbookIssue("invalid_delivery_phase", "Choose a supported OpenPlan delivery phase."));
      const estimatedCost = configuration.mapping.estimatedCost === undefined
        ? null
        : mappedCost(
            get("estimatedCost"),
            configuration.defaults,
            errors,
            formulaFields,
            get("costCurrency"),
            get("costPriceYear")
          );
      if (estimatedCost?.priceYear === null) {
        warnings.push(workbookIssue("unknown_price_year", "Cost price year is unknown; do not treat this estimate as current-year prices."));
      }
      if (formulaFields.length > 0 && errors.every((entry) => !entry.code.startsWith("formula_"))) {
        warnings.push(workbookIssue("formula_value", `Mapped formula fields use cached workbook values: ${formulaFields.join(", ")}.`));
      }
      const matchingProjectIds = name
        ? [...(existingByName.get(normalizePortfolioProjectName(name)) ?? [])].sort()
        : [];
      if (matchingProjectIds.length > 0) warnings.push(workbookIssue("name_match", "A project with this normalized name already exists. This import will never update it."));
      const fingerprint = sha256(JSON.stringify(sourceRow.cells.map(canonicalCell)));
      const previouslyCreatedProjectId = priorByIdentity.get(
        `${inspection.sourceHash}:${configuration.worksheetIndex}:${sourceRow.rowNumber}:${fingerprint}`
      ) ?? null;
      const confirmNameMatch = Boolean(rowReview?.confirmNameMatch);
      const confirmFormula = Boolean(rowReview?.confirmFormula);
      let decision = rowReview?.decision ?? "skip";
      if (previouslyCreatedProjectId) decision = "skip";
      rows.push({
        worksheetIndex: configuration.worksheetIndex,
        worksheetName: parsed.worksheetName,
        headerRow: configuration.headerRow,
        rowNumber: sourceRow.rowNumber,
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
        confirmFormula,
        formulaFields: [...new Set(formulaFields)].sort(),
        state: previouslyCreatedProjectId ? "created_before" : errors.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "clean",
        canCreate: false,
        errors,
        warnings,
        matchingProjectIds,
        matchingBatchRows: [],
        previouslyCreatedProjectId,
      });
    }
  }

  for (const reviewKey of reviewKeys) {
    if (!rows.some((row) => `${row.worksheetIndex}:${row.rowNumber}` === reviewKey)) {
      throw new PortfolioImportError("invalid_mapping", "A row decision does not identify a nonblank row in the selected worksheets.");
    }
  }

  const sourceIdGroups = new Map<string, PortfolioWorkbookImportRow[]>();
  const nameGroups = new Map<string, PortfolioWorkbookImportRow[]>();
  for (const row of rows) {
    if (row.sourceId) {
      const normalized = normalizeSourceId(row.sourceId);
      sourceIdGroups.set(normalized, [...(sourceIdGroups.get(normalized) ?? []), row]);
    }
    if (row.name) {
      const normalized = normalizePortfolioProjectName(row.name);
      nameGroups.set(normalized, [...(nameGroups.get(normalized) ?? []), row]);
    }
  }
  for (const group of sourceIdGroups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.errors.push(workbookIssue("duplicate_source_id", "This source ID appears more than once in the selected worksheet batch. The rows may be phases or funding lines, so none will be created."));
      row.decision = "skip";
    }
  }
  for (const group of nameGroups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.matchingBatchRows = group
        .filter((candidate) => candidate !== row)
        .map((candidate) => ({ worksheetIndex: candidate.worksheetIndex, rowNumber: candidate.rowNumber }));
      row.warnings.push(workbookIssue("batch_name_match", "Another selected source row has this normalized project name. Creating both requires individual confirmation."));
    }
  }
  for (const row of rows) {
    const needsNameConfirmation = row.matchingProjectIds.length > 0 || row.matchingBatchRows.length > 0;
    if (row.decision === "create" && needsNameConfirmation && !row.confirmNameMatch) {
      row.warnings.push(workbookIssue("name_match_confirmation_required", "Confirm this row individually before creating another project with the same normalized name."));
    }
    if (row.decision === "create" && row.formulaFields.length > 0 && !row.confirmFormula) {
      row.warnings.push(workbookIssue("formula_confirmation_required", "Confirm this row individually because mapped fields use cached formula values."));
    }
    row.state = row.previouslyCreatedProjectId
      ? "created_before"
      : row.errors.length > 0
        ? "blocked"
        : row.warnings.length > 0
          ? "warning"
          : "clean";
    row.canCreate =
      !row.previouslyCreatedProjectId &&
      row.errors.length === 0 &&
      (!needsNameConfirmation || row.confirmNameMatch) &&
      (row.formulaFields.length === 0 || row.confirmFormula);
    if (!row.canCreate && row.state === "blocked") row.decision = "skip";
  }

  const previewShape = {
    version: PORTFOLIO_WORKBOOK_IMPORT_VERSION,
    format: inspection.format,
    sourceHash: inspection.sourceHash,
    configurations: input.configurations,
    rows: rows.map((row) => ({
      worksheetIndex: row.worksheetIndex,
      worksheetName: row.worksheetName,
      headerRow: row.headerRow,
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
      confirmFormula: row.confirmFormula,
      formulaFields: row.formulaFields,
      state: row.state,
      canCreate: row.canCreate,
      errorCodes: row.errors.map((entry) => entry.code),
      warningCodes: row.warnings.map((entry) => entry.code),
      matchingProjectIds: row.matchingProjectIds,
      matchingBatchRows: row.matchingBatchRows,
      previouslyCreatedProjectId: row.previouslyCreatedProjectId,
    })),
  };
  return {
    version: PORTFOLIO_WORKBOOK_IMPORT_VERSION,
    format: inspection.format,
    sourceHash: inspection.sourceHash,
    previewHash: sha256(JSON.stringify(previewShape)),
    byteLength: inspection.byteLength,
    worksheets: inspection.worksheets,
    sheets,
    configurations: input.configurations,
    rows,
    formulaWarnings: rows
      .filter((row) => row.formulaFields.length > 0)
      .map((row) => ({ worksheetIndex: row.worksheetIndex, rowNumber: row.rowNumber, fields: row.formulaFields })),
    counts: {
      rows: rows.length,
      selectedForCreate: rows.filter((row) => row.decision === "create" && row.canCreate).length,
      skipped: rows.filter((row) => row.decision === "skip" && row.state !== "created_before").length,
      conflicted: rows.filter((row) => row.errors.some((entry) => entry.code === "duplicate_source_id")).length,
      invalid: rows.filter((row) => row.errors.length > 0 && !row.errors.some((entry) => entry.code === "duplicate_source_id")).length,
      previouslyCreated: rows.filter((row) => row.state === "created_before").length,
    },
  };
}
