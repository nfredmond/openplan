"use client";

import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { PublishedDistributedWorkLoadingStudy } from "@/lib/models/published-distributed-work-loading";

export function PublishedDistributedWorkLoadingCard({ study }: { study: PublishedDistributedWorkLoadingStudy | null }) {
  const records = study?.records ?? [];
  const geographies = [...new Map(records.map((record) => [record.geographyId, record.geographyName])).entries()];
  const [geographyId, setGeographyId] = useState(geographies[0]?.[0] ?? "");
  const [method, setMethod] = useState<"aequilibrae" | "activitysim">("aequilibrae");
  const selected = records.find((record) => record.geographyId === geographyId && record.method === method) ?? null;
  if (!study) return null;
  return (
    <section aria-label="Distributed work loading development checkpoint" className="module-section-surface mb-6" data-testid="published-distributed-work-loading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="module-section-label">v{study.version} · development evidence</p>
          <h2 className="module-section-title">Source-bound work-trip loading</h2>
        </div>
        <StatusBadge tone="warning">{study.scientificOutcome}</StatusBadge>
      </div>
      <p className="module-section-description mt-3 max-w-[64rem]">
        Census LODES8 places covered work-trip endpoints at block-supported road access points. Non-work trips keep their prior centroid loading. Missing, zero, unavailable, suppressed, unmapped, and unroutable states stay separate. This checkpoint does not change model defaults or claim calibration or validation.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><span className="font-semibold">Coverage</span><span className="mt-1 block text-muted-foreground">{geographies.length} counties · {records.length} separate method records</span></div>
        <div><span className="font-semibold">Method treatment</span><span className="mt-1 block text-muted-foreground">AequilibraE and ActivitySim stay separate. No average or national rescue.</span></div>
        <div><span className="font-semibold">Rollout</span><span className="mt-1 block text-muted-foreground">{study.candidateAdvanced ? "Development gate met; defaults still unchanged" : "Candidate retained and retired"}</span></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
        <Link className="underline underline-offset-2" href="/api/models/distributed-work-loading/study-result.json">Download exact study result</Link>
        <Link className="underline underline-offset-2" href="/api/models/distributed-work-loading/study-report.md">Download study report</Link>
      </div>
      <div className="mt-4 min-w-0 rounded border border-border/70 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="min-w-0 text-sm font-semibold">Development geography
            <select className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 font-normal" value={geographyId} onChange={(event) => setGeographyId(event.target.value)}>
              {geographies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <div aria-label="Demand method" className="flex flex-wrap gap-2">
            {(["aequilibrae", "activitysim"] as const).map((value) => <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)} className="rounded border border-border px-3 py-2 text-sm font-semibold aria-pressed:border-primary aria-pressed:bg-primary/10">{value === "aequilibrae" ? "AequilibraE" : "ActivitySim"}</button>)}
          </div>
        </div>
        {selected ? <div className="mt-3 min-w-0" aria-live="polite" data-testid="selected-distributed-work-loading">
          <p className="text-sm font-semibold">{selected.geographyName} · {selected.method}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Road access points</dt><dd className="font-semibold">{selected.accessPointCount.toLocaleString()}</dd></div>
            <div><dt className="text-muted-foreground">Retained points</dt><dd className="font-semibold">{selected.retainedAccessPointCount.toLocaleString()}</dd></div>
            <div><dt className="text-muted-foreground">Work trips distributed</dt><dd className="font-semibold">{selected.distributedWorkTrips.toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd></div>
            <div><dt className="text-muted-foreground">Work trips retained</dt><dd className="font-semibold">{selected.retainedWorkTrips.toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Observed links loaded: {selected.baselineCoverage.loaded ?? 0} before, {selected.candidateCoverage.loaded ?? 0} after. {selected.advanced ? "Development gate met; no default changed." : "County-method candidate failed and was retired."}</p>
          <dl className="mt-3 min-w-0 space-y-2 text-xs">
            <div><dt className="font-semibold">Before-output audit SHA-256</dt><dd className="break-all font-mono text-muted-foreground">{selected.auditSha256}</dd></div>
            <div><dt className="font-semibold">Development comparison SHA-256</dt><dd className="break-all font-mono text-muted-foreground">{selected.comparisonSha256}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
            <Link className="underline" href={`/api/models/distributed-work-loading/${selected.geographyId}/${selected.method}/distributed-work-loading-input-v1.json`}>Download selected loading file</Link>
            <Link className="underline" href={`/api/models/distributed-work-loading/${selected.geographyId}/${selected.method}/pre-output-audit-v1.json`}>Download selected before-output audit</Link>
            <Link className="underline" href={`/api/models/distributed-work-loading/${selected.geographyId}/${selected.method}/development-comparison-v1.json`}>Download selected comparison</Link>
          </div>
        </div> : null}
      </div>
    </section>
  );
}
