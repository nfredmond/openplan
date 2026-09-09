/** Create labelled synthetic identity fixtures, then use product routes/RPCs for a reporting case on the named disposable stack. */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { packetFixture } from "../../src/test/helpers/owp-reimbursement-fixture";
async function main() {
const base = "http://127.0.0.1:3253";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58821") throw new Error("Named disposable M2d.3 stack required");
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const withContract = process.env.M2D3_WITH_CONTRACT === "1";
const output = withContract ? "/tmp/m2d3-shared-browser-fixture.json" : "/tmp/m2d3-browser-fixture.json";
if (existsSync(output)) { console.log("Existing synthetic browser fixture retained"); process.exit(0); }
const password = `${randomUUID()}Aa!7`, email = `m2d3-${randomUUID()}@synthetic.example.test`;
const owner = await service.auth.admin.createUser({ email, password, email_confirm: true }); if (owner.error) throw owner.error;
const reviewer = await service.auth.admin.createUser({ email: `m2d3-review-${randomUUID()}@synthetic.example.test`, password, email_confirm: true }); if (reviewer.error) throw reviewer.error;
const workspaceId = randomUUID();
for (const result of [await service.from("workspaces").insert({ id: workspaceId, name: "Synthetic M2d.3 agency", slug: `m2d3-${workspaceId}` }), await service.from("workspace_members").insert([{ workspace_id: workspaceId, user_id: owner.data.user.id, role: "owner" }, { workspace_id: workspaceId, user_id: reviewer.data.user.id, role: "admin" }])]) if (result.error) throw result.error;
const cookies = new Map<string, string>();
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(c => cookies.set(c.name, c.value)) } });
const login = await client.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
async function api(path: string, body: unknown, type = "application/json") {
 const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": type, Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }, body: type === "application/json" ? JSON.stringify(body) : String(body) });
 const data = await response.json(); if (!response.ok) throw new Error(`${path}: ${JSON.stringify(data)}`); return data;
}
const program = await api(`/api/programs?workspaceId=${workspaceId}`, { title: "Synthetic OWP reimbursement cycle", programType: "other", cycleName: "Synthetic 2026-27" });
const programId = program.programId;
const { report, actual, draft } = packetFixture();
let projectId: string | null = null, engagementId: string | null = null, deliverableId: string | null = null;
if (withContract) {
 projectId = randomUUID(); engagementId = randomUUID(); deliverableId = randomUUID(); const clientId = randomUUID();
 for (const result of [
  await service.from("projects").insert({ id: projectId, workspace_id: workspaceId, name: "Synthetic shared OWP work" }),
  await service.from("invoicing_clients").insert({ id: clientId, workspace_id: workspaceId, name: "Synthetic client" }),
  await service.from("invoicing_engagements").insert({ id: engagementId, workspace_id: workspaceId, client_id: clientId, project_id: projectId, title: "Synthetic shared reporting contract" }),
  await service.from("project_deliverables").insert({ id: deliverableId, project_id: projectId, title: "Synthetic draft report" }),
 ]) if (result.error) throw result.error;
 report.snapshot.baseline.content_json.elements[0].projectId = projectId; actual.detail.projectId = projectId;
}
const prepared = await api(`/api/programs/${programId}/work-program`, { expectedRevision: 0, requestId: randomUUID(), draft: report.snapshot.baseline.content_json });
const revision = prepared.revision;
const document = await api(`/api/knowledge-base/documents?workspaceId=${workspaceId}&title=Synthetic%20authority%20evidence&filename=synthetic-authority.txt`, "SYNTHETIC ENGINEERING FIXTURE. No real agency approval. Synthetic reporting baseline reviewed for demonstration on 2026-09-09.", "text/plain");
async function workflow(actor: string, kind: string, expectedSequence: number, extra: Record<string, unknown> = {}) {
 const r = await service.rpc("record_work_program_event", { p_program_id: programId, p_actor_id: actor, p_command: { requestId: randomUUID(), expectedSequence, expectedRevision: 1, revisionId: revision.id, revisionHash: revision.content_sha256, kind, note: "Synthetic engineering fixture only", visibility: "internal", reviewerIds: [], documentIds: [], authority: kind === "adoption" ? "Synthetic board" : "", scope: kind === "adoption" ? "Synthetic test work program" : "", evidenceDate: kind === "adoption" ? "2026-09-09" : null, ...extra } }); if (r.error) throw r.error;
}
await workflow(owner.data.user.id, "submit", 0, { reviewerIds: [reviewer.data.user.id] });
await workflow(reviewer.data.user.id, "approve", 1);
await workflow(owner.data.user.id, "adoption", 2, { documentIds: [document.document.id] });
const staff = await service.from("invoicing_staff").insert({ workspace_id: workspaceId, name: "Synthetic staff", user_id: owner.data.user.id }).select("id").single(); if (staff.error) throw staff.error;
await api(`/api/programs/${programId}/work-program/reporting`, { ...actual.detail, requestId: randomUUID(), revisionId: revision.id, staffId: staff.data.id });
if (withContract) {
 const baselineId = randomUUID(), taskId = report.snapshot.baseline.content_json.elements[0].tasks[0].id;
 async function contract(command: Record<string, unknown>) { const result = await service.rpc("record_contract_command", { p_engagement_id: engagementId, p_actor_id: owner.data.user!.id, p_command: command }); if (result.error) throw result.error; }
 await contract({ kind: "baseline", requestId: randomUUID(), baselineId, expectedVersion: 0, content: { title: "Synthetic agreement", scope: "Engineering fixture only", currency: "USD", fee: "100.00", cost: "100.00", hours: "1.00", feeBasis: "gross_fee", feeTerms: "Synthetic ceiling", sourceDocuments: [document.document.id], approvalEvidence: "", tasks: [{ id: taskId, title: "Draft", scope: "Synthetic work", fee: "100.00", cost: "100.00", hours: "1.00", deadline: "2026-10-01", deliverableId, staff: [] }] } });
 await contract({ kind: "approve", requestId: randomUUID(), baselineId, expectedVersion: 1, approvalEvidence: "Synthetic written authority; not a real agreement" });
 const entryId = randomUUID();
 await api(`/api/programs/${programId}/work-program/reporting`, { ...actual.detail, requestId: randomUUID(), entryId, revisionId: revision.id, kind: "expense", staffId: null, hours: null, amount: "25.00", contractId: engagementId, sourceKey: "synthetic-shared-contract", sourceReference: "Same synthetic vendor cost as the retained M11 valuation", allocations: actual.detail.allocations.map(a => ({ ...a, deliverableId })) });
 const expense = await service.from("work_program_actual_versions").select("id, spend_entry_id").eq("entry_id", entryId).single(); if (expense.error) throw expense.error;
 await contract({ kind: "actual", requestId: randomUUID(), entryId: randomUUID(), expectedVersion: 0, sourceKey: "synthetic-shared-contract", sourceReference: "Same synthetic vendor cost as OWP", entryDate: "2026-08-01", category: "expense", status: "approved", description: "Shared source, not another expense", staffId: null, hours: null, amount: "25.00", valuationBasis: "recorded", rateId: null, billable: false, timeEntryId: null, spendEntryId: expense.data.spend_entry_id, owpVersionId: expense.data.id, allocations: [{ taskId, deliverableId, share: 10000 }], correctionNote: "", openingBasis: "", reconciliationNote: "" });
}
const periodId = randomUUID();
await api(`/api/programs/${programId}/work-program/reporting`, { kind: "period", requestId: randomUUID(), periodId, expectedVersion: 0, name: "Synthetic August reporting", startsOn: "2026-08-01", endsOn: "2026-08-31", baselineId: revision.id, sourceCutoff: new Date().toISOString(), progress: report.snapshot.period.progress, note: "Synthetic fixture, not agency costs" });
await api(`/api/programs/${programId}/work-program/reporting`, { kind: "review", requestId: randomUUID(), periodId, expectedVersion: 1, note: "Synthetic source reconciliation" });
const issued = await api(`/api/programs/${programId}/work-program/reporting`, { kind: "issue", requestId: randomUUID(), periodId, expectedVersion: 2, note: "Synthetic internal report" });
writeFileSync(output, JSON.stringify({ email, password, ownerId: owner.data.user.id, reviewerId: reviewer.data.user.id, workspaceId, programId, projectId, engagementId, periodId, reportId: issued.reportId, fundId: draft.costs[0].shares[0].fundId, matchFundId: draft.costs[0].shares[1].fundId }), { mode: 0o600 });
console.log("Synthetic reporting case retained using product writes; private login fixture stays in /tmp.");

}
main().catch(error => { console.error(error); process.exitCode = 1; });
