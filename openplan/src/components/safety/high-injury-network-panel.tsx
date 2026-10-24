"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  describeHighInjuryNetworkCoverage,
  describeHighInjuryNetworkMethod,
  describeHighInjuryNetworkUnavailable,
  describeHighInjuryNetworkYears,
  highInjuryNetworkMeasureLabel,
  type HighInjuryNetwork,
  type HighInjuryNetworkSegment,
} from "@/lib/safety/high-injury-network";
import {
  COUNTERMEASURE_CRASH_TYPE_LABELS,
  describeCountermeasureSource,
  SAFETY_COUNTERMEASURE_FILE,
  SAFETY_COUNTERMEASURES,
} from "@/lib/safety/countermeasures";
import type {
  ReportSafetyActionPlan,
  SafetyActionPlanAttachment,
} from "@/lib/reports/safety-action-plan";

export type HighInjuryNetworkReportTarget = {
  id: string;
  title: string;
  /** Only standard project-status reports support the input comparison. */
  supportsSafetyComparison?: boolean;
  /** The plan already saved in this report, if any. */
  safetyActionPlan: ReportSafetyActionPlan | null;
};

type Props = {
  /** Undefined before the first load; null when no acquisition is in context. */
  network: HighInjuryNetwork | null | undefined;
  sourceLabel: string | null;
  showOnMap: boolean;
  onShowOnMapChange: (show: boolean) => void;
  onFocusSegment: (segment: HighInjuryNetworkSegment) => void;
  /** The acquisition the ranking came from. Required to save a plan. */
  ingestId: string | null;
  reports: HighInjuryNetworkReportTarget[];
  /** Injected for tests; defaults to `fetch`. */
  saveRequest?: (reportId: string, body: unknown) => Promise<{ ok: boolean; error?: string }>;
};

async function patchReport(reportId: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/reports/${reportId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return { ok: true };
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return { ok: false, error: typeof payload?.error === "string" ? payload.error : "The report could not be saved." };
}

function initialSelections(
  reports: readonly HighInjuryNetworkReportTarget[],
  reportId: string,
  ingestId: string | null,
): Record<string, string[]> {
  const plan = reports.find((report) => report.id === reportId)?.safetyActionPlan;
  if (!plan || plan.ingestId !== ingestId) return {};
  return Object.fromEntries(plan.attachments.map((attachment) => [attachment.segmentId, attachment.countermeasureIds]));
}

/**
 * The ranked high-injury network beside the map, with method, years, source
 * and coverage stated next to the numbers, and countermeasures a planner can
 * attach to a segment and save into a project report.
 */
export function HighInjuryNetworkPanel({
  network,
  sourceLabel,
  showOnMap,
  onShowOnMapChange,
  onFocusSegment,
  ingestId,
  reports,
  saveRequest = patchReport,
}: Props) {
  const [reportId, setReportId] = useState(reports[0]?.id ?? "");
  const [selections, setSelections] = useState<Record<string, string[]>>(() =>
    initialSelections(reports, reports[0]?.id ?? "", ingestId),
  );
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "saved" | "failed"; message?: string }>({
    kind: "idle",
  });

  const segments = useMemo(() => (network?.status === "computed" ? network.segments : []), [network]);
  const attachedCount = Object.values(selections).filter((ids) => ids.length > 0).length;
  const comparisonReport = reports.find((report) => report.id === reportId && report.supportsSafetyComparison)
    ?? reports.find((report) => report.supportsSafetyComparison);

  if (network === undefined) return null;
  if (network === null) return null;

  if (network.status === "unavailable") {
    return (
      <section data-testid="safety-hin" aria-labelledby="safety-hin-heading" className="flex flex-col gap-1">
        <h2 id="safety-hin-heading" className="text-sm font-semibold">High-injury network</h2>
        <p className="text-xs text-muted-foreground" data-testid="safety-hin-unavailable">
          {describeHighInjuryNetworkUnavailable(network.reason)}
        </p>
      </section>
    );
  }

  const measure = highInjuryNetworkMeasureLabel(network.basis, network.method);
  const perMileHeader = network.method === "road_segments" ? "Per mile" : "In square";
  const crashHeader = network.basis === "ksi" ? "Fatal / serious" : "Fatal";

  const toggle = (segmentId: string, countermeasureId: string) => {
    setSaveState({ kind: "idle" });
    setSelections((previous) => {
      const current = previous[segmentId] ?? [];
      const next = current.includes(countermeasureId)
        ? current.filter((id) => id !== countermeasureId)
        : [...current, countermeasureId];
      return { ...previous, [segmentId]: next };
    });
  };

  const save = async () => {
    if (!ingestId || !reportId) return;
    const attachments: SafetyActionPlanAttachment[] = segments.flatMap((segment) => {
      const ids = selections[segment.id] ?? [];
      return ids.length > 0 ? [{ segmentId: segment.id, segmentLabel: segment.label, countermeasureIds: ids }] : [];
    });
    setSaveState({ kind: "saving" });
    const result = await saveRequest(reportId, {
      safetyIngestSelections: [{ ingestId }],
      safetyActionPlan: { ingestId, attachments },
    });
    const title = reports.find((report) => report.id === reportId)?.title ?? "the report";
    setSaveState(result.ok
      ? { kind: "saved", message: `Saved to ${title}.` }
      : { kind: "failed", message: result.error ?? "The report could not be saved." });
  };

  return (
    <section data-testid="safety-hin" aria-labelledby="safety-hin-heading" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="safety-hin-heading" className="text-sm font-semibold">High-injury network</h2>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showOnMap}
            onChange={(event) => onShowOnMapChange(event.target.checked)}
            data-testid="safety-hin-show-on-map"
          />
          Show on map
        </label>
      </div>
      <p className="text-xs font-medium" data-testid="safety-hin-measure">{measure}</p>
      {comparisonReport && ingestId ? <Link className="text-xs underline" href={`/reports/${comparisonReport.id}?safetyComparison=1&safetyIngestId=${encodeURIComponent(ingestId)}`}>
        Review No Build, alternatives and applicability in this report
      </Link> : <Link className="text-xs underline" href="/reports">Choose or create a project-status report for Safety comparison</Link>}

      {segments.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="safety-hin-empty">
          {network.crashesConsidered === 0
            ? describeHighInjuryNetworkCoverage(network)
            : "No crash could be placed on a road piece, so nothing is ranked. That is not a finding that the roads are safe."}
        </p>
      ) : (
        <table className="w-full text-xs" data-testid="safety-hin-table">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-1 font-medium">#</th>
              <th scope="col" className="py-1 pr-1 font-medium">{network.method === "road_segments" ? "Road" : "Area"}</th>
              <th scope="col" className="py-1 pr-1 text-right font-medium">Miles</th>
              <th scope="col" className="py-1 pr-1 text-right font-medium">{crashHeader}</th>
              <th scope="col" className="py-1 text-right font-medium">{perMileHeader}</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => {
              const chosen = selections[segment.id] ?? [];
              return (
                <tr key={segment.id} className="border-t border-border/60 align-top" data-testid="safety-hin-row">
                  <td className="py-1 pr-1">{segment.tied ? `${segment.rank}=` : segment.rank}</td>
                  <td className="py-1 pr-1">
                    <button
                      type="button"
                      className="text-left underline underline-offset-2"
                      onClick={() => onFocusSegment(segment)}
                      aria-label={`Show ${segment.label} on map`}
                    >
                      {segment.label}
                    </button>
                    <details className="mt-1" data-testid="safety-hin-treatments">
                      <summary className="cursor-pointer text-muted-foreground">
                        Countermeasures ({chosen.length})
                      </summary>
                      <ul className="mt-1 flex flex-col gap-1">
                        {SAFETY_COUNTERMEASURES.map((countermeasure) => (
                          <li key={countermeasure.id}>
                            <label className="flex items-start gap-1">
                              <input
                                type="checkbox"
                                checked={chosen.includes(countermeasure.id)}
                                onChange={() => toggle(segment.id, countermeasure.id)}
                              />
                              <span>{countermeasure.name}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="py-1 pr-1 text-right tabular-nums">
                    {segment.lengthMiles === null ? "n/a" : segment.lengthMiles.toFixed(2)}
                  </td>
                  <td className="py-1 pr-1 text-right tabular-nums">
                    {segment.seriousInjuryCrashCount === null
                      ? segment.fatalCrashCount
                      : `${segment.fatalCrashCount} / ${segment.seriousInjuryCrashCount}`}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {segment.crashesPerMile === null ? segment.crashCount : segment.crashesPerMile.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-muted-foreground" data-testid="safety-hin-facts">
        <dt className="font-medium text-foreground">Method</dt>
        <dd>{describeHighInjuryNetworkMethod(network.method, network.parameters)}</dd>
        <dt className="font-medium text-foreground">Years</dt>
        <dd>{describeHighInjuryNetworkYears(network.years)}</dd>
        <dt className="font-medium text-foreground">Source</dt>
        <dd>
          {sourceLabel ?? "Crash source not recorded"}
          {network.roadSources.length > 0 ? `. Road lines: ${network.roadSources.join("; ")}` : ""}
        </dd>
        <dt className="font-medium text-foreground">Coverage</dt>
        <dd>{describeHighInjuryNetworkCoverage(network)}</dd>
      </dl>

      <details className="text-xs" data-testid="safety-countermeasure-list">
        <summary className="cursor-pointer font-medium">
          Countermeasure list ({SAFETY_COUNTERMEASURES.length}, {SAFETY_COUNTERMEASURE_FILE.source.title})
        </summary>
        <table className="mt-1 w-full">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-1 font-medium">Countermeasure</th>
              <th scope="col" className="py-1 pr-1 font-medium">Crash types</th>
              <th scope="col" className="py-1 font-medium">CMF</th>
            </tr>
          </thead>
          <tbody>
            {SAFETY_COUNTERMEASURES.map((countermeasure) => (
              <tr key={countermeasure.id} className="border-t border-border/60 align-top">
                <td className="py-1 pr-1">
                  <a href={countermeasure.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {countermeasure.name}
                  </a>
                </td>
                <td className="py-1 pr-1">
                  {countermeasure.crashTypes.map((type) => COUNTERMEASURE_CRASH_TYPE_LABELS[type]).join(", ")}
                </td>
                <td className="py-1">{countermeasure.cmf ? countermeasure.cmf.value : "[VERIFY]"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-muted-foreground">{describeCountermeasureSource()}</p>
        <p className="text-muted-foreground">{SAFETY_COUNTERMEASURE_FILE.cmfPolicy}</p>
      </details>

      {segments.length > 0 && (
        ingestId && reports.length > 0 ? (
          <div className="flex flex-col gap-1 text-xs" data-testid="safety-hin-save">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="safety-hin-report" className="font-medium">Save to report</label>
              <select
                id="safety-hin-report"
                value={reportId}
                onChange={(event) => {
                  setReportId(event.target.value);
                  setSelections(initialSelections(reports, event.target.value, ingestId));
                  setSaveState({ kind: "idle" });
                }}
                className="rounded-md border border-border bg-background px-2 py-1"
              >
                {reports.map((report) => (
                  <option key={report.id} value={report.id}>{report.title}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={save}
                disabled={saveState.kind === "saving"}
                className="rounded-md border border-primary/30 px-3 py-1 font-semibold text-primary"
              >
                {saveState.kind === "saving" ? "Saving" : `Save ${attachedCount} ${attachedCount === 1 ? "segment" : "segments"}`}
              </button>
            </div>
            <p className="text-muted-foreground">
              Saving also selects this crash acquisition as the report&apos;s crash evidence.
            </p>
            {saveState.message && (
              <p
                role="status"
                className={saveState.kind === "failed" ? "text-destructive" : "text-muted-foreground"}
              >
                {saveState.message}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="safety-hin-save-unavailable">
            To save countermeasures, open Safety from a project that has a report.
          </p>
        )
      )}
    </section>
  );
}
