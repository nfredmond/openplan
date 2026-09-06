import { StatusBadge } from "@/components/ui/status-badge";

const CATEGORY_LABELS: Record<string, string> = {
  observation: "Observation coverage",
  matching: "Observation matching",
  network_loading: "Network loading",
  comparability: "Comparison basis",
  method_disagreement: "Method disagreement",
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Both current-run metadata and published frozen files use this read-only view.
// Frozen files place unknown facts inside findings and the evidence ledger.
export function StructuralDiagnosisExplanation({ diagnosis, sha256, downloadHref, label = "Why this model validation is inconclusive" }: {
  diagnosis: Record<string, unknown>;
  sha256: string | null;
  downloadHref: string;
  label?: string;
}) {
  const findings = Array.isArray(diagnosis.findings) ? diagnosis.findings.flatMap((value) => {
    const finding = record(value);
    if (!finding || typeof finding.statement !== "string" || !finding.statement.trim()) return [];
    return [{
      category: typeof finding.category === "string" ? finding.category : "finding",
      statement: finding.statement,
      count: typeof finding.count === "number" && Number.isFinite(finding.count) ? finding.count : null,
      unknownFacts: strings(finding.unknown_facts),
    }];
  }) : [];
  const groups = [...new Set(findings.map((finding) => finding.category))];
  const ledger = record(diagnosis.evidence_ledger);
  const unknownFacts = [...new Set([
    ...strings(diagnosis.unknown_facts),
    ...findings.flatMap((finding) => finding.unknownFacts),
    ...Object.entries(ledger ?? {}).filter(([, value]) => record(value)?.status !== "proved").map(([key]) => key),
  ])];
  return <section aria-label={label} className="mt-4 min-w-0 rounded-[0.5rem] border border-amber-300/60 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200" data-testid="model-validation-structural-diagnosis">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h5 className="font-semibold">Why this is inconclusive</h5>
        <p className="mt-1 text-xs">This diagnosis explains the frozen evidence. It does not repair matches, average methods, calibrate a model, choose a winner, create an acceptance threshold, or change the scientific outcome.</p>
      </div>
      <StatusBadge tone="warning">diagnosis only</StatusBadge>
    </div>
    {groups.length ? groups.map((category) => <div key={category} className="mt-3">
      <h6 className="text-xs font-semibold">{CATEGORY_LABELS[category] ?? category.replaceAll("_", " ")}</h6>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
        {findings.filter((finding) => finding.category === category).map((finding, index) => <li key={`${category}-${index}`}>
          {finding.count === null ? "Count unavailable · " : `${finding.count.toLocaleString()} · `}{finding.statement}
        </li>)}
      </ul>
    </div>) : <p className="mt-3 text-xs">No finding statements were recorded here. Review the exact diagnosis below; missing findings are not zero findings.</p>}
    {unknownFacts.length ? <p className="mt-3 break-words text-xs">Evidence ledger still unknown: {unknownFacts.join(", ")}.</p> : null}
    {ledger ? <details className="mt-3 min-w-0 text-xs">
      <summary className="cursor-pointer font-semibold">Recorded comparison-basis facts</summary>
      <dl className="mt-2 grid min-w-0 grid-cols-1 gap-2">
        {Object.entries(ledger).map(([key, value]) => {
          const fact = record(value);
          return <div key={key} className="min-w-0">
            <dt className="font-semibold">{key.replaceAll("_", " ")}</dt>
            <dd className="mt-1 break-all">Status: {String(fact?.status ?? "unknown")} · Value: {typeof fact?.value === "string" ? fact.value : JSON.stringify(fact?.value ?? "unknown")}</dd>
          </div>;
        })}
      </dl>
    </details> : <p className="mt-3 text-xs">A detailed comparison-basis ledger was not recorded here. Absent basis facts remain unknown.</p>}
    <p className="mt-3 break-all font-mono text-[11px]" data-testid="diagnosis-sha256">SHA-256 {sha256 ?? String(diagnosis.diagnosis_sha256 ?? "unknown")}</p>
    <a download href={downloadHref} className="mt-2 inline-flex text-xs font-semibold underline hover:text-foreground">Download exact structural diagnosis</a>
  </section>;
}
