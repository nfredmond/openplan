import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import yauzl, { type Entry, type ZipFile } from "yauzl";

export const PORTFOLIO_SOURCE_FORMATS = ["csv", "xls", "xlsx", "ods"] as const;
export type PortfolioSourceFormat = (typeof PORTFOLIO_SOURCE_FORMATS)[number];

export const PORTFOLIO_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const PORTFOLIO_IMPORT_MAX_ROWS = 2_000;
export const PORTFOLIO_IMPORT_MAX_COLUMNS = 256;
export const PORTFOLIO_ARCHIVE_MAX_ENTRIES = 2_000;
export const PORTFOLIO_ARCHIVE_MAX_ENTRY_BYTES = 25 * 1024 * 1024;
export const PORTFOLIO_ARCHIVE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const PORTFOLIO_INSPECTION_SAMPLE_ROWS = 12;

export type PortfolioWorkbookErrorCode =
  | "archive_encrypted"
  | "archive_entry_limit"
  | "archive_entry_size"
  | "archive_malformed"
  | "archive_total_size"
  | "column_limit"
  | "empty_source"
  | "format_mismatch"
  | "invalid_utf8"
  | "macro_workbook"
  | "password_protected"
  | "row_limit"
  | "size_limit"
  | "unsupported_format"
  | "worksheet_missing";

export class PortfolioWorkbookError extends Error {
  constructor(public readonly code: PortfolioWorkbookErrorCode, message: string) {
    super(message);
    this.name = "PortfolioWorkbookError";
  }
}

export type PortfolioCell = {
  type: "blank" | "text" | "number" | "boolean" | "date" | "error" | "unsupported";
  value: string | number | boolean | null;
  display: string;
  formula: boolean;
  formulaHash: string | null;
  formulaResult: "none" | "cached" | "missing" | "error";
};

export type PortfolioWorksheetManifest = {
  index: number;
  name: string;
  visibility: "visible" | "hidden" | "very_hidden";
  rowCount: number;
  columnCount: number;
  sampleRows: Array<{ rowNumber: number; cells: PortfolioCell[] }>;
};

export type PortfolioWorkbookInspection = {
  format: PortfolioSourceFormat;
  sourceHash: string;
  byteLength: number;
  worksheets: PortfolioWorksheetManifest[];
};

export type PortfolioSheetRows = {
  worksheetIndex: number;
  worksheetName: string;
  headerRow: number;
  headers: string[];
  rows: Array<{ rowNumber: number; cells: PortfolioCell[] }>;
};

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extension(filename: string | null | undefined): string {
  return (filename ?? "").trim().toLowerCase().split(".").pop() ?? "";
}

const FORMAT_CONTENT_TYPES: Record<PortfolioSourceFormat, ReadonlySet<string>> = {
  csv: new Set(["text/csv", "application/csv", "text/plain"]),
  xls: new Set(["application/vnd.ms-excel"]),
  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  ods: new Set(["application/vnd.oasis.opendocument.spreadsheet"]),
};

function declaredFormat(filename: string | null, contentType: string | null): PortfolioSourceFormat {
  const ext = extension(filename);
  if (ext === "xlsm" || ext === "xlsb") {
    throw new PortfolioWorkbookError(
      "macro_workbook",
      "XLSM and XLSB files are not accepted. Save a macro-free XLSX, XLS, ODS, or CSV copy."
    );
  }
  if (!PORTFOLIO_SOURCE_FORMATS.includes(ext as PortfolioSourceFormat)) {
    throw new PortfolioWorkbookError(
      "unsupported_format",
      "Choose a CSV, XLS, XLSX, or ODS project list."
    );
  }
  const format = ext as PortfolioSourceFormat;
  const normalizedType = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (
    normalizedType &&
    normalizedType !== "application/octet-stream" &&
    !FORMAT_CONTENT_TYPES[format].has(normalizedType)
  ) {
    throw new PortfolioWorkbookError(
      "format_mismatch",
      "The filename extension and stored content type disagree. Upload the source without renaming its format."
    );
  }
  return format;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function openZip(bytes: Uint8Array): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // Entry sizes are checked while draining below. Keeping yauzl's eager
    // stored-entry check off lets us identify the encryption bit first and
    // return the truthful refusal instead of a generic size-mismatch error.
    yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: false }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("ZIP could not be opened"));
      else resolve(zip);
    });
  });
}

function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("ZIP entry could not be read"));
        return;
      }
      const chunks: Buffer[] = [];
      let actual = 0;
      stream.on("data", (chunk: Buffer) => {
        actual += chunk.length;
        if (actual > PORTFOLIO_ARCHIVE_MAX_ENTRY_BYTES) {
          stream.destroy(new Error("entry_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      stream.once("error", reject);
      stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

/** Validate and fully drain an XLSX/ODS ZIP before any workbook parser sees it. */
export async function validatePortfolioArchive(bytes: Uint8Array): Promise<Map<string, Buffer>> {
  let zip: ZipFile;
  try {
    zip = await openZip(bytes);
  } catch {
    throw new PortfolioWorkbookError("archive_malformed", "The workbook archive is malformed or password protected.");
  }

  return await new Promise((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    let count = 0;
    let declaredTotal = 0;
    let finished = false;
    const fail = (error: PortfolioWorkbookError) => {
      if (finished) return;
      finished = true;
      zip.close();
      reject(error);
    };

    zip.once("error", () => fail(new PortfolioWorkbookError("archive_malformed", "The workbook archive is malformed.")));
    zip.on("entry", async (entry) => {
      if (finished) return;
      count += 1;
      if (count > PORTFOLIO_ARCHIVE_MAX_ENTRIES) {
        fail(new PortfolioWorkbookError("archive_entry_limit", "The workbook archive contains more than 2,000 entries."));
        return;
      }
      if ((entry.generalPurposeBitFlag & 1) !== 0) {
        fail(new PortfolioWorkbookError("archive_encrypted", "Encrypted workbook archives are not supported."));
        return;
      }
      if (entry.uncompressedSize > PORTFOLIO_ARCHIVE_MAX_ENTRY_BYTES) {
        fail(new PortfolioWorkbookError("archive_entry_size", "A workbook archive entry exceeds the 25 MiB limit."));
        return;
      }
      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > PORTFOLIO_ARCHIVE_MAX_TOTAL_BYTES) {
        fail(new PortfolioWorkbookError("archive_total_size", "The workbook expands beyond the 50 MiB total limit."));
        return;
      }
      try {
        const data = /\/$/.test(entry.fileName) ? Buffer.alloc(0) : await readEntry(zip, entry);
        if (data.length !== entry.uncompressedSize) {
          fail(new PortfolioWorkbookError("archive_malformed", "A workbook archive entry has an invalid size."));
          return;
        }
        entries.set(entry.fileName, data);
        zip.readEntry();
      } catch (error) {
        fail(
          error instanceof Error && error.message === "entry_too_large"
            ? new PortfolioWorkbookError("archive_entry_size", "A workbook archive entry exceeds the 25 MiB limit.")
            : new PortfolioWorkbookError("archive_malformed", "The workbook archive could not be read safely.")
        );
      }
    });
    zip.once("end", () => {
      if (finished) return;
      finished = true;
      resolve(entries);
    });
    zip.readEntry();
  });
}

function assertArchiveIdentity(format: "xlsx" | "ods", entries: Map<string, Buffer>): void {
  const names = new Set(entries.keys());
  const hasMacros = [...names].some((name) => /(^|\/)vbaProject\.bin$/i.test(name));
  const contentTypes = entries.get("[Content_Types].xml")?.toString("utf8") ?? "";
  const macroWorkbookType = /PartName="\/xl\/workbook\.(?:xml|bin)"[^>]*ContentType="[^"]*(?:macroEnabled|sheet\.binary)/i.test(contentTypes);
  if (hasMacros || macroWorkbookType || names.has("xl/workbook.bin")) {
    throw new PortfolioWorkbookError("macro_workbook", "Macro-enabled and binary Excel workbooks are not supported.");
  }
  const isXlsx = names.has("xl/workbook.xml") && names.has("[Content_Types].xml");
  const isOds = entries.get("mimetype")?.toString("utf8").trim() === "application/vnd.oasis.opendocument.spreadsheet";
  if ((format === "xlsx" && !isXlsx) || (format === "ods" && !isOds)) {
    throw new PortfolioWorkbookError(
      "format_mismatch",
      "The workbook bytes do not match the filename extension and stored content type."
    );
  }
}

function decodeCsv(bytes: Uint8Array): string[][] {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PortfolioWorkbookError("invalid_utf8", "CSV sources must use UTF-8 text encoding.");
  }
  try {
    return parseCsv(decoded, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
      max_record_size: PORTFOLIO_IMPORT_MAX_BYTES,
    }) as string[][];
  } catch {
    throw new PortfolioWorkbookError("format_mismatch", "The stored bytes could not be read as CSV.");
  }
}

function csvCell(value: string | undefined): PortfolioCell {
  const text = value ?? "";
  return {
    type: text === "" ? "blank" : "text",
    value: text || null,
    display: text,
    formula: false,
    formulaHash: null,
    formulaResult: "none",
  };
}

function sheetCell(cell: XLSX.CellObject | undefined): PortfolioCell {
  if (!cell) return csvCell("");
  const formula = typeof cell.f === "string" && cell.f.length > 0;
  const formulaHash = formula ? sha256(cell.f as string) : null;
  const isDate = cell.t === "d" || (cell.t === "n" && typeof cell.z === "string" && XLSX.SSF.is_date(cell.z));
  const type: PortfolioCell["type"] =
    cell.t === "e" ? "error" :
      isDate ? "date" :
        cell.t === "s" || (cell.t as string) === "str" ? "text" :
          cell.t === "n" ? "number" :
            cell.t === "b" ? "boolean" :
              cell.t === "z" ? "blank" : "unsupported";
  const hasValue = cell.v !== undefined && cell.v !== null && cell.v !== "";
  return {
    type,
    value: hasValue && (typeof cell.v === "string" || typeof cell.v === "number" || typeof cell.v === "boolean")
      ? cell.v
      : null,
    display: type === "error" ? "Workbook error" : String(cell.w ?? cell.v ?? ""),
    formula,
    formulaHash,
    formulaResult: !formula ? "none" : type === "error" ? "error" : hasValue ? "cached" : "missing",
  };
}

function dimensions(ref: string | undefined): { rowCount: number; columnCount: number } {
  if (!ref) return { rowCount: 0, columnCount: 0 };
  const range = XLSX.utils.decode_range(ref);
  return { rowCount: range.e.r + 1, columnCount: range.e.c + 1 };
}

function worksheetRows(
  sheet: XLSX.WorkSheet,
  fromRow: number,
  throughRow: number,
  columnCount: number
): Array<{ rowNumber: number; cells: PortfolioCell[] }> {
  const rows: Array<{ rowNumber: number; cells: PortfolioCell[] }> = [];
  for (let rowNumber = fromRow; rowNumber <= throughRow; rowNumber += 1) {
    const cells = Array.from({ length: columnCount }, (_, columnIndex) =>
      sheetCell(sheet[XLSX.utils.encode_cell({ r: rowNumber - 1, c: columnIndex })])
    );
    rows.push({ rowNumber, cells });
  }
  return rows;
}

async function validateAndDetect(input: {
  bytes: Uint8Array;
  filename: string | null;
  contentType: string | null;
}): Promise<PortfolioSourceFormat> {
  if (input.bytes.byteLength === 0) throw new PortfolioWorkbookError("empty_source", "The stored project list is empty.");
  if (input.bytes.byteLength > PORTFOLIO_IMPORT_MAX_BYTES) {
    throw new PortfolioWorkbookError("size_limit", "Project-list sources may be at most 10 MiB.");
  }
  const format = declaredFormat(input.filename, input.contentType);
  if (format === "csv") {
    if (hasPrefix(input.bytes, [0x50, 0x4b]) || hasPrefix(input.bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
      throw new PortfolioWorkbookError("format_mismatch", "The .csv file contains workbook bytes.");
    }
    decodeCsv(input.bytes);
    return format;
  }
  if (format === "xls") {
    if (!hasPrefix(input.bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
      throw new PortfolioWorkbookError("format_mismatch", "The .xls file does not contain an Excel binary workbook.");
    }
    return format;
  }
  if (!hasPrefix(input.bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw new PortfolioWorkbookError("format_mismatch", "The workbook does not contain the expected compressed archive.");
  }
  const entries = await validatePortfolioArchive(input.bytes);
  assertArchiveIdentity(format, entries);
  return format;
}

function readWorkbook(bytes: Uint8Array, options: XLSX.ParsingOptions): XLSX.WorkBook {
  try {
    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      sheetStubs: true,
      bookVBA: true,
      ...options,
    });
    if (workbook.vbaraw) {
      throw new PortfolioWorkbookError("macro_workbook", "Workbooks containing executable macros are not supported.");
    }
    return workbook;
  } catch (error) {
    if (error instanceof PortfolioWorkbookError) throw error;
    const message = error instanceof Error ? error.message : "unknown workbook error";
    if (/password|encrypt/i.test(message)) {
      throw new PortfolioWorkbookError("password_protected", "Password-protected workbooks are not supported.");
    }
    throw new PortfolioWorkbookError("format_mismatch", "The stored workbook could not be parsed as its declared format.");
  }
}

function workbookSheetEntry(entries: Map<string, Buffer>, worksheetIndex: number): string | null {
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relationshipsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)];
  const attributes = sheets[worksheetIndex]?.[1] ?? "";
  const relationshipId = attributes.match(/\br:id="([^"]+)"/)?.[1];
  if (!relationshipId) return null;
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const relation = match[1];
    if (relation.match(/\bId="([^"]+)"/)?.[1] !== relationshipId) continue;
    const target = relation.match(/\bTarget="([^"]+)"/)?.[1];
    if (!target) return null;
    return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  return null;
}

/** SheetJS omits formula cells with no cached result; restore only their formula marker. */
async function restoreMissingXlsxFormulaCells(
  bytes: Uint8Array,
  worksheetIndex: number,
  sheet: XLSX.WorkSheet
): Promise<void> {
  const entries = await validatePortfolioArchive(bytes);
  const entry = workbookSheetEntry(entries, worksheetIndex);
  const xml = entry ? entries.get(entry)?.toString("utf8") : null;
  if (!xml) return;
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const address = match[1].match(/\br="([^"]+)"/)?.[1];
    const body = match[2];
    if (!address || !/<f(?:\s|>)/.test(body) || /<v(?:\s|>)/.test(body)) continue;
    const formula = body.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1] ?? `formula:${address}`;
    sheet[address] = { t: "z", f: formula } as XLSX.CellObject;
  }
}

export async function inspectPortfolioWorkbook(input: {
  bytes: Uint8Array;
  filename: string | null;
  contentType: string | null;
  worksheetIndex?: number;
}): Promise<PortfolioWorkbookInspection> {
  const format = await validateAndDetect(input);
  const sourceHash = sha256(input.bytes);
  if (format === "csv") {
    if (input.worksheetIndex !== undefined && input.worksheetIndex !== 0) {
      throw new PortfolioWorkbookError("worksheet_missing", "CSV has one worksheet at index 0.");
    }
    const records = decodeCsv(input.bytes);
    const columnCount = records.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    if (columnCount > PORTFOLIO_IMPORT_MAX_COLUMNS) {
      throw new PortfolioWorkbookError("column_limit", "A selected sheet may contain at most 256 columns.");
    }
    return {
      format,
      sourceHash,
      byteLength: input.bytes.byteLength,
      worksheets: [{
        index: 0,
        name: "CSV",
        visibility: "visible",
        rowCount: records.length,
        columnCount,
        sampleRows: records.slice(
          0,
          input.worksheetIndex === 0 ? records.length : PORTFOLIO_INSPECTION_SAMPLE_ROWS
        ).map((row, index) => ({
          rowNumber: index + 1,
          cells: Array.from({ length: columnCount }, (_, column) => csvCell(row[column])),
        })),
      }],
    };
  }

  const selected = input.worksheetIndex;
  const workbook = readWorkbook(input.bytes, {
    sheetRows: selected === undefined ? PORTFOLIO_INSPECTION_SAMPLE_ROWS : PORTFOLIO_IMPORT_MAX_ROWS,
    ...(selected === undefined ? {} : { sheets: [selected] }),
  });
  const sheets = workbook.Workbook?.Sheets ?? [];
  const names = workbook.SheetNames;
  if (selected !== undefined && (!Number.isInteger(selected) || selected < 0 || selected >= names.length)) {
    throw new PortfolioWorkbookError("worksheet_missing", "The selected worksheet does not exist in the stored workbook.");
  }
  const indexes = selected === undefined ? names.map((_, index) => index) : [selected];
  const worksheets = indexes.map((index) => {
    const name = names[index];
    const sheet = workbook.Sheets[name];
    const fullRef = (sheet?.["!fullref"] as string | undefined) ?? sheet?.["!ref"];
    const size = dimensions(fullRef);
    if (size.columnCount > PORTFOLIO_IMPORT_MAX_COLUMNS) {
      throw new PortfolioWorkbookError("column_limit", `Worksheet ${index + 1} contains more than 256 columns.`);
    }
    const hidden = sheets[index]?.Hidden ?? 0;
    if (selected !== undefined && size.rowCount > PORTFOLIO_IMPORT_MAX_ROWS) {
      throw new PortfolioWorkbookError(
        "row_limit",
        `Worksheet ${index + 1} contains more than ${PORTFOLIO_IMPORT_MAX_ROWS.toLocaleString("en-US")} rows.`
      );
    }
    const sampleThrough = selected === undefined
      ? Math.min(size.rowCount, PORTFOLIO_INSPECTION_SAMPLE_ROWS)
      : size.rowCount;
    return {
      index,
      name,
      visibility: hidden === 2 ? "very_hidden" as const : hidden === 1 ? "hidden" as const : "visible" as const,
      ...size,
      sampleRows: sheet ? worksheetRows(sheet, 1, sampleThrough, size.columnCount) : [],
    };
  });
  return { format, sourceHash, byteLength: input.bytes.byteLength, worksheets };
}

export async function readPortfolioSheet(input: {
  bytes: Uint8Array;
  filename: string | null;
  contentType: string | null;
  worksheetIndex: number;
  headerRow: number;
  rowLimit: number;
}): Promise<PortfolioSheetRows> {
  const format = await validateAndDetect(input);
  if (
    !Number.isInteger(input.headerRow) ||
    input.headerRow < 1 ||
    !Number.isInteger(input.rowLimit) ||
    input.rowLimit < 1
  ) {
    throw new PortfolioWorkbookError("worksheet_missing", "Choose a valid header row for every selected worksheet.");
  }
  if (format === "csv") {
    if (input.worksheetIndex !== 0) throw new PortfolioWorkbookError("worksheet_missing", "CSV has one worksheet at index 0.");
    const records = decodeCsv(input.bytes);
    const header = records[input.headerRow - 1];
    if (!header) throw new PortfolioWorkbookError("worksheet_missing", "The selected CSV header row does not exist.");
    const columnCount = header.length;
    if (columnCount > PORTFOLIO_IMPORT_MAX_COLUMNS) throw new PortfolioWorkbookError("column_limit", "A selected sheet may contain at most 256 columns.");
    const rows = records
      .slice(input.headerRow, input.headerRow + input.rowLimit)
      .map((record, offset) => ({
        rowNumber: input.headerRow + offset + 1,
        cells: Array.from({ length: Math.max(columnCount, record.length) }, (_, column) => csvCell(record[column])),
      }))
      .filter((row) => row.cells.some((cell) => cell.value !== null || cell.display !== ""));
    return {
      worksheetIndex: 0,
      worksheetName: "CSV",
      headerRow: input.headerRow,
      headers: header.map((value) => String(value ?? "").trim()),
      rows,
    };
  }

  const manifest = await inspectPortfolioWorkbook({ ...input, worksheetIndex: input.worksheetIndex });
  const selected = manifest.worksheets[0];
  if (!selected) throw new PortfolioWorkbookError("worksheet_missing", "The selected worksheet does not exist.");
  const sheetRows = Math.min(selected.rowCount, input.headerRow + input.rowLimit);
  const workbook = readWorkbook(input.bytes, { sheets: [input.worksheetIndex], sheetRows });
  const name = workbook.SheetNames[input.worksheetIndex];
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new PortfolioWorkbookError("worksheet_missing", "The selected worksheet could not be read.");
  if (format === "xlsx") await restoreMissingXlsxFormulaCells(input.bytes, input.worksheetIndex, sheet);
  if (selected.columnCount > PORTFOLIO_IMPORT_MAX_COLUMNS) throw new PortfolioWorkbookError("column_limit", "A selected sheet may contain at most 256 columns.");
  const all = worksheetRows(sheet, input.headerRow, sheetRows, selected.columnCount);
  const headerCells = all.shift()?.cells;
  if (!headerCells) throw new PortfolioWorkbookError("worksheet_missing", "The selected header row does not exist.");
  const rows = all.filter((row) => row.cells.some((cell) => cell.value !== null || cell.display !== ""));
  return {
    worksheetIndex: input.worksheetIndex,
    worksheetName: selected.name,
    headerRow: input.headerRow,
    headers: headerCells.map((cell) => cell.display.trim()),
    rows,
  };
}
