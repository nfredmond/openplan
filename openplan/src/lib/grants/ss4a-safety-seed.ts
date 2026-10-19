import { safetyPlanPersistenceSchema, sameSafetyRevision, type SafetyPlanPersistence } from "@/lib/reports/safety-plan-persistence";
import { identifySeededCatalogKey } from "./atp-packet";
import { GRANT_PROGRAM_CATALOG } from "./program-catalog";
import { readSafetyPlanSnapshot, safetySeedHash, type SafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { readReportSafetyActionPlan } from "@/lib/reports/safety-action-plan";
import { readReportSafetyIngestSelections } from "@/lib/reports/safety-evidence-selection";
import { SAFETY_SEED_CAVEAT, type SafetySeedProvenance } from "./safety-seed-origin";

export const SS4A_SEED_MIGRATION = "20261018000002_ss4a_safety_seed";
export const SS4A_SECTION_KEYS = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "ss4a")!.applicationSections!.map((section) => section.key);
export const SS4A_SECTION_PROJECTION = "id, workspace_id, opportunity_id, section_key, source, status, final_markdown, finalized_from_draft_id, updated_at";
export const SS4A_REPORT_PROJECTION = "id, workspace_id, project_id, updated_at, metadata_json";
export const SS4A_ARTIFACT_PROJECTION = "id, report_id, generated_at, metadata_json";
export const SS4A_PROJECT_PROJECTION = "id, workspace_id, name, updated_at";
export type SeedSection = { id: string; workspace_id: string; opportunity_id: string; section_key: string; source: string; status: string; final_markdown: string | null; finalized_from_draft_id: string | null; updated_at: string };
export type SeedSourceRows = {
  opportunity: { id: string; workspace_id: string; project_id: string | null; pursuit_kind: string; updated_at: string };
  project: { id: string; workspace_id: string; name: string; updated_at: string };
  report: { id: string; workspace_id: string; project_id: string; updated_at: string; metadata_json: Record<string, unknown> };
  artifact: { id: string; report_id: string; generated_at: string; metadata_json: Record<string, unknown> };
  acquisition: Record<string, unknown>;
  persistence: SafetyPlanPersistence;
  sections: SeedSection[];
  drafts: { id: string; section_id: string }[];
};
export class SafetySeedRefusal extends Error {}

/** Validate the exact selected artifact, never the title or a shared section key. */
export function validateSafetySeedSource(rows: SeedSourceRows): SafetyPlanSnapshot {
  const { opportunity: o, project: p, report: r, artifact: a, acquisition, sections } = rows;
  if (o.pursuit_kind !== "grant" || identifySeededCatalogKey(sections) !== "ss4a") throw new SafetySeedRefusal("Seed from Safety plan requires an unambiguous catalog SS4A grant application.");
  if (SS4A_SECTION_KEYS.some((key) => sections.filter((s) => s.source === "catalog" && s.section_key === key).length !== 1)) throw new SafetySeedRefusal("All six catalog SS4A sections are required. Custom sections cannot substitute.");
  if (!o.project_id || p.id !== o.project_id || p.workspace_id !== o.workspace_id || r.workspace_id !== o.workspace_id || r.project_id !== p.id || a.report_id !== r.id || acquisition.project_id !== p.id || acquisition.status !== "ready" || sections.some((s) => s.workspace_id !== o.workspace_id || s.opportunity_id !== o.id)) throw new SafetySeedRefusal("Safety source must belong to this workspace and this application's exact project, with a ready acquisition.");
  const snapshot = readSafetyPlanSnapshot(a.metadata_json.safetyPlanSnapshotV1);
  if (!snapshot) throw new SafetySeedRefusal("This artifact has no valid versioned Safety snapshot. Regenerate the Safety report, then select the new artifact. HTML cannot be used.");
  const parsedPersistence = safetyPlanPersistenceSchema.safeParse(rows.persistence);
  const persistence = parsedPersistence.success ? parsedPersistence.data : null;
  if (!persistence || persistence.artifact_id !== a.id || persistence.report_id !== r.id || persistence.project_id !== p.id || persistence.workspace_id !== o.workspace_id || persistence.snapshot_hash !== snapshot.hash || !sameSafetyRevision(persistence.source_project_updated_at, snapshot.projectUpdatedAt) || !sameSafetyRevision(persistence.source_report_updated_at, snapshot.reportUpdatedAt) || !sameSafetyRevision(persistence.persisted_project_updated_at, p.updated_at)) {
    throw new SafetySeedRefusal("Safety generation custody is missing, mismatched or stale. Regenerate the report and preview its new artifact.");
  }
  const receipt = a.metadata_json.generationWriteback as Record<string, unknown> | null;
  const plan = readReportSafetyActionPlan(r.metadata_json);
  if (snapshot.artifactId !== a.id || snapshot.reportId !== r.id || snapshot.workspaceId !== o.workspace_id || snapshot.projectId !== p.id || Date.parse(snapshot.generatedAt) !== Date.parse(a.generated_at) || !receipt || receipt.schema !== "openplan.report-generation-writeback.v1" || !sameSafetyRevision(receipt.reportUpdatedAt, r.updated_at) || !sameSafetyRevision(persistence.report_updated_at, r.updated_at) || snapshot.acquisition.id !== acquisition.id || safetySeedHash(snapshot.acquisition) !== safetySeedHash(acquisition) || !plan || safetySeedHash(plan) !== safetySeedHash(snapshot.selection) || plan.ingestId !== acquisition.id || !readReportSafetyIngestSelections(r.metadata_json).some((s) => s.ingestId === acquisition.id)) throw new SafetySeedRefusal("Safety source changed or generation did not finish. Regenerate the report and preview the new artifact.");
  return snapshot;
}

/** Plain text preserves unknown values and candidate status without inferring money or effectiveness. */
export function buildSs4aSafetyDrafts(snapshot: SafetyPlanSnapshot, projectName: string) {
  const { draft } = snapshot;
  const crash = draft.crashSummary.kind === "present"
    ? [`${draft.crashSummary.sourceLabel}; years ${draft.crashSummary.years}.`, ...draft.crashSummary.figures.map((f) => `${f.label}: ${f.value === null ? `not measured or unavailable. ${f.absentBecause}` : f.value}.`), draft.crashSummary.sourceLine, ...draft.crashSummary.caveats].join("\n\n")
    : draft.crashSummary.reason;
  const network = draft.network.kind === "computed"
    ? [draft.network.measureLabel, draft.network.method, draft.network.coverage, `Network years: ${draft.network.years}.`, draft.network.sourceLine,
      ...draft.network.rows.map((r) => `${r.label}: rank ${r.rank}${r.tied ? " (tied)" : ""}; crashes ${r.crashCount}; fatal crashes ${r.fatalCrashCount}; serious-injury crashes ${r.seriousInjuryCrashCount ?? "not measured"}; length ${r.lengthMiles ?? "not measured"} miles; crashes per mile ${r.crashesPerMile ?? "not measured"}.`)].join("\n\n")
    : draft.network.reason;
  const treatments = draft.treatments.length ? draft.treatments.map((t) =>
    `${t.segmentLabel} (${t.rank === null ? "unranked; not in the frozen ranked network" : `network rank ${t.rank}, not a project priority`}). Candidate countermeasures:\n${t.countermeasures.map((c) => `${c.name}: ${c.addresses} Crash types: ${c.crashTypes.join(", ")}. ${c.cmfNote} Source: ${c.sourceUrl}`).join("\n")}`).join("\n\n") : "No candidate countermeasures are recorded in this snapshot. This does not establish that the agency has none.";
  const gaps = draft.components.map((c) => `${c.component} (${c.status} in this Safety draft): ${c.gap}`).join("\n\n");
  const header = [`Working draft for ${projectName}.`, SAFETY_SEED_CAVEAT, draft.draftNotice,
    `Source report: /reports/${snapshot.reportId}#artifact-${snapshot.artifactId}`,
    `Source artifact: /api/reports/${snapshot.reportId}/artifacts/${snapshot.artifactId}/download`,
    `Acquisition: /safety?projectId=${snapshot.projectId}&ingestId=${snapshot.acquisition.id}`,
    `Acquisition ID: ${snapshot.acquisition.id}. Retrieved: ${snapshot.acquisition.created_at}. Artifact generated: ${snapshot.generatedAt}. Snapshot SHA-256: ${snapshot.hash}.`,
  ].join("\n\n");
  const bodies: Record<string, string> = {
    "project-overview": `The selected Safety draft describes evidence for ${projectName}.\n\n${draft.crashSummary.kind === "present" ? `${draft.crashSummary.sourceLabel}; years ${draft.crashSummary.years}.` : draft.crashSummary.reason}\n\n[OPERATOR: Confirm applicant, project limits, award type and proposed scope. These are not established by this Safety snapshot.]`,
    "safety-problem-and-impact": `${crash}\n\n${network}\n\n${treatments}\n\n${draft.countermeasureSourceLine}\n\n[OPERATOR: Review causal claims and expected impacts. No project benefit estimate or engineering effectiveness is computed by this seed.]`,
    "equity-and-underserved-communities": "[OPERATOR: Add sourced equity analysis, community designations and distribution of burdens and benefits. This Safety snapshot does not establish these findings or their absence in agency records.]",
    "engagement-and-collaboration": "[OPERATOR: Add documented engagement, dates, methods, participants, findings and partner commitments. This Safety snapshot does not establish these activities or their absence in agency records.]",
    "implementation-and-capacity": `${treatments}\n\n${draft.countermeasureSourceLine}\n\n[OPERATOR: Develop the project list, delivery roles, capacity, schedule and prioritization. Candidate attachments and network rank do not establish selection or funding commitments.]`,
    "budget-narrative": "[OPERATOR: Enter the approved cost estimate, currency, estimate date, methods, funding sources and match. This snapshot records no typed budget facts. No amounts, costs, currency or benefits have been inferred.]",
  };
  const provenance: SafetySeedProvenance = { kind: "openplan.ss4a-safety-seed.v1", artifactId: snapshot.artifactId, reportId: snapshot.reportId, acquisitionId: String(snapshot.acquisition.id), snapshotHash: snapshot.hash,
    caveat: SAFETY_SEED_CAVEAT, sourceCaveats: [draft.draftNotice, ...(draft.crashSummary.kind === "present" ? [...draft.crashSummary.caveats, ...draft.crashSummary.figures.flatMap((f) => f.value === null && f.absentBecause ? [f.absentBecause] : [])] : [draft.crashSummary.reason]), draft.network.kind === "computed" ? draft.network.coverage : draft.network.reason, gaps, draft.componentSourceLine, draft.countermeasureSourceLine] };
  return SS4A_SECTION_KEYS.map((key) => ({ section_key: key, draft_markdown: `${header}\n\n${bodies[key]}\n\nSnapshot component gaps, not findings of agency absence:\n\n${gaps}\n\n${draft.componentSourceLine}\n\nSource qualifications:\n\n${provenance.sourceCaveats.join("\n\n")}`, provenance }));
}

/** Includes every section revision and every prior draft id so concurrent work conflicts. */
export function buildSafetySeedPreview(rows: SeedSourceRows) {
  const snapshot = validateSafetySeedSource(rows);
  const sections = buildSs4aSafetyDrafts(snapshot, rows.project.name).map((draft) => ({ ...draft, section_id: rows.sections.find((s) => s.source === "catalog" && s.section_key === draft.section_key)!.id }));
  return { artifactId: rows.artifact.id, snapshotHash: snapshot.hash, sections,
    previewHash: safetySeedHash({ version: "ss4a-preview-v1", rows, sections }) };
}
