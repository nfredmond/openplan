"use client";

import { useCallback, useEffect, useState } from "react";
import { Scale } from "lucide-react";

import type {
  MeasureComparison,
  ServiceEquityComparison,
  ServiceEquityResult,
} from "@/lib/title-vi/service-equity";
import type { TitleViPolicy, TractDefinitionMethod } from "@/lib/title-vi/policy";

/**
 * TITLE VI SERVICE EQUITY — the panel a planner actually reaches.
 *
 * ============================================ WHAT IT WILL NOT LET YOU DO
 *
 * It offers NO default thresholds and no "typical" starting policy to accept.
 * FTA C 4702.1B thresholds are values an agency's board adopts and publishes; a
 * number a planner clicked past is a number nobody adopted, and on a published
 * finding it would be indistinguishable from one that was. Every threshold
 * field starts empty, and the analysis refuses until they are recorded.
 *
 * ============================================== HOW IT SHOWS A DIFFERENCE
 *
 * A negative relative difference ALWAYS means the focus group is worse off,
 * whichever direction the underlying measure improves in — `service-equity.ts`
 * does that signing, and this panel must not re-derive it. Rendering the raw
 * gap would report minority areas waiting twice as long as an advantage, which
 * is the single worst thing this screen could say.
 *
 * A verdict badge appears ONLY when the agency adopted a threshold. Without one
 * the difference is shown as a number and named nothing.
 */

type PolicyBody = { policy: TitleViPolicy | null; gaps: string[]; canEdit: boolean };
type EquityBody = {
  serviceDay: string;
  availableServiceDays: string[];
  tractServiceComputedAt: string | null;
  result: ServiceEquityResult | { ok: false; refusal: { code: string; message: string } };
};

const SERVICE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function formatDifference(measure: MeasureComparison): string {
  if (measure.relativeDifferencePct === null) return "—";
  const value = measure.relativeDifferencePct;
  return `${value > 0 ? "+" : ""}${value}%`;
}

function differenceTone(measure: MeasureComparison): string {
  if (measure.relativeDifferencePct === null) return "text-muted-foreground";
  if (measure.exceedsAdoptedThreshold) return "text-red-600 dark:text-red-400";
  return measure.relativeDifferencePct < 0
    ? "text-amber-600 dark:text-amber-400"
    : "text-emerald-700 dark:text-emerald-300";
}

function MeasureTable({
  title,
  measures,
  focusLabel,
  thresholdAdopted,
}: {
  title: string;
  measures: MeasureComparison[];
  focusLabel: string;
  thresholdAdopted: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-muted-foreground">
            <th className="py-1 pr-3">Measure</th>
            <th className="py-1 pr-3">{focusLabel}</th>
            <th className="py-1 pr-3">Rest of service area</th>
            <th className="py-1 pr-3">Difference</th>
            <th className="py-1">Against adopted threshold</th>
          </tr>
        </thead>
        <tbody>
          {measures.map((measure) => (
            <tr key={measure.measure.key} className="border-t border-border/60">
              <td className="py-1.5 pr-3">
                {measure.measure.label}
                <span className="block text-xs text-muted-foreground">
                  {measure.measure.unit}
                  {measure.measure.direction === "lower_is_better" ? " · lower is better" : ""}
                </span>
              </td>
              <td className="py-1.5 pr-3 tabular-nums">{measure.focusValue ?? "—"}</td>
              <td className="py-1.5 pr-3 tabular-nums">{measure.comparisonValue ?? "—"}</td>
              <td className={`py-1.5 pr-3 tabular-nums ${differenceTone(measure)}`}>
                {formatDifference(measure)}
              </td>
              <td className="py-1.5 text-xs">
                {measure.exceedsAdoptedThreshold === null ? (
                  <span className="text-muted-foreground">
                    {thresholdAdopted ? "Not measurable" : "No threshold adopted"}
                  </span>
                ) : measure.exceedsAdoptedThreshold ? (
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    Exceeds the adopted threshold
                  </span>
                ) : (
                  <span className="text-muted-foreground">Within the adopted threshold</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Comparison({ comparison }: { comparison: ServiceEquityComparison }) {
  const thresholdAdopted = comparison.minorityMeasures.some(
    (measure) => measure.exceedsAdoptedThreshold !== null
  );
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{comparison.classificationBasis}</p>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Minority tracts</dt>
          <dd className="tabular-nums">{comparison.minorityFocus.tracts}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Residents in them</dt>
          <dd className="tabular-nums">{comparison.minorityFocus.population.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">With no stop at all</dt>
          <dd className="tabular-nums">
            {comparison.minorityFocus.populationWithNoService.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Service-area minority share</dt>
          <dd className="tabular-nums">
            {comparison.serviceAreaMinoritySharePct === null
              ? "—"
              : `${comparison.serviceAreaMinoritySharePct}%`}
          </dd>
        </div>
      </dl>

      <MeasureTable
        title="Minority tracts compared with the rest of the service area"
        measures={comparison.minorityMeasures}
        focusLabel="Minority tracts"
        thresholdAdopted={thresholdAdopted}
      />
      <MeasureTable
        title="Low-income tracts compared with the rest of the service area"
        measures={comparison.lowIncomeMeasures}
        focusLabel="Low-income tracts"
        thresholdAdopted={thresholdAdopted}
      />

      <div className="rounded-[0.5rem] border border-border/60 bg-muted/30 p-3">
        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          What these figures do and do not establish
        </p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {comparison.disclosures.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>
            OpenPlan measures a difference and compares it to the threshold your agency adopted. It
            does not determine that a disparate impact or a disproportionate burden exists — that is
            your governing body&apos;s determination, on a record that includes public participation.
          </li>
        </ul>
      </div>
    </div>
  );
}

export function TitleViServiceEquityPanel({
  workspaceId,
  today,
  readOnly = false,
}: {
  workspaceId: string;
  /** `YYYY-MM-DD` from the server, so an adoption date never depends on a browser clock. */
  today: string;
  readOnly?: boolean;
}) {
  const [policy, setPolicy] = useState<PolicyBody | null>(null);
  const [equity, setEquity] = useState<EquityBody | null>(null);
  const [serviceDay, setServiceDay] = useState<string>("monday");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    adoptedOn: today,
    adoptedBy: "",
    boardActionReference: "",
    minorityDefinitionMethod: "service_area_average" as TractDefinitionMethod,
    minorityThresholdPct: "",
    lowIncomeDefinitionMethod: "service_area_average" as TractDefinitionMethod,
    lowIncomeThresholdPct: "",
    disparateImpactThresholdPct: "",
    disproportionateBurdenThresholdPct: "",
    standardPeakHeadwayMinutes: "",
    standardSpanHours: "",
  });

  const loadPolicy = useCallback(async () => {
    try {
      const response = await fetch(`/api/title-vi/policy?workspaceId=${workspaceId}`);
      if (!response.ok) {
        setError("Could not read the adopted Title VI policy.");
        return;
      }
      setPolicy((await response.json()) as PolicyBody);
    } catch {
      setError("Could not read the adopted Title VI policy.");
    }
  }, [workspaceId]);

  const loadEquity = useCallback(
    async (day: string) => {
      try {
        const response = await fetch(
          `/api/title-vi/service-equity?workspaceId=${workspaceId}&serviceDay=${day}`
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string; hint?: string };
          // A read failure is reported AS a read failure. Rendering it as an
          // empty comparison would say no tract has service.
          setEquity(null);
          setError(body.hint ? `${body.error ?? "Read failed"} ${body.hint}` : body.error ?? "Read failed");
          return;
        }
        setError(null);
        setEquity((await response.json()) as EquityBody);
      } catch {
        setEquity(null);
        setError("Could not compare service equity.");
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  useEffect(() => {
    void loadEquity(serviceDay);
  }, [loadEquity, serviceDay]);

  const numberOrNull = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  async function adopt() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/title-vi/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          adoptedOn: form.adoptedOn,
          adoptedBy: form.adoptedBy.trim(),
          boardActionReference: form.boardActionReference.trim() || null,
          minorityDefinitionMethod: form.minorityDefinitionMethod,
          minorityThresholdPct:
            form.minorityDefinitionMethod === "fixed_threshold"
              ? numberOrNull(form.minorityThresholdPct)
              : null,
          lowIncomeDefinitionMethod: form.lowIncomeDefinitionMethod,
          lowIncomeThresholdPct:
            form.lowIncomeDefinitionMethod === "fixed_threshold"
              ? numberOrNull(form.lowIncomeThresholdPct)
              : null,
          disparateImpactThresholdPct: numberOrNull(form.disparateImpactThresholdPct),
          disproportionateBurdenThresholdPct: numberOrNull(form.disproportionateBurdenThresholdPct),
          standardPeakHeadwayMinutes: numberOrNull(form.standardPeakHeadwayMinutes),
          standardSpanHours: numberOrNull(form.standardSpanHours),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!response.ok) {
        setError(body.detail ?? body.error ?? "Could not record the policy.");
        return;
      }
      setEditing(false);
      await loadPolicy();
      await loadEquity(serviceDay);
    } finally {
      setSaving(false);
    }
  }

  const result = equity?.result;

  return (
    <article className="module-section-surface" data-testid="title-vi-service-equity-panel">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <h3 className="module-section-title">Title VI service equity</h3>
            <p className="module-section-subtitle">
              Compares transit service in your minority and low-income tracts with the rest of your
              service area, against the thresholds your agency adopted.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-[0.5rem] border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {error}
        </p>
      ) : null}

      {/* ---- The adopted policy ------------------------------------------- */}
      <section className="mb-5 rounded-[0.5rem] border border-border/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">Adopted Title VI policy</h4>
          {policy?.canEdit && !readOnly ? (
            <button
              type="button"
              className="text-xs underline"
              onClick={() => setEditing((open) => !open)}
            >
              {editing ? "Cancel" : policy.policy ? "Record a new adoption" : "Record your adopted policy"}
            </button>
          ) : null}
        </div>

        {policy?.policy ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Adopted {policy.policy.adoptedOn} by {policy.policy.adoptedBy}
            {policy.policy.boardActionReference ? ` (${policy.policy.boardActionReference})` : ""}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No adopted policy is recorded. OpenPlan supplies no default thresholds — they are values
            your agency adopts and publishes.
          </p>
        )}

        {policy?.gaps.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {policy.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        ) : null}

        {editing ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs">
              Adoption date
              <input
                type="date"
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                value={form.adoptedOn}
                onChange={(event) => setForm((f) => ({ ...f, adoptedOn: event.target.value }))}
              />
            </label>
            <label className="text-xs">
              Adopted by
              <input
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                placeholder="e.g. Board of Directors"
                value={form.adoptedBy}
                onChange={(event) => setForm((f) => ({ ...f, adoptedBy: event.target.value }))}
              />
            </label>
            <label className="text-xs">
              Board action reference
              <input
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                placeholder="e.g. Resolution 2026-04"
                value={form.boardActionReference}
                onChange={(event) =>
                  setForm((f) => ({ ...f, boardActionReference: event.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Minority tract definition
              <select
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                value={form.minorityDefinitionMethod}
                onChange={(event) =>
                  setForm((f) => ({
                    ...f,
                    minorityDefinitionMethod: event.target.value as TractDefinitionMethod,
                  }))
                }
              >
                <option value="service_area_average">Above the service-area average</option>
                <option value="fixed_threshold">Above a fixed percentage</option>
              </select>
            </label>
            {form.minorityDefinitionMethod === "fixed_threshold" ? (
              <label className="text-xs">
                Minority threshold (%)
                <input
                  className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                  value={form.minorityThresholdPct}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, minorityThresholdPct: event.target.value }))
                  }
                />
              </label>
            ) : null}
            <label className="text-xs">
              Low-income tract definition
              <select
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                value={form.lowIncomeDefinitionMethod}
                onChange={(event) =>
                  setForm((f) => ({
                    ...f,
                    lowIncomeDefinitionMethod: event.target.value as TractDefinitionMethod,
                  }))
                }
              >
                <option value="service_area_average">Above the service-area average</option>
                <option value="fixed_threshold">Above a fixed percentage</option>
              </select>
            </label>
            {form.lowIncomeDefinitionMethod === "fixed_threshold" ? (
              <label className="text-xs">
                Low-income threshold (%)
                <input
                  className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                  value={form.lowIncomeThresholdPct}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, lowIncomeThresholdPct: event.target.value }))
                  }
                />
              </label>
            ) : null}
            <label className="text-xs">
              Disparate-impact threshold (percentage points)
              <input
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                placeholder="Leave blank if none is adopted"
                value={form.disparateImpactThresholdPct}
                onChange={(event) =>
                  setForm((f) => ({ ...f, disparateImpactThresholdPct: event.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Disproportionate-burden threshold (percentage points)
              <input
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                placeholder="Leave blank if none is adopted"
                value={form.disproportionateBurdenThresholdPct}
                onChange={(event) =>
                  setForm((f) => ({ ...f, disproportionateBurdenThresholdPct: event.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Service standard: peak headway (minutes)
              <input
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                value={form.standardPeakHeadwayMinutes}
                onChange={(event) =>
                  setForm((f) => ({ ...f, standardPeakHeadwayMinutes: event.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Service standard: span (hours)
              <input
                className="mt-1 w-full rounded border border-border bg-background p-1.5 text-sm"
                value={form.standardSpanHours}
                onChange={(event) =>
                  setForm((f) => ({ ...f, standardSpanHours: event.target.value }))
                }
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                disabled={saving || form.adoptedBy.trim() === ""}
                onClick={() => void adopt()}
              >
                {saving ? "Recording…" : "Record this adoption"}
              </button>
              <p className="mt-1 text-xs text-muted-foreground">
                Recording a new adoption supersedes the previous one and keeps it on the record, so a
                finding stays reproducible against the policy it was measured under.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {/* ---- The comparison ------------------------------------------------ */}
      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs uppercase text-muted-foreground" htmlFor="title-vi-service-day">
          Service day
        </label>
        <select
          id="title-vi-service-day"
          className="rounded border border-border bg-background p-1 text-sm"
          value={serviceDay}
          onChange={(event) => setServiceDay(event.target.value)}
        >
          {SERVICE_DAYS.map((day) => (
            <option key={day} value={day}>
              {day[0].toUpperCase()}
              {day.slice(1)}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Days are never combined — a system with no weekend service is a common finding a weekly
          total would erase.
        </span>
      </div>

      {result && result.ok ? (
        <Comparison comparison={result.comparison} />
      ) : result ? (
        <p className="rounded-[0.5rem] border border-border/60 bg-muted/30 p-3 text-sm">
          {result.refusal.message}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Loading service equity…</p>
      )}
    </article>
  );
}
