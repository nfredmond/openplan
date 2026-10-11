"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Download, MapPinned } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  JurisdictionReadinessReport,
  JurisdictionReadinessStatus,
} from "@/lib/jurisdiction-readiness/contracts";
import type { StatusTone } from "@/lib/ui/status";

const STATUS_TONES: Record<JurisdictionReadinessStatus, StatusTone> = {
  supported: "success",
  partial: "warning",
  unavailable: "danger",
  unassessed: "neutral",
};

type JurisdictionReadinessPanelProps = {
  reports: JurisdictionReadinessReport[];
  downloadHref?: string;
  defaultJobId?: string;
  compact?: boolean;
  unreadableReason?: string;
};

/** One visible rendering for the same reports returned by the API and evidence bundle. */
export function JurisdictionReadinessPanel({
  reports,
  downloadHref,
  defaultJobId = "project-evidence-handoff",
  compact = false,
  unreadableReason,
}: JurisdictionReadinessPanelProps) {
  const initialJobId = reports.some((report) => report.job.id === defaultJobId)
    ? defaultJobId
    : reports[0]?.job.id ?? "";
  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const report = useMemo(
    () => reports.find((candidate) => candidate.job.id === selectedJobId) ?? reports[0] ?? null,
    [reports, selectedJobId],
  );

  if (unreadableReason) {
    return (
      <section
        className={compact ? "rounded-xl border border-destructive/40 p-4" : "rounded-xl border border-destructive/40 p-5"}
        aria-label="Jurisdiction support"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <MapPinned className="h-4 w-4" />
              Local support
            </div>
            <h2 className="mt-2 text-base font-semibold text-foreground">
              Support could not be checked
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{unreadableReason}</p>
          </div>
          <StatusBadge tone="danger">Unreadable</StatusBadge>
        </div>
      </section>
    );
  }

  if (!report) return null;

  const detail = (
    <>
      {reports.length > 1 ? (
        <label className="mt-4 block text-sm font-medium text-foreground">
          Planning job
          <select
            className="module-select mt-1 w-full md:max-w-xl"
            value={report.job.id}
            onChange={(event) => setSelectedJobId(event.target.value)}
          >
            {reports.map((candidate) => (
              <option key={candidate.job.id} value={candidate.job.id}>
                {candidate.job.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="mt-4 text-sm text-foreground">{report.applicability}</p>
      <p className="mt-2 text-xs text-muted-foreground">{report.job.description}</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground">Limits</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {report.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground">Exact evidence</h3>
          {report.sources.length > 0 ? (
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
              {report.sources.map((source) => (
                <li key={source.id} className="min-w-0">
                  <span className="block break-all text-foreground">{source.path}</span>
                  <code className="block break-all font-mono text-label">sha256:{source.sha256}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No evidence-backed claim is registered for this cell.
            </p>
          )}
        </div>
      </div>

      {report.authorities.length > 0 ? (
        <div className="mt-4 border-t border-border/70 pt-4">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Applicable authorities and source pages
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {report.authorities.map((authority) => (
              <li key={`${authority.kind}:${authority.url}`}>
                <a className="font-medium text-foreground hover:underline" href={authority.url}>
                  {authority.label}
                </a>{" "}
                <span className="text-muted-foreground">— {authority.agency}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4 text-xs text-muted-foreground">
        <div className="min-w-0">
          <span className="block">Registry {report.registryVersion}</span>
          {report.registrySha256 ? (
            <code className="mt-1 block break-all font-mono text-label">sha256:{report.registrySha256}</code>
          ) : null}
        </div>
        {downloadHref ? (
          <a className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline" href={downloadHref}>
            <Download className="h-3.5 w-3.5" />
            Download exact local support JSON
          </a>
        ) : null}
      </div>
    </>
  );

  /*
    COMPACT IS ONE ROW THAT OPENS.

    On a project page this panel used to stand fully open above the project's
    own tabs: a jurisdiction question, a job picker, two columns of limits and a
    SHA-256 hash, before anything about the project. The answer still shows on
    the closed row (the status badge is never hidden); the reasoning, sources
    and download are one click away.
  */
  if (compact) {
    return (
      <section className="rounded-xl border border-border/70" aria-label="Jurisdiction support">
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 [&::-webkit-details-marker]:hidden">
            <MapPinned className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">Can OpenPlan do this here?</h2>
            <span className="text-sm text-muted-foreground">{report.jurisdiction.label}</span>
            <span className="ml-auto flex items-center gap-2">
              <StatusBadge tone={STATUS_TONES[report.status]}>{report.statusLabel}</StatusBadge>
              <ChevronDown
                className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </span>
          </summary>
          <div className="border-t border-border/70 px-4 pb-4">{detail}</div>
        </details>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border/70 p-5" aria-label="Jurisdiction support">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <MapPinned className="h-4 w-4" />
            Local support
          </div>
          <h2 className="mt-2 text-base font-semibold text-foreground">Can OpenPlan do this here?</h2>
          <p className="mt-1 text-sm text-muted-foreground">{report.jurisdiction.label}</p>
        </div>
        <StatusBadge tone={STATUS_TONES[report.status]}>{report.statusLabel}</StatusBadge>
      </div>

      {detail}
    </section>
  );
}
