export type OperationalWarningEvent = {
  event: string;
  label: string;
  source: string;
  severity: "watch" | "investigate" | "urgent";
  threshold: string;
  logQuery: string;
  response: string;
};

export const operationalWarningEvents: OperationalWarningEvent[] = [
  {
    event: "request_body_too_large",
    label: "Oversized API request",
    source: "/api/analysis, /api/assistant, /api/report, /api/reports/[reportId]/generate, network ingest",
    severity: "investigate",
    threshold: "Any route-specific spike above normal user retries",
    logQuery: "\"request_body_too_large\"",
    response: "Check route, byteLength, maxBytes, user agent, and client IP. Repeated source fingerprints should be blocked upstream.",
  },
  {
    event: "engagement_public_submission_body_too_large",
    label: "Oversized public engagement submission",
    source: "/api/engage/[shareToken]/submit",
    severity: "investigate",
    threshold: "More than 5 events for one campaign or source in 15 minutes",
    logQuery: "\"engagement_public_submission_body_too_large\"",
    response: "Review campaign share-token exposure, client IP concentration, and moderation queue volume.",
  },
  {
    event: "csp_report_body_too_large",
    label: "Oversized CSP report",
    source: "/api/csp-report",
    severity: "watch",
    threshold: "Repeated 413s from a single browser source",
    logQuery: "\"csp_report_body_too_large\"",
    response: "Treat as noisy telemetry unless paired with high CSP violation volume or suspicious user agents.",
  },
  {
    event: "analysis_cost_threshold_exceeded",
    label: "High-cost AI analysis call",
    source: "/api/analysis",
    severity: "watch",
    threshold: "Estimated single-call cost greater than $0.50",
    logQuery: "\"analysis_cost_threshold_exceeded\"",
    response: "Inspect model, token estimate, workspace, and route context. This is observation-only and should not block users.",
  },
  {
    event: "csp_report_received",
    label: "CSP report-only violation",
    source: "/api/csp-report",
    severity: "watch",
    threshold: "New blocked URI pattern or sustained violation rate after deploy",
    logQuery: "\"csp_report_received\"",
    response: "Group by blocked-uri, violated-directive, and deployment. Promote CSP enforcement only after expected noise is understood.",
  },
];

export function summarizeOperationalWarnings(events = operationalWarningEvents) {
  return {
    totalEvents: events.length,
    urgentEvents: events.filter((event) => event.severity === "urgent").length,
    investigateEvents: events.filter((event) => event.severity === "investigate").length,
    watchEvents: events.filter((event) => event.severity === "watch").length,
    combinedLogQuery: events.map((event) => event.logQuery).join(" OR "),
  };
}
