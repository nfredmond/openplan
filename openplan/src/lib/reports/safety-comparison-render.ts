import type { SafetyComparisonRecord } from "@/lib/safety/candidate-comparison";
import { SAFETY_V2_NOFO_REFUSAL, describeSafetyComparisonSource } from "@/lib/safety/candidate-comparison";
import { formatProjectEstimate } from "@/lib/projects/estimated-cost";
const escape = (value: unknown) => String(value ?? "Unknown").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function fact(value: { state: string; reason?: string; value?: string; unit?: string | null; source?: string; locator?: string; retainedQuotation?: string; sourceUrl?: string | null; sourceDate?: string | null; retrievedAt?: string | null; spatialTemporalScope?: string; retentionBasis?: string }) {
  return value.state === "unknown" ? `Unknown: ${escape(value.reason)}` : `${escape(value.value)} ${escape(value.unit ?? "")}<br>Source: ${escape(value.source)}; ${escape(value.locator)}<br>Source date: ${escape(value.sourceDate)}; retrieved: ${escape(value.retrievedAt)}<br>Scope: ${escape(value.spatialTemporalScope)}; retention: ${escape(value.retentionBasis)}<br>Retained quotation: ${escape(value.retainedQuotation)}${value.sourceUrl ? `<br>${escape(value.sourceUrl)}` : ""}`;
}
export const SAFETY_COMPARISON_NOTICE = "Input and applicability review. Effects, future No Build conditions, avoided crashes, annualization, monetization and project priority remain unassessed. A recorded match is a planner finding, not qualified scientific transfer. This site review is not a complete safety action plan.";

/** Public derivative contains aggregates and entered source facts, never the internal member list. */
export function renderSafetyComparisonHtml(record: SafetyComparisonRecord): string {
  const { inputs: i, capture: c, costs } = record.payload;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(i.title)}</title><style>body{font:16px/1.5 Arial,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem;color:#17212b}article{border-top:1px solid #999;padding:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}th,td{border:1px solid #aaa;padding:.5rem;text-align:left;vertical-align:top}table{border-collapse:collapse;width:100%}h1,h2,p{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}article{break-inside:avoid}a{color:inherit}}</style></head><body>
<h1>${escape(i.title)}</h1><p>${escape(SAFETY_COMPARISON_NOTICE)}</p>
<p>Site: ${escape(i.siteLabel)}. Review revision ${escape(record.id)}; SHA-256 ${escape(record.content_hash)}. Recorded ${escape(record.created_at)}.</p>
<p>Site identity: ${fact(i.siteIdentity)}</p><p>Influence area: WGS84 longitude/latitude; polygon boundary included. ${escape(i.influenceRationale)}</p>
<details><summary>Retained geometry</summary><pre>${escape(JSON.stringify({ analysis: i.analysisGeometry, influence: i.influenceArea }))}</pre></details>
<h2>Observed mapped membership</h2><p>Requested years: ${escape(i.selectedYears.join(", "))}. Severity predicate: ${escape(i.severities.join(", "))}. Involvement predicate: ${escape(i.involvement)}. Unit: crash.</p>
<p>${escape(describeSafetyComparisonSource(record))}</p>
<p>Acquisition ${escape(record.payload.source.acquisition.id)}; adapter ${escape(record.payload.source.acquisition.source_id)}; retrieved ${escape(record.payload.source.acquisition.created_at)}. Attribution: ${escape(record.payload.source.acquisition.attribution)}. Acquisition metadata SHA-256 ${escape(record.payload.source.acquisitionHash)}. Raw-source hash unavailable.</p>
<p>${c.included} included stored mapped observations; ${c.excluded} excluded; ${c.indeterminate} indeterminate; ${c.stored} stored rows examined. These are not a treatment baseline or casualty count.</p><p>${escape(c.coverageReason)}</p>
<p>Stored membership by reason: ${Object.entries(c.reasonCounts).map(([reason,count]) => `${escape(reason)}: ${count}`).join("; ") || "No stored rows"}.</p>
<p>Member manifest SHA-256 ${escape(c.membersHash)}. Method ${escape(c.method)}. Raw-source hash, complete observation intervals, exposure and road-facility validation are not established by this capture.</p>
<h2>Site facts</h2>${i.siteFacts.length ? i.siteFacts.map(f => `<p><strong>${escape(f.name)}</strong>: ${fact(f.fact)}</p>`).join("") : "<p>No sourced site facts are recorded.</p>"}
<h2>No Build and alternatives</h2>${i.alternatives.map(a => {
    const cost = costs.find(v => v.alternativeId === a.id);
    const amount = cost && typeof cost.amount === "string" && typeof cost.currency === "string" ? formatProjectEstimate(cost.amount, cost.currency) : "Missing";
    const document = cost?.sourceDocument && typeof cost.sourceDocument === "object" ? cost.sourceDocument as Record<string, unknown> : null;
    return `<article><h3>${escape(a.name)} (${escape(a.kind)})</h3><p>Scope: ${escape(a.scope)}. Operating assumptions: ${escape(a.operatingAssumptions)}</p><p>Treatment: ${escape(a.treatmentDescription)}. Proposed time range: ${fact(a.proposedTimeRange)}</p><p>Applicability: ${escape(a.applicability)}. ${escape(a.applicabilityRationale)}</p>${a.conditions.map(condition => `<p>Required condition: ${escape(condition.requiredCondition)}. Finding: ${escape(condition.finding)}. ${escape(condition.rationale)}<br>Site fact: ${fact(condition.siteFact)}</p>`).join("")}
<p>Historical cost: ${escape(amount)}. Price year: ${escape(cost?.priceYear)}. Recorded: ${escape(cost?.recordedAt)}. Scope relationship: ${escape(cost?.scopeRelationship ?? "unknown")}. ${a.cost.kind === "missing" ? escape(a.cost.reason) : escape(a.cost.scopeRationale)}</p>
${a.cost.kind === "project_estimate" ? `<p>Estimating basis: ${fact(a.cost.estimatingBasis)}. Included elements: ${fact(a.cost.includedElements)}. Whole-project costs are contextual unless scope is supported; no normalized comparison is computed.</p>` : ""}
${document ? `<p>Estimate source: <a href="/api/knowledge-base/documents/${escape(document.id)}/download">${escape(document.title)}</a>. Historical checksum ${escape(document.checksum)}. This reference freezes metadata, not document bytes. Current download and access resolve separately; verify the checksum before reuse.</p>` : "<p>Estimate source document: unknown.</p>"}<p>Effect: unassessed. ${escape(a.effectReason)}</p></article>`;
  }).join("")}
<h2>Review findings</h2><p>${escape(i.findings)}</p><p>No score, rank, program selection, adoption or funding decision is produced.</p><h2>SS4A applicability</h2><p>${escape(SAFETY_V2_NOFO_REFUSAL)}</p>
</body></html>`;
}

/** Quote every cell and neutralize spreadsheet formulas. Amounts remain decimal text. */
export function renderSafetyComparisonCsv(record: SafetyComparisonRecord): string {
  const cell = (value: unknown) => { const s = String(value ?? "Unknown"); return `"${(/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"`; };
  const rows: unknown[][] = [["revision_id", "content_sha256", "alternative", "kind", "scope", "applicability", "effect", "amount_decimal_text", "amount_representation", "currency", "price_year", "cost_scope", "basis", "included_elements", "observed_mapped_crashes", "population_coverage", "notice"]];
  for (const a of record.payload.inputs.alternatives) {
    const cost = record.payload.costs.find(c => c.alternativeId === a.id);
    rows.push([record.id, record.content_hash, a.name, a.kind, a.scope, a.applicability, "unassessed", cost ? `'${cost.amount}` : "Unknown", "Leading apostrophe marks decimal text for spreadsheet import; it is not part of the amount.", cost?.currency, cost?.priceYear, cost?.scopeRelationship, a.cost.kind === "project_estimate" ? JSON.stringify(a.cost.estimatingBasis) : a.cost.reason, a.cost.kind === "project_estimate" ? JSON.stringify(a.cost.includedElements) : "Unknown", record.payload.capture.included, "unassessed", SAFETY_COMPARISON_NOTICE]);
  }
  return rows.map(r => r.map(cell).join(",")).join("\r\n");
}
