"use client";

import Link from "next/link";
import { useState } from "react";

import type { PublishedStructuralDemandDiagnosis } from "@/lib/models/published-structural-demand-diagnosis";
import { StatusBadge } from "@/components/ui/status-badge";

export function PublishedStructuralDemandDiagnosisCard({ study }: { study: PublishedStructuralDemandDiagnosis | null }) {
  const records = study?.records ?? [];
  const geographies = [...new Map(records.map((record) => [record.geographyId, record.geographyName])).entries()];
  const [geographyId, setGeographyId] = useState(geographies[0]?.[0] ?? "");
  const [method, setMethod] = useState<"aequilibrae" | "activitysim">("aequilibrae");
  const selected = records.find((record) => record.geographyId === geographyId && record.method === method) ?? null;
  if (!study) return null;
  return (
    <section aria-label="Structural demand and loading diagnosis" className="module-section-surface mb-6" data-testid="published-structural-demand-diagnosis">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="module-section-label">v{study.version} · diagnosis only</p>
          <h2 className="module-section-title">Demand distribution, external travel, and network loading</h2>
        </div>
        <StatusBadge tone="warning">{study.scientificOutcome}</StatusBadge>
      </div>
      <p className="module-section-description mt-3 max-w-[64rem]">
        Fourteen separate development records size structural coverage and limitations. They do not show improved accuracy. LODES provenance is unavailable in these frozen packages, non-work through travel is unsupported, and the 0.35 through share is an assumption.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><span className="font-semibold">Coverage</span><span className="mt-1 block text-muted-foreground">{geographies.length} counties · {study.records.length} separate method records</span></div>
        <div><span className="font-semibold">Method treatment</span><span className="mt-1 block text-muted-foreground">AequilibraE and ActivitySim remain separate. No ranking or average.</span></div>
        <div><span className="font-semibold">Release SHA</span><span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{study.releaseSha}</span></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
        <Link className="underline underline-offset-2" href="/api/models/structural-demand-diagnosis/study-result.json">Download exact study result</Link>
        <Link className="underline underline-offset-2" href="/api/models/structural-demand-diagnosis/study-report.md">Download study report</Link>
      </div>
      <div className="mt-4 min-w-0 rounded border border-border/70 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="min-w-0 text-sm font-semibold">
            Development geography
            <select className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 font-normal" value={geographyId} onChange={(event) => setGeographyId(event.target.value)}>
              {geographies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <div aria-label="Demand method" className="flex flex-wrap gap-2">
            {(["aequilibrae", "activitysim"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)} className="rounded border border-border px-3 py-2 text-sm font-semibold aria-pressed:border-primary aria-pressed:bg-primary/10">
                {value === "aequilibrae" ? "AequilibraE" : "ActivitySim"}
              </button>
            ))}
          </div>
        </div>
        {selected ? (
          <div className="mt-3 min-w-0" aria-live="polite" data-testid="selected-structural-demand-record">
            <p className="text-sm font-semibold">{selected.geographyName} · {selected.method}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
              {(["loaded", "unloaded", "unreachable", "excluded", "ambiguous", "unsupported", "missing_output"] as const).map((key) => (
                <div key={key}><dt className="text-muted-foreground">{key.replace("_", " ")}</dt><dd className="font-semibold">{selected.coverage[key] ?? 0}</dd></div>
              ))}
            </dl>
            <dl className="mt-3 min-w-0 space-y-2 text-xs">
              <div className="min-w-0"><dt className="font-semibold">Input audit SHA-256</dt><dd className="break-all font-mono text-muted-foreground">{selected.inputAuditSha256}</dd></div>
              <div className="min-w-0"><dt className="font-semibold">Diagnosis SHA-256</dt><dd className="break-all font-mono text-muted-foreground">{selected.diagnosisSha256}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
              <Link className="underline" href={`/api/models/structural-demand-diagnosis/${selected.geographyId}/${selected.method}/model-structural-input-audit-v1.json`}>Download selected input audit</Link>
              <Link className="underline" href={`/api/models/structural-demand-diagnosis/${selected.geographyId}/${selected.method}/model-validation-structural-diagnosis-v3.json`}>Download selected diagnosis</Link>
            </div>
          </div>
        ) : null}
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">Input audits and post-output diagnoses</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {geographies.map(([geographyId, name]) => (
            <div key={geographyId} className="min-w-0 rounded border border-border/70 p-3 text-xs">
              <p className="font-semibold">{name}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
                {(["aequilibrae", "activitysim"] as const).flatMap((method) => [
                  <Link key={`${method}-audit`} className="underline" href={`/api/models/structural-demand-diagnosis/${geographyId}/${method}/model-structural-input-audit-v1.json`}>{method} input audit</Link>,
                  <Link key={`${method}-diagnosis`} className="underline" href={`/api/models/structural-demand-diagnosis/${geographyId}/${method}/model-validation-structural-diagnosis-v3.json`}>{method} diagnosis</Link>,
                ])}
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
