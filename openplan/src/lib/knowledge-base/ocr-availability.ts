/**
 * Whether THIS deployment can read a scanned document, and what a planner
 * looking at one is allowed to be told.
 *
 * WHY THIS EXISTS. `NoExtractableTextError`'s message — written into
 * `kb_documents.extraction_error` at upload time — ends "OCR is not enabled."
 * That was unconditionally true until the OCR worker existed. It is now a
 * DEPLOYMENT-DEPENDENT claim recorded as a fact, at a moment when the answer
 * could still change: a document uploaded before the operator wired up a worker
 * carries a sentence that stops being true the day they do.
 *
 * So the sentence a planner reads is composed HERE, at display time, from what
 * is true now — and the stored string stays what the parser found, because a
 * record of what happened is not a claim about what is possible. Nothing in
 * this module rewrites history; it just refuses to repeat a stale part of it.
 *
 * SERVER-ONLY. These env vars are unprefixed and must never reach a browser
 * bundle. Call `isKbOcrWorkerConfigured` from a server component or a route
 * handler and pass the boolean down; every describe* function below is pure and
 * takes that boolean as an argument, so both branches are testable without
 * touching the environment (the `describeAerialProcessingAvailability` shape).
 */

export const KB_OCR_WORKER_URL_ENV = "OPENPLAN_KB_OCR_WORKER_URL";
export const KB_OCR_WORKER_TOKEN_ENV = "OPENPLAN_KB_OCR_WORKER_TOKEN";
export const KB_OCR_CALLBACK_TOKEN_ENV = "OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN";
export const KB_OCR_CALLBACK_URL_ENV = "OPENPLAN_KB_OCR_CALLBACK_URL";
export const KB_OCR_LANGUAGES_ENV = "OPENPLAN_KB_OCR_LANGUAGES";
export const KB_OCR_CALLBACK_MAX_BYTES_ENV = "OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES";

/**
 * 4 MiB. Sized to fit UNDER the 4.5 MB request-body limit a Vercel Function
 * enforces, because that is the limit a hosted deployment meets without warning
 * and cannot raise. A self-hosted deployment has no such limit and its operator
 * can raise this to whatever their reverse proxy allows.
 *
 * WHAT THE CEILING COSTS, PLAINLY: roughly 4 MiB of recognised text is on the
 * order of a thousand pages of ordinary plan prose. Documents past it FAIL,
 * naming both numbers and this variable, rather than delivering part of
 * themselves — a document read only as far as a ceiling looks, from every
 * screen downstream, exactly like a document that ends there.
 */
export const DEFAULT_KB_OCR_CALLBACK_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The recognition languages this deployment asks for, in priority order.
 *
 * Tesseract language codes (ISO 639-2/T: eng, spa, vie, zho…), NOT locale tags.
 * Defaults to English and says so out loud rather than pretending to be
 * language-neutral: OpenPlan is not a United-States-only product, and a worker
 * silently assuming English returns text that looks like text and says nothing
 * for a plan adopted in Spanish. The worker REFUSES a language it has no
 * trained data for, naming the code and listing what it does have, so a
 * misconfigured value fails loudly on the first job instead of quietly on every
 * one.
 */
export const DEFAULT_KB_OCR_LANGUAGES = ["eng"] as const;

/** Tesseract's own code shape: letters and underscores (e.g. `chi_sim`). */
const LANGUAGE_CODE = /^[A-Za-z_]{2,32}$/;

export function resolveKbOcrLanguages(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = env[KB_OCR_LANGUAGES_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return [...DEFAULT_KB_OCR_LANGUAGES];
  const codes = raw
    .split(/[,+\s]+/)
    .map((code) => code.trim())
    .filter((code) => LANGUAGE_CODE.test(code))
    .slice(0, 8);
  // An unparseable value falls back to the default rather than dispatching an
  // empty language list the worker would refuse: the operator's mistake should
  // cost them a language, not the whole capability.
  return codes.length > 0 ? codes : [...DEFAULT_KB_OCR_LANGUAGES];
}

export function resolveKbOcrCallbackMaxBytes(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env[KB_OCR_CALLBACK_MAX_BYTES_ENV];
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_KB_OCR_CALLBACK_MAX_BYTES;
}

/**
 * True when both halves of the worker credential pair are present.
 *
 * Mirrors the request route's own test deliberately: a deployment that sets the
 * URL but not the token is NOT configured, and the route will still refuse for
 * it, so no surface may promise otherwise. Read as literal property accesses
 * rather than `process.env[name]` so the values survive Next's build-time env
 * handling.
 */
export function isKbOcrWorkerConfigured(): boolean {
  const url = process.env.OPENPLAN_KB_OCR_WORKER_URL?.trim();
  const token = process.env.OPENPLAN_KB_OCR_WORKER_TOKEN?.trim();
  return Boolean(url && token);
}

/** True when the callback bearer token is set — checked separately so the
 * callback route can answer 503 "not provisioned" rather than 401 "bad
 * credentials", which are different problems for an operator. */
export function isKbOcrCallbackConfigured(): boolean {
  return Boolean(process.env.OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN?.trim());
}

/**
 * THE DISCLOSURE a document read by OCR carries, wherever it is listed.
 *
 * Written for a planner and — per the provenance decision — for whoever reads
 * the plan afterwards. It says the two things a reader needs and nothing more:
 * the text came from a machine reading a scan, and a scan can misread a digit,
 * so the page and the exact wording travel with every quote.
 *
 * It is DELIBERATELY NOT A SCORE. "Read with OCR" is a fact about where the
 * text came from; "94% confident" would be the machine grading itself, and
 * every human who saw it would read it as a quality judgement with nothing
 * behind it. The honest answer to "how good is this transcription?" is that a
 * person has to read the quote against the page — which is exactly what this
 * sentence tells them to do.
 *
 * One home, because copy with two homes drifts.
 */
export const KB_OCR_PROVENANCE_NOTICE =
  "Read with OCR — quotes carry their page, and a scan can misread a digit, so check a figure " +
  "against the original before you rely on it.";

/**
 * The sentence to show beside a document whose extraction failed.
 *
 * Takes the stored `extraction_error` and REPLACES the deployment-dependent
 * half of it. The parser's finding ("no extractable text layer was found") is a
 * fact about the file and survives; "OCR is not enabled" is a fact about the
 * deployment at upload time and is re-derived from what is true now.
 *
 * A failure that is NOT the no-text-layer one (a corrupt PDF, say) is passed
 * through untouched: there is nothing stale in it, and paraphrasing a parser
 * error would lose the only detail that identifies the problem.
 */
export function describeUnreadableDocument(
  extractionError: string | null | undefined,
  workerConfigured: boolean
): string {
  const stored = (extractionError ?? "").trim();
  const isNoTextLayer = /no extractable text layer/i.test(stored);
  if (!isNoTextLayer) {
    return stored || "This document could not be read, and the reason was not recorded.";
  }
  return workerConfigured
    ? "No text layer was found — this looks like a scan. It can be read with OCR."
    : "No text layer was found — this looks like a scan. Reading it needs an OCR service, which " +
        "this deployment does not have, so it cannot be searched or quoted yet.";
}

/**
 * Whether OCR could apply to a document at all, independent of whether this
 * deployment can do it.
 *
 * Deliberately narrow for v1: a PDF whose extraction FAILED. Not a `stored`
 * image, not a spreadsheet, not a DOCX — each of those is its own capability
 * with its own honest boundary, and quietly widening this predicate is how a
 * "stored" drawer becomes a drawer everything falls into.
 */
export function documentCanBeOcred(document: {
  source_kind: string;
  status: string;
}): boolean {
  return document.source_kind === "uploaded_pdf" && document.status === "failed";
}
