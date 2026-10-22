import { NextRequest, NextResponse, after } from "next/server";
import { readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { normalizeErrorReport } from "@/lib/observability/error-report";
import { forwardToSentry } from "@/lib/observability/sentry-envelope";

const MAX_BODY_BYTES = 8 * 1024;
const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 30;

// Per server instance, not per deployment: enough to keep one broken page from
// filling the logs or a free Sentry quota, not an abuse control.
let windowStartedAt = 0;
let reportsInWindow = 0;

function admit(now: number): boolean {
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now;
    reportsInWindow = 0;
  }
  reportsInWindow += 1;
  return reportsInWindow <= MAX_REPORTS_PER_WINDOW;
}

/**
 * Where the error pages report a failure the browser saw. The report is
 * scrubbed again here (the browser is not trusted to have done it), written to
 * the server log in the same audit line every API route writes, and forwarded
 * to Sentry when OPENPLAN_SENTRY_DSN is set. The report and the Sentry event
 * carry no address, user, cookie or workspace. Always 204, so a failing page
 * never learns anything from it.
 */
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("client.error", request);
  const body = await readJsonWithLimit(request, MAX_BODY_BYTES);
  if (!body.ok) return new NextResponse(null, { status: 204 });
  const report = normalizeErrorReport(body.data);
  if (!report || !admit(Date.now())) return new NextResponse(null, { status: 204 });

  audit.error("client_error", report);
  after(() => forwardToSentry(report, "browser"));
  return new NextResponse(null, { status: 204 });
}
