import { APP_VERSION, appCommitSha } from "@/lib/runtime/app-version";
import type { ErrorReport } from "./error-report";

/**
 * Optional forwarding of error reports to Sentry, without Sentry's SDK.
 *
 * Off unless OPENPLAN_SENTRY_DSN is set. The DSN stays on the server: browsers
 * report to this deployment, which scrubs the report and then posts one event
 * in Sentry's envelope format. The browser never contacts Sentry, so the
 * content-security policy is unchanged, and the build gains no SDK, webpack
 * plugin or client bundle weight. Sentry's free Developer plan accepts these
 * events; any service that accepts Sentry envelopes on the same path should too.
 *
 * Sending never throws and never waits more than three seconds.
 */

const SEND_TIMEOUT_MS = 3_000;

export type SentryTarget = { endpoint: string; publicKey: string };

/** Parses a DSN such as https://<key>@o1.ingest.sentry.io/123, or returns null. */
export function parseSentryDsn(raw: string | undefined | null): SentryTarget | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  let publicKey: string;
  try {
    url = new URL(value);
    publicKey = decodeURIComponent(url.username);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = segments.length ? `/${segments.join("/")}` : "";
  return { endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`, publicKey };
}

function sentryTargetFromEnv(): SentryTarget | null {
  return parseSentryDsn(process.env.OPENPLAN_SENTRY_DSN);
}

/** The envelope body for one already-scrubbed report. */
export function buildSentryEnvelope(
  report: ErrorReport,
  runtime: "browser" | "server",
  now = new Date(),
  eventId = crypto.randomUUID().replace(/-/g, ""),
): string {
  const commit = appCommitSha()?.trim().slice(0, 12) || undefined;
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: runtime === "browser" ? "javascript" : "node",
    level: "error",
    logger: "openplan",
    release: `openplan@${APP_VERSION}`,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    transaction: report.path,
    tags: {
      boundary: report.boundary,
      runtime,
      ...(report.digest ? { digest: report.digest } : {}),
      ...(commit ? { commit } : {}),
    },
    exception: { values: [{ type: report.name, value: report.message || "(no message)" }] },
    extra: report.stack ? { stack: report.stack } : {},
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: now.toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n") + "\n";
}

/** Posts one report when a DSN is configured. Returns whether Sentry accepted it. */
export async function forwardToSentry(
  report: ErrorReport,
  runtime: "browser" | "server",
  target: SentryTarget | null = sentryTargetFromEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!target) return false;
  try {
    const response = await fetchImpl(target.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=openplan/${APP_VERSION}`,
      },
      body: buildSentryEnvelope(report, runtime),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
