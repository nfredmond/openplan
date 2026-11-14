/**
 * The engagement review PDF's words for stored values, and the one place its
 * record identifiers print (KI-2026-11-14-390).
 *
 * A resident reading the public copy, or a council member reading either copy,
 * meets no record id, raw stored time, JSON or stored code in the body. Each
 * entry is known by its number ("Contribution 3", "Decision action 2"), and
 * every id and hash the body used to print is listed once, against that
 * number, in the closing "Record identifiers" appendix. The workbook, the
 * snapshot JSON and the CSV files keep the exact stored values.
 */
import { formatEvidenceTimestamp } from "@/lib/grants/evidence-timestamp";
import { SURVEY_QUESTION_TYPES, type SurveyQuestionType } from "./survey";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A stored time as the review PDF prints it: "Nov 14, 2026, 16:08 UTC". */
export function reviewTime(value: unknown): string {
  return formatEvidenceTimestamp(typeof value === "string" ? value : null);
}

/** A stored code the PDF does not know prints in words, with the stored value kept for the reader to check. */
const unrecognized = (kind: string, value: unknown) => `Unrecognized ${kind} (${String(value ?? "")})`;

const WORDS: Record<string, Record<string, string>> = {
  responseStatus: { draft: "Draft", published: "Published" },
  decisionStatus: { proposed: "Proposed", approved: "Approved", rejected: "Rejected" },
  sentiment: { not_assessed: "Not assessed", positive: "Positive", mixed: "Mixed", neutral: "Neutral", negative: "Negative" },
  availability: { available: "Available", unavailable: "Unavailable", unknown: "Unknown" },
  operation: { link: "Link", refresh: "Refresh", withdraw: "Withdrawal" },
  translationEntity: { campaign: "Campaign", category: "Category", survey_question: "Survey question", survey_question_option: "Survey question option", close_loop_entry: "Staff response" },
  translationSource: { operator: "Entered by staff", machine: "Machine translation" },
};

/** Every stored code the review PDF prints in words. The sweep test refuses any of them in the body. */
export const REVIEW_PDF_STORED_CODES: readonly string[] = [...new Set([
  ...Object.values(WORDS).flatMap((codes) => Object.keys(codes)),
  "pending", "flagged", "approved", "rejected",
  ...Object.keys(SURVEY_QUESTION_TYPES),
])];

export function reviewWord(kind: keyof typeof WORDS, value: unknown, fallbackKind: string): string {
  return typeof value === "string" && Object.hasOwn(WORDS[kind], value) ? WORDS[kind][value] : unrecognized(fallbackKind, value);
}

export function questionTypeWord(value: unknown): string {
  return typeof value === "string" && Object.hasOwn(SURVEY_QUESTION_TYPES, value)
    ? SURVEY_QUESTION_TYPES[value as SurveyQuestionType].label
    : unrecognized("question type", value);
}

/** A translated field name in words: "help_text" reads "Help text". */
export function fieldWord(value: unknown): string {
  const words = String(value ?? "").replaceAll("_", " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Field not recorded";
}

/** A locale code as a language name ("es" reads "Spanish (es)"); the code stays beside it because two variants can share a name. */
export function localeWord(value: unknown): string {
  const code = String(value ?? "").trim();
  if (!code) return "Language not recorded";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

/** A question's options in words, without the JSON they are stored as. */
export function optionsWords(options: unknown): string {
  if (!Array.isArray(options) || options.length === 0) return "none";
  const labels = options.map((option) => typeof option === "string" ? option
    : option && typeof option === "object" && typeof (option as { label?: unknown }).label === "string" ? (option as { label: string }).label
    : null);
  return labels.every((label) => label !== null) ? labels.join("; ") : `${options.length} options, kept in the workbook and snapshot`;
}

/** "contribution 2", "contributions 1 and 3", "contributions 1, 2 and 4". */
export function numberedList(noun: string, plural: string, numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `${noun} ${sorted[0]}`;
  return `${plural} ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/**
 * Numbers for staff members who appear in the decision history, in the order a
 * reader meets them. The body says "staff member 2"; the appendix gives the id.
 */
export function staffMemberNumbers() {
  const numbers = new Map<string, number>();
  return (actorId: unknown): string => {
    const key = String(actorId ?? "");
    if (!key) return "an unrecorded staff member";
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    return `staff member ${numbers.get(key)}`;
  };
}

/**
 * The closing appendix. Each entry pairs the name a reader met in the body
 * with the exact stored identifier, grouped in the order the body used them.
 * An entry is listed once even when the body names it twice.
 */
export function recordIdentifiers() {
  const groups = new Map<string, Array<[string, string]>>();
  const seen = new Set<string>();
  return {
    add(group: string, label: string, value: unknown) {
      const text = String(value ?? "").trim();
      if (!text) return;
      const key = `${group}\u0000${label}\u0000${text}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push([label, text]);
    },
    html(): string {
      const sections = [...groups].map(([group, rows]) => `<section class="identifier-group"><h3>${escapeHtml(group)}</h3>${rows.map(([label, value]) => `<p class="identifier">${escapeHtml(label)}: <code>${escapeHtml(value)}</code></p>`).join("")}</section>`).join("");
      return `<section class="identifiers"><h2 id="record-identifiers">Record identifiers</h2><p>These identifiers match this report to its workbook and portable snapshot. Each one is listed under the number or name this report gives it. The snapshot's SHA-256 hash checks that the snapshot file is the one this report was printed from.</p>${sections}</section>`;
    },
  };
}
export type RecordIdentifiers = ReturnType<typeof recordIdentifiers>;
