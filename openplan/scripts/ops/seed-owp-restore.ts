/** Synthetic two-cycle fixture for the owned disposable restore drill. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { workProgramDraftSchema, type WorkProgramDraft } from "../../src/lib/programs/work-program/schema";
import { emptyStructuredPreparation } from "../../src/lib/programs/work-program/reconciliation";
import type { CloseoutData, CloseoutAssessment } from "../../src/lib/programs/work-program/closeout";

const api = process.env.RESTORE_API_URL!;
const key = process.env.RESTORE_SERVICE_KEY!;
const owner = process.env.RESTORE_OWNER_ID!;
const workspace = "00000000-0000-4000-8000-00000000000a";
const project = "00000000-0000-4000-8000-00000000000b";
const document = "00000000-0000-4000-8000-00000000000d";
const client = createClient(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
const note = "SYNTHETIC recovery fixture. No actual agency decision, eligibility or bank transaction.";

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.code}: ${error.message}`);
  return data as T;
}
async function insert(table: string, values: Record<string, unknown>) {
  const { error } = await client.from(table).insert(values);
  if (error) throw new Error(`${table}: ${error.message}`);
}
type Revision = { id: string; revision: number; content_sha256: string };
type Cycle = { program: string; element: string; task: string; funds: string[]; revision: Revision };

async function createCycle(title: string, start: string, end: string, amounts: number[], reviewer: string): Promise<Cycle> {
  const program = randomUUID(), element = randomUUID(), task = randomUUID();
  const preparation = emptyStructuredPreparation();
  const funds = amounts.map(() => randomUUID());
  preparation.funds = funds.map((id, i) => ({ id, sourceRefs: [], name: `Synthetic fund ${i+1}`, vintage: start.slice(0,4), periodStart: start, periodEnd: end, kind: i ? "match" : "carryover", amount: amounts[i], basis: "proposed", note }));
  preparation.allocations = funds.map((fundId, i) => ({ id: randomUUID(), sourceRefs: [], elementId: element, taskId: task, fundId, amount: amounts[i], matchForFundId: null, note }));
  preparation.costs = [{ id: randomUUID(), sourceRefs: [], elementId: element, taskId: task, label: "Synthetic work allowance", category: "direct", amount: amounts.reduce((a,b)=>a+b,0), contractId: null, indirectPoolId: null, note }];
  const draft: WorkProgramDraft = workProgramDraftSchema.parse({ schemaVersion: 1, documentKind: "agency_work_program", agency: "Synthetic restore agency", responsibleAuthority: "Synthetic test authority", authorityBasis: note, periodStart: start, periodEnd: end, introduction: note, staffing: note, financialNotes: note, currency: "USD", priorBalance: null, priorBalanceBasis: "Unassessed in synthetic fixture", preparation,
    elements: [{ id: element, source: null, code: "WE-01", title: "Retained unfinished work", disposition: "new", decisionNote: note, objective: note, discussion: note, responsible: "Synthetic test agency", schedule: `${start} through ${end}`, personMonths: null, budgetTreatment: "included", budgetTreatmentNote: "", tasks: [{ id: task, description: "Finish the synthetic analysis", responsible: "Synthetic staff", schedule: end }], products: [], budget: [], projectId: project }] });
  await insert("programs", { id: program, workspace_id: workspace, title, program_type: "other", cycle_name: `${start} / ${end}` });
  const revision = await rpc<Revision>("save_program_work_program_revision", { p_program_id: program, p_actor_id: owner, p_expected_revision: 0, p_request_id: randomUUID(), p_content: draft });
  let sequence = 0;
  for (const kind of ["submit", "approve", "adoption"] as const) {
    const command = { kind, requestId: randomUUID(), expectedSequence: sequence, expectedRevision: revision.revision, revisionId: revision.id, revisionHash: revision.content_sha256, note, visibility: "internal", reviewerIds: kind === "submit" ? [reviewer] : [], documentIds: kind === "adoption" ? [document] : [], ...(kind === "adoption" ? { authority: "Synthetic test board", scope: note, evidenceDate: "2026-09-01" } : {}) };
    await rpc("record_work_program_event", { p_program_id: program, p_actor_id: kind === "approve" ? reviewer : owner, p_command: command });
    sequence++;
  }
  return { program, element, task, funds, revision };
}

async function main() {
  // The shell creates this exact workspace in a new local source stack first.
  const { data: existing, error } = await client.from("workspaces").select("slug").eq("id", workspace).single();
  assert.ifError(error); assert.equal(existing?.slug, "restore-probe");
  const reviewer = randomUUID();
  const created = await client.auth.admin.createUser({ email: `reviewer-${reviewer}@openplan.test`, password: randomUUID()+randomUUID(), email_confirm: true });
  assert.ifError(created.error); assert(created.data.user);
  const reviewerId = created.data.user.id;
  await insert("workspace_members", { workspace_id: workspace, user_id: reviewerId, role: "admin" });
  const staff = randomUUID();
  await insert("invoicing_staff", { id: staff, workspace_id: workspace, name: "Synthetic restore staff", user_id: owner });
  const old = await createCycle("Synthetic prior fiscal cycle", "2026-07-01", "2027-06-30", [100, 20], reviewerId);
  const next = await createCycle("Synthetic overlapping calendar cycle", "2027-01-01", "2027-12-31", [30], reviewerId);
  const actuals: Record<string, { id: string; entryId: string; command: Record<string, unknown> }> = {};
  async function actual(cycle: Cycle, label: string, kind: string, amount: string, date: string) {
    const entryId = randomUUID();
    const command = { requestId: randomUUID(), entryId, expectedVersion: 0, revisionId: cycle.revision.id, kind, status: "approved", entryDate: date, sourceKey: `restore-${label}`, sourceReference: note, description: `Synthetic ${label}`, staffId: kind === "labor" ? staff : null, projectId: project, contractId: null, hours: kind === "labor" ? "1.00" : null, amount, basis: "recorded", allocations: [{ elementId: cycle.element, taskId: cycle.task, share: 10000 }] };
    const result = await rpc<{ id: string }>("record_work_program_actual", { p_program_id: cycle.program, p_actor_id: owner, p_command: command });
    assert.deepEqual(await rpc("record_work_program_actual", { p_program_id: cycle.program, p_actor_id: owner, p_command: command }), result);
    const { data: row, error } = await client.from("work_program_actual_versions").select("id").eq("entry_id", entryId).single();
    assert.ifError(error); assert(row);
    actuals[label] = { id: row.id, entryId, command };
    return row.id as string;
  }
  const oldCost = await actual(old, "old-cost", "labor", "12.35", "2026-08-01");
  const obligation = await actual(old, "commitment", "commitment", "40.00", "2026-08-01");
  const receipt = await actual(old, "receipt", "payment", "7.00", "2026-08-15");
  const refund = await actual(old, "refund", "payment", "5.00", "2026-09-05");
  async function report(cycle: Cycle, startsOn: string, endsOn: string) {
    const periodId = randomUUID();
    await rpc("work_program_management_command", { p_program_id: cycle.program, p_actor_id: owner, p_command: { kind: "period", requestId: randomUUID(), periodId, expectedVersion: 0, name: "Synthetic retained reporting period", startsOn, endsOn, baselineId: cycle.revision.id, sourceCutoff: new Date().toISOString(), progress: [{ elementId: cycle.element, taskId: cycle.task, asOf: endsOn, completed: "Draft work retained", outstanding: "Unfinished analysis remains", remainingHours: null, remainingCost: null, estimateBasis: "Unassessed synthetic remainder" }] } });
    await rpc("work_program_management_command", { p_program_id: cycle.program, p_actor_id: owner, p_command: { kind: "review", requestId: randomUUID(), periodId, expectedVersion: 1, note } });
    const command = { kind: "issue", requestId: randomUUID(), periodId, expectedVersion: 2, note };
    const result = await rpc<{ reportId: string }>("work_program_management_command", { p_program_id: cycle.program, p_actor_id: owner, p_command: command });
    assert.deepEqual(await rpc("work_program_management_command", { p_program_id: cycle.program, p_actor_id: owner, p_command: command }), result);
    return { periodId, reportId: result.reportId };
  }
  const oldReport = await report(old, "2026-08-01", "2026-08-31");
  async function claim(cycle: Cycle, reportId: string, costId: string, eligible: string, reimbursement: string) {
    const claimId = randomUUID();
    const shares = [{ fundId: cycle.funds[0], amount: reimbursement, treatment: "reimbursement", evidence: note }, ...(cycle.funds[1] ? [{ fundId: cycle.funds[1], amount: "2.35", treatment: "match", evidence: note }] : [])];
    await rpc("work_program_reimbursement_command", { p_program_id: cycle.program, p_actor_id: owner, p_command: { kind: "save", requestId: randomUUID(), claimId, expectedVersion: 0, draft: { reportId, title: "Synthetic recovery claim", authorityEvidence: note, formEvidence: note, costs: [{ actualVersionId: costId, eligibleAmount: eligible, eligibilityEvidence: note, shares }] } } });
    const packet = await rpc<{ reportId: string }>("work_program_reimbursement_command", { p_program_id: cycle.program, p_actor_id: owner, p_command: { kind: "review", requestId: randomUUID(), claimId, expectedVersion: 1, note } });
    return { claimId, packetId: packet.reportId };
  }
  const oldClaim = await claim(old, oldReport.reportId, oldCost, "12.35", "10.00");
  const closeArgs = { p_program_id: old.program, p_actor_id: owner, p_report_id: oldReport.reportId };
  const source = await rpc<CloseoutData>("read_work_program_closeout", closeArgs);
  const assessment: CloseoutAssessment = { registerEvidence: note, claims: [{ claimId: oldClaim.claimId, receipts: [{ actualVersionId: receipt, amount: "7.00" }], refundDue: "6.00", refundPayments: [{ actualVersionId: refund, amount: "5.00" }], evidence: note }], commitments: [{ actualVersionId: obligation, outstandingAmount: "15.00", evidence: note }], work: [{ elementId: old.element, disposition: "carryover", successorRevisionId: null, successorElementId: null, sourceFundId: null, successorFundId: null, amount: null, allocations: [{ successorRevisionId: next.revision.id, successorElementId: next.element, sourceFundId: old.funds[0], successorFundId: next.funds[0], amount: "20.00" }], evidence: note }] };
  let version = 0;
  async function close(kind: string, extra: Record<string, unknown> = {}) {
    const result = await rpc("work_program_closeout_command", { p_program_id: old.program, p_actor_id: owner, p_command: { kind, requestId: randomUUID(), reportId: oldReport.reportId, expectedVersion: version, sourceHash: source.sourceHash, ...(kind === "save" ? { assessment } : { note }), ...extra } });
    version++;
    return result;
  }
  await close("save"); await close("approve");
  const original = (await rpc<CloseoutData>("read_work_program_closeout", closeArgs)).records.at(-1)!;
  await close("reopen"); assessment.work[0].allocations![0].amount = "19.00";
  await close("save"); await close("approve");
  const corrected = await rpc<CloseoutData>("read_work_program_closeout", closeArgs);
  assert.deepEqual(corrected.records.find(row=>row.id===original.id), original);
  await rpc("work_program_period_closure_command", { p_program_id: old.program, p_actor_id: owner, p_command: { kind: "close_period", requestId: randomUUID(), reportId: oldReport.reportId, expectedVersion: version, expectedClosureVersion: 0, sourceHash: source.sourceHash, note } });
  const newCost = await actual(next, "successor-cost", "labor", "8.00", "2027-01-05");
  const duplicate = await client.rpc("record_work_program_actual", { p_program_id: next.program, p_actor_id: owner, p_command: { ...actuals["successor-cost"].command, requestId: randomUUID(), entryId: randomUUID(), sourceKey: "restore-old-cost" } });
  assert.equal(duplicate.error?.code, "PT409"); assert.match(duplicate.error?.message ?? "", /Source already recorded/);
  const nextReport = await report(next, "2027-01-01", "2027-01-31");
  const nextClaim = await claim(next, nextReport.reportId, newCost, "8.00", "8.00");
  const retained = await rpc<CloseoutData>("read_work_program_closeout", closeArgs);
  assert.deepEqual(retained.records, corrected.records);
  writeFileSync(process.argv[2], JSON.stringify({ synthetic: true, workspace, owner, old, next, oldReport, nextReport, oldClaim, nextClaim, actuals, originalApproval: original.id, correctedApproval: corrected.records.at(-1)!.id, expected: { originalCarryover: "20.00", currentCarryover: "19.00", priorUnpaidClaim: "3.00", successorClaimRequest: "8.00", outstandingCommitment: "15.00", refundRemaining: "1.00", incurredAcrossCycles: "20.35", physicalEntries: 5 }, sourceDuplicateRefused: true }, null, 2)+"\n", { mode: 0o600 });
  console.log("[restore-drill] two overlapping OWP cycles seeded through workflow commands; old approval and unresolved claim retained");
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
