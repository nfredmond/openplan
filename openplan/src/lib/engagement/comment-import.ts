import { parse } from "csv-parse/sync";
import { ENGAGEMENT_ITEM_SOURCE_TYPES, type EngagementItemSourceType } from "@/lib/engagement/catalog";

/**
 * COMMENT THAT DID NOT ARRIVE THROUGH THE PORTAL.
 *
 * A consultation is not the portal. It is the open house with a flip chart, the
 * comment cards at the library, the emails to the project inbox, the transcript
 * of a council meeting — and then the portal. `engagement_items.source_type` has
 * carried `meeting` and `email` since the table was created, so the model always
 * expected those; nothing ever offered a way to enter them, and one comment at a
 * time through the single-item form is not a way for an agency holding 300 paper
 * cards.
 *
 * WHY THAT IS AN HONESTY PROBLEM AND NOT A CONVENIENCE ONE. Everything OpenPlan
 * says about a campaign — the synthesis, the representativeness screening, the
 * spatial hotspot test, the appendix — is computed over the items it holds. An
 * agency whose in-person turnout never made it into the system gets an analysis
 * of its own outreach that is confidently wrong, and wrong in a predictable
 * direction: portal submissions skew toward people with a device, a data plan,
 * and enough English or Spanish to use it. The people most likely to be missing
 * from that reading are the ones an equity screening exists to find.
 *
 * ═══ WHAT THIS MODULE REFUSES TO DO ═══
 *
 * IT DOES NOT SET STATUS. Every imported comment is `pending`, and the CSV has
 * no column that can change that. A file is not a review: it may be a
 * transcription with typos, somebody's name and phone number in the body, or a
 * duplicate of what is already there. Import that could write `approved` would
 * be a way to put unmoderated text on a public portal by uploading it, and the
 * moderation queue exists precisely so that cannot happen from any direction.
 *
 * IT DOES NOT DEDUPLICATE. Re-uploading the same file twice will produce two
 * copies, and that is deliberate: this repo already has near-duplicate detection
 * over the moderation queue (`loadNearDuplicates`), imported items land in that
 * queue like everything else, and a second duplicate detector here would be a
 * parallel answer to a question already answered — one that would eventually
 * disagree with the first.
 *
 * IT DOES NOT GUESS THE SOURCE. `source_type` is chosen by the operator for the
 * whole file, not read from a column and not defaulted to `internal`. `internal`
 * means staff-authored, and a resident's comment from an open house filed as
 * staff-authored is a misattribution that flows straight into the appendix. The
 * operator uploading the file is the only one who knows what is in it.
 *
 * IT DOES NOT PARTIALLY IMPORT. A file with an invalid row is refused whole. The
 * alternative — insert the good rows, report the rest — leaves an operator
 * holding a campaign in a state neither they nor the file describes, and the
 * natural fix (re-upload the corrected file) then duplicates everything that
 * worked the first time.
 *
 * ═══ GEOGRAPHY IS OPTIONAL AND ITS ABSENCE IS NOT HIDDEN ═══
 *
 * Most offline comment has no coordinate, and inventing one would corrupt the
 * hotspot test and the area-based representativeness screening. Rows without
 * latitude and longitude import without them; `summarizeEngagementItems` already
 * counts geolocated against non-geolocated separately, so the existing surfaces
 * report the gap rather than absorbing it.
 */

/** What an operator may say a whole file is. `public` is deliberately absent —
 *  see below. */
export const IMPORTABLE_SOURCE_TYPES = ENGAGEMENT_ITEM_SOURCE_TYPES.filter(
  (source): source is Exclude<EngagementItemSourceType, "public"> => source !== "public"
);

export type ImportableSourceType = (typeof IMPORTABLE_SOURCE_TYPES)[number];

/**
 * `public` CANNOT BE IMPORTED, and this is the sharpest rule in the module.
 *
 * `source_type = 'public'` means a member of the public submitted this through
 * the portal themselves: it carries a rate limit, a honeypot, a share token, and
 * a fingerprint. A row in a spreadsheet has none of that and cannot be given it
 * retroactively. Letting an upload claim `public` would let anyone with operator
 * access manufacture public support for a project and have every downstream
 * count — the synthesis, the vote tallies, the appendix — treat it as genuine
 * unsolicited participation. Offline comment is real and belongs in the record;
 * it is simply not the same fact, and the vocabulary already distinguishes them.
 */
export function isImportableSourceType(value: string): value is ImportableSourceType {
  return (IMPORTABLE_SOURCE_TYPES as readonly string[]).includes(value);
}

export type CommentImportRow = {
  /** 1-based, counting the header as row 1, so it matches what a spreadsheet shows. */
  rowNumber: number;
  title: string | null;
  body: string;
  submittedBy: string | null;
  categoryLabel: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type CommentImportRowError = {
  rowNumber: number;
  /** The column at fault, in the file's own spelling where there is one. */
  column: string | null;
  message: string;
};

export type CommentImportParse = {
  rows: CommentImportRow[];
  errors: CommentImportRowError[];
  /** Headers as they appeared, so a mapping mistake is visible to the operator. */
  headers: string[];
  /** Header names this parser recognised, and the field each became. */
  recognized: Record<string, keyof Omit<CommentImportRow, "rowNumber">>;
  /** Headers present in the file that nothing reads — reported, never silently dropped. */
  ignored: string[];
};

/**
 * The header spellings this accepts, per field.
 *
 * Deliberately generous about punctuation and case and STRICT about meaning: a
 * planner exports from Excel, SurveyMonkey, a county CRM or a hand-kept sheet,
 * and none of them agrees on capitalisation. What it will not do is guess — an
 * unrecognised header is reported as ignored rather than matched to whichever
 * field it looks closest to, because a body column silently read as a name is a
 * data-loss bug that looks like a successful import.
 */
const HEADER_ALIASES: Record<keyof Omit<CommentImportRow, "rowNumber">, readonly string[]> = {
  body: ["body", "comment", "comments", "response", "feedback", "text", "message"],
  title: ["title", "subject", "heading"],
  submittedBy: ["submittedby", "name", "author", "respondent", "from", "submitter"],
  categoryLabel: ["category", "topic", "theme"],
  latitude: ["latitude", "lat", "y"],
  longitude: ["longitude", "lon", "lng", "long", "x"],
};

/** Case, spaces, underscores and punctuation are noise in a header. */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_\-.]/g, "");
}

function fieldForHeader(header: string): keyof Omit<CommentImportRow, "rowNumber"> | null {
  const normalized = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field as keyof Omit<CommentImportRow, "rowNumber">;
  }
  return null;
}

/**
 * A coordinate, or a reason it is not one.
 *
 * Blank is a valid answer and means "no location", which is the ordinary case
 * for offline comment. A value that is present but unparseable is an ERROR
 * rather than a silent null: a column of coordinates where one cell says
 * "unknown" is a file the operator should look at, and quietly dropping that pin
 * would move a comment off the map without telling anyone.
 */
function parseCoordinate(
  raw: string | undefined,
  bound: number,
  column: string,
  rowNumber: number,
  errors: CommentImportRowError[]
): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors.push({ rowNumber, column, message: `“${value}” is not a number.` });
    return null;
  }
  if (parsed < -bound || parsed > bound) {
    errors.push({
      rowNumber,
      column,
      message: `${parsed} is outside the valid range (−${bound} to ${bound}).`,
    });
    return null;
  }
  return parsed;
}

export const COMMENT_IMPORT_MAX_ROWS = 2000;
const BODY_MAX = 8000;
const TITLE_MAX = 160;
const SUBMITTED_BY_MAX = 200;

/**
 * Parse a CSV of offline comment into rows and the reasons any of them cannot
 * be imported.
 *
 * Returns BOTH rows and errors rather than throwing, because the caller's job is
 * to show an operator every problem in their file at once. Fixing one error,
 * re-uploading, and being told about the next one is the loop this avoids.
 */
export function parseCommentImportCsv(csvText: string): CommentImportParse {
  const errors: CommentImportRowError[] = [];

  let records: Record<string, string>[];
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (cause) {
    return {
      rows: [],
      errors: [
        {
          rowNumber: 0,
          column: null,
          message: `This file could not be read as CSV: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
        },
      ],
      headers: [],
      recognized: {},
      ignored: [],
    };
  }

  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  const recognized: CommentImportParse["recognized"] = {};
  const ignored: string[] = [];
  for (const header of headers) {
    const field = fieldForHeader(header);
    if (field) recognized[header] = field;
    else ignored.push(header);
  }

  const headerFor = (field: keyof Omit<CommentImportRow, "rowNumber">): string | null =>
    Object.entries(recognized).find(([, mapped]) => mapped === field)?.[0] ?? null;

  const bodyHeader = headerFor("body");
  if (records.length > 0 && !bodyHeader) {
    errors.push({
      rowNumber: 0,
      column: null,
      message:
        "No comment column was found. One column must be named body, comment, response, feedback, text or message.",
    });
    return { rows: [], errors, headers, recognized, ignored };
  }

  if (records.length > COMMENT_IMPORT_MAX_ROWS) {
    errors.push({
      rowNumber: 0,
      column: null,
      message: `This file has ${records.length} rows; ${COMMENT_IMPORT_MAX_ROWS} is the most that can be imported at once. Split it and import each part.`,
    });
    return { rows: [], errors, headers, recognized, ignored };
  }

  const value = (record: Record<string, string>, field: keyof Omit<CommentImportRow, "rowNumber">) => {
    const header = headerFor(field);
    return header ? (record[header] ?? "").trim() : "";
  };

  const rows: CommentImportRow[] = [];
  records.forEach((record, index) => {
    // The header is row 1 in every spreadsheet a planner will have open beside
    // this, so the first record is row 2. An off-by-one here sends someone to
    // the wrong line of a 300-row file.
    const rowNumber = index + 2;
    const before = errors.length;

    const body = value(record, "body");
    if (!body) {
      errors.push({ rowNumber, column: bodyHeader, message: "The comment is empty." });
    } else if (body.length > BODY_MAX) {
      errors.push({
        rowNumber,
        column: bodyHeader,
        message: `The comment is ${body.length} characters; ${BODY_MAX} is the maximum.`,
      });
    }

    const title = value(record, "title");
    if (title.length > TITLE_MAX) {
      errors.push({
        rowNumber,
        column: headerFor("title"),
        message: `The title is ${title.length} characters; ${TITLE_MAX} is the maximum.`,
      });
    }

    const submittedBy = value(record, "submittedBy");
    if (submittedBy.length > SUBMITTED_BY_MAX) {
      errors.push({
        rowNumber,
        column: headerFor("submittedBy"),
        message: `The name is ${submittedBy.length} characters; ${SUBMITTED_BY_MAX} is the maximum.`,
      });
    }

    const beforeCoordinates = errors.length;
    const latitude = parseCoordinate(
      value(record, "latitude"),
      90,
      headerFor("latitude") ?? "latitude",
      rowNumber,
      errors
    );
    const longitude = parseCoordinate(
      value(record, "longitude"),
      180,
      headerFor("longitude") ?? "longitude",
      rowNumber,
      errors
    );

    /*
      HALF A COORDINATE IS NOT A LOCATION — importing the latitude alone stores a
      number that reads as data and points nowhere.

      Checked ONLY when neither cell already failed on its own. A cell reading
      "unknown" makes `parseCoordinate` return null, which would otherwise also
      trip this rule and produce a second message telling the operator a location
      needs both values — when they supplied both, and one was unreadable. Two
      errors for one bad cell, the second of them false, is worse than one.
    */
    if (errors.length === beforeCoordinates && (latitude === null) !== (longitude === null)) {
      errors.push({
        rowNumber,
        column: latitude === null ? headerFor("latitude") : headerFor("longitude"),
        message: "A location needs both a latitude and a longitude, or neither.",
      });
    }

    if (errors.length === before) {
      rows.push({
        rowNumber,
        title: title || null,
        body,
        submittedBy: submittedBy || null,
        categoryLabel: value(record, "categoryLabel") || null,
        latitude,
        longitude,
      });
    }
  });

  return { rows, errors, headers, recognized, ignored };
}

/**
 * What gets stored on each imported row so its origin survives.
 *
 * A comment in the appendix that says "resident said X" is a different claim
 * depending on whether X was typed into a public portal or transcribed from a
 * card at an open house, and six months later nobody remembers which. The batch
 * id ties a row back to the upload it came from, and the row number back to the
 * line of the file — so a transcription error found later can be traced to the
 * source document rather than argued about.
 */
export function commentImportProvenance(input: {
  batchId: string;
  fileName: string | null;
  rowNumber: number;
  importedAt: string;
}): Record<string, unknown> {
  return {
    import: {
      batchId: input.batchId,
      fileName: input.fileName,
      rowNumber: input.rowNumber,
      importedAt: input.importedAt,
    },
  };
}
