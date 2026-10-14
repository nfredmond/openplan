import type { Instrumentation } from "next";

/**
 * Server errors already reach the server log through Next.js. When
 * OPENPLAN_SENTRY_DSN is set, each one is also sent to Sentry, scrubbed the
 * same way as a browser report. The route pattern (`/engage/[shareToken]`)
 * stands in for the requested path, so no share token or query string is sent.
 * With no DSN this does nothing.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (!process.env.OPENPLAN_SENTRY_DSN?.trim()) return;
  const [{ normalizeErrorReport }, { forwardToSentry }] = await Promise.all([
    import("@/lib/observability/error-report"),
    import("@/lib/observability/sentry-envelope"),
  ]);
  const failure = error instanceof Error ? (error as Error & { digest?: unknown }) : null;
  const report = normalizeErrorReport({
    boundary: `server-${context.routeType}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40),
    name: failure?.name,
    message: failure ? failure.message : String(error),
    digest: typeof failure?.digest === "string" ? failure.digest : undefined,
    stack: failure?.stack,
    path: context.routePath,
  });
  if (report) await forwardToSentry(report, "server");
};
