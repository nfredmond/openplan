import { Activity, Search, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  operationalWarningEvents,
  summarizeOperationalWarnings,
  type OperationalWarningEvent,
} from "@/lib/observability/operational-events";

export const metadata = {
  title: "Operational Warnings | OpenPlan Admin",
};

function getSeverityTone(severity: OperationalWarningEvent["severity"]) {
  if (severity === "urgent") return "danger" as const;
  if (severity === "investigate") return "warning" as const;
  return "info" as const;
}

export default function AdminOperationsPage() {
  const summary = summarizeOperationalWarnings();

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Activity className="h-3.5 w-3.5" />
            Operational telemetry
          </div>
          <div className="module-intro-body">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">Observation live</StatusBadge>
              <StatusBadge tone="neutral">Log-backed</StatusBadge>
            </div>
            <h1 className="module-intro-title">Warning watchboard</h1>
            <p className="module-intro-description">
              Use these warning events to review request pressure, CSP report-only noise, and AI cost outliers while the pilot remains supervised.
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            <div className="module-summary-card">
              <p className="module-summary-label">Tracked warnings</p>
              <p className="module-summary-value">{summary.totalEvents}</p>
              <p className="module-summary-detail">Events with route, threshold, and response guidance.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Investigate</p>
              <p className="module-summary-value">{summary.investigateEvents}</p>
              <p className="module-summary-detail">Warnings that should be grouped by route and source when they spike.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Watch</p>
              <p className="module-summary-value">{summary.watchEvents}</p>
              <p className="module-summary-detail">Observation-only signals that should build a baseline before enforcement.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Urgent</p>
              <p className="module-summary-value">{summary.urgentEvents}</p>
              <p className="module-summary-detail">No current warning class is configured as urgent by default.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <Search className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Combined query</p>
              <h2 className="module-operator-title">Start with the warning event names</h2>
            </div>
          </div>
          <p className="module-operator-copy break-words">{summary.combinedLogQuery}</p>
          <div className="module-operator-list">
            <div className="module-operator-item">Group oversized-body events by route, client IP, and user agent.</div>
            <div className="module-operator-item">Treat AI cost warnings as observation-only until real pilot usage sets a baseline.</div>
            <div className="module-operator-item">Keep CSP in report-only mode until recurring blocked URI patterns are understood.</div>
          </div>
        </article>
      </header>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Warning catalog</p>
            <h2 className="module-section-title">Log events to review during pilot operations</h2>
            <p className="module-section-description">
              Each row names the event, where it comes from, when to pay attention, and the first response.
            </p>
          </div>
          <StatusBadge tone="info">No blocking controls</StatusBadge>
        </div>

        <div className="mt-5 module-record-list">
          {operationalWarningEvents.map((event) => (
            <div key={event.event} className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={getSeverityTone(event.severity)}>{event.severity}</StatusBadge>
                    <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {event.source}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{event.label}</h3>
                      <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[0.72rem] text-slate-700">
                        {event.event}
                      </code>
                    </div>
                    <p className="module-record-summary">{event.threshold}</p>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                <div className="module-subpanel">
                  <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-foreground">
                    <Search className="h-3.5 w-3.5 text-emerald-700" />
                    Log query
                  </div>
                  <p className="mt-2 break-words text-[0.76rem] text-muted-foreground">{event.logQuery}</p>
                </div>
                <div className="module-subpanel">
                  <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-foreground">
                    <ShieldAlert className="h-3.5 w-3.5 text-emerald-700" />
                    First response
                  </div>
                  <p className="mt-2 text-[0.76rem] leading-relaxed text-muted-foreground">{event.response}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
