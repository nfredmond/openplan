import { CLIENT_ERROR_REPORT_PATH, normalizeErrorReport } from "./error-report";

const reported = new WeakSet<object>();

/**
 * Sends one scrubbed report of an error an error page caught to this
 * deployment's own /api/client-errors, never to a third party. Each error
 * object is reported once, however often its boundary re-renders. Failure to
 * report is silent: the page has already failed and must not fail again.
 */
export function reportClientError(boundary: string, error: Error & { digest?: string }): void {
  if (typeof window === "undefined" || reported.has(error)) return;
  reported.add(error);
  const report = normalizeErrorReport({
    boundary,
    name: error.name,
    message: error.message,
    digest: error.digest,
    stack: error.stack,
    path: window.location.pathname,
  });
  if (!report) return;
  const body = JSON.stringify(report);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(CLIENT_ERROR_REPORT_PATH, new Blob([body], { type: "application/json" }))) return;
    }
    void fetch(CLIENT_ERROR_REPORT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting is best effort.
  }
}
