/**
 * What an error report may carry, and the scrubbing every report passes
 * through, in the browser before it is sent and again on the server before it
 * is logged or forwarded. A report names the failing boundary, the error's
 * type, message, digest and stack, and the page path. It carries no user,
 * workspace, cookie, query string or request body.
 *
 * Share links and invitations put their secret in the path
 * (`/engage/<token>`), and error messages can quote URLs, keys and email
 * addresses, so those are replaced before anything leaves the page.
 */

export const CLIENT_ERROR_REPORT_PATH = "/api/client-errors";

const MAX_MESSAGE = 500;
const MAX_STACK = 4_000;
const MAX_NAME = 80;

export type ErrorReport = {
  boundary: string;
  name: string;
  message: string;
  digest: string | null;
  stack: string | null;
  path: string;
};

// Route segments whose next segment is a share or invitation secret.
const TOKEN_PARENTS = new Set(["engage", "embed", "plan", "measure", "invitations", "land-use-plans"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A long opaque segment with a digit in it: a token, not a page name.
const OPAQUE_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;

/** The path only, with share and invitation tokens replaced. */
export function scrubPath(raw: string): string {
  let pathname = raw;
  try {
    pathname = new URL(raw, "https://openplan.invalid").pathname;
  } catch {
    pathname = raw.split(/[?#]/)[0] ?? "";
  }
  const segments = pathname.split("/");
  const scrubbed = segments.map((segment, index) => {
    if (!segment) return segment;
    const parent = segments[index - 1] ?? "";
    if (TOKEN_PARENTS.has(parent)) return "[token]";
    if (!UUID.test(segment) && OPAQUE_SEGMENT.test(segment)) return "[token]";
    return segment;
  });
  return scrubbed.join("/").slice(0, 300) || "/";
}

/** Free text (a message or stack) with secrets, addresses and query strings replaced. */
export function scrubText(raw: string, max: number): string {
  return raw
    .replace(/\b(?:pk|sk|tk)\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[mapbox-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(/\b(?:sk-ant-|sk-|sk_live_|sk_test_|rk_live_|rk_test_)[A-Za-z0-9_-]{10,}/g, "[secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    // Query strings and fragments, wherever a URL or path appears. A stack
    // frame's trailing line and column survive.
    .replace(/((?:https?:\/\/|\/)[^\s?#"'<>()]*)[?#][^\s"'<>()]*?((?::\d+){0,2})(?=[\s"'<>()]|$)/g, "$1$2")
    // Path tokens inside quoted URLs and stack frames.
    .replace(/\/(engage|embed|plan|measure|invitations|land-use-plans)\/[A-Za-z0-9_-]+/g, "/$1/[token]")
    .slice(0, max);
}

/**
 * Builds a report from untrusted input, or returns null when the input is not
 * a report. The browser and the server both run every field through it.
 */
export function normalizeErrorReport(input: unknown): ErrorReport | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const boundary = typeof record.boundary === "string" ? record.boundary.trim() : "";
  if (!/^[a-z0-9-]{1,40}$/.test(boundary)) return null;
  const message = typeof record.message === "string" ? scrubText(record.message, MAX_MESSAGE) : "";
  const name =
    typeof record.name === "string" && /^[A-Za-z0-9_$.]{1,80}$/.test(record.name) ? record.name.slice(0, MAX_NAME) : "Error";
  const digest = typeof record.digest === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(record.digest) ? record.digest : null;
  const stack = typeof record.stack === "string" && record.stack.trim() ? scrubText(record.stack, MAX_STACK) : null;
  const path = typeof record.path === "string" ? scrubPath(record.path) : "/";
  return { boundary, name, message, digest, stack, path };
}
