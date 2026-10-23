import { formatGuidedComparisonValue } from "@/lib/models/guided-comparison-results";
import { isModelingClaimStatus, modelingClaimStatusLabel } from "@/lib/models/evidence-backbone";
import type { GuidedComparisonSelectionV1 } from "./guided-comparison";

function esc(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function recordMarkup(label: string, value: unknown) {
  return `<h4>${esc(label)}</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px">${esc(JSON.stringify(value, null, 2))}</pre>`;
}

/** One mandatory section feeds both retained HTML and the existing PDF pipeline. */
export function guidedComparisonReportMarkup(selection: GuidedComparisonSelectionV1 | null | undefined): string {
  if (!selection) return "";
  const p = selection.payload;
  return `<section id="guided-comparison"><h2>Saved baseline and build comparison</h2>
    <p>${esc(p.snapshot.label)}. Snapshot ${esc(p.snapshotId)}. Scenario set ${esc(p.scenarioSet.title)} (${esc(p.scenarioSet.id)}).</p>
    <p>Verified packet binding SHA-256: ${esc(selection.bindingSha256)}.</p>
    ${p.snapshot.summary ? `<p>${esc(p.snapshot.summary)}</p>` : ""}
    ${p.snapshot.narrative ? `<p>${esc(p.snapshot.narrative)}</p>` : ""}
    <ul>${p.caveats.map((caveat) => `<li>${esc(caveat)}</li>`).join("")}</ul>
    ${p.results.map((method) => `<article><h3>${esc(method.methodLabel)}</h3>
      <p>Baseline run ${esc(method.baseline.runId)}. Build run ${esc(method.build.runId)}.</p>
      <table><thead><tr><th scope="col">Metric</th><th scope="col">Unit</th><th scope="col">Baseline</th><th scope="col">Build</th><th scope="col">Build minus baseline</th><th scope="col">Change (%)</th></tr></thead>
      <tbody>${method.metrics.map((metric) => `<tr><th scope="row">${esc(metric.label)}</th><td>${esc(metric.unit)}</td>
        <td>${esc(formatGuidedComparisonValue(metric.baseline, metric.key))}</td><td>${esc(formatGuidedComparisonValue(metric.build, metric.key))}</td>
        <td>${esc(formatGuidedComparisonValue(metric.delta, metric.key))}</td><td>${metric.percentDelta === null ? "Not defined (zero baseline)" : esc(metric.percentDelta.toFixed(1))}</td></tr>`).join("")}</tbody></table>
      ${p.sources.filter((source) => source.method === method.method).map((source) => `<h4>${esc(source.role)} evidence</h4>
        <p>Claim tier: ${esc(modelingClaimStatusLabel(isModelingClaimStatus(source.decision.claim_status) ? source.decision.claim_status : null))}.
        ${esc(source.decision.status_reason ?? "Reason not recorded")} Scientific outcome: ${esc(source.validation.scientific_outcome)}.</p>
        ${recordMarkup("Exact output and solver/network fingerprints", { runId: source.runId, link: source.link, output: source.output })}
        ${recordMarkup("Metric definitions, units and producing custody", source.kpis)}
        ${recordMarkup("Retained input settings and assumptions", source.inputSnapshot)}
        ${recordMarkup("Track-matched decision and exact validation", { decision: source.decision, validation: source.validation, artifacts: source.validationArtifacts })}`).join("")}
      </article>`).join("")}
    ${recordMarkup("Study geometry", p.geography)}
    ${recordMarkup("Baseline and build assumptions", p.entries)}
    ${recordMarkup("Common population identity, exclusions and origin", p.population)}
    ${recordMarkup("Exact retained population package", p.populationArtifacts)}
    </section>`;
}
