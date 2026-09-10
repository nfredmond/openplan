import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { randomUUID } from "node:crypto";
import { packetFixture } from "./helpers/owp-reimbursement-fixture";
import { carryoverAllocations, closeoutRefundBalance, closeoutClaimBalance, closeoutCommandSchema, initialCloseoutAssessment, type CloseoutData, type CloseoutSource } from "@/lib/programs/work-program/closeout";
import { CloseoutPanel } from "@/components/programs/work-program/closeout-panel";

function example(): CloseoutData {
  const { report, actual, draft } = packetFixture();
  const sourceReport = structuredClone(report); delete sourceReport.snapshot.reimbursement;
  const source: CloseoutSource = { report: sourceReport, actuals: [{ ...actual, currency: "USD" }, ...["USD", "EUR"].map(currency => ({ ...actual, id: randomUUID(), entry_id: randomUUID(), currency, source_key: `synthetic-${currency}-receipt`, kind: "payment" as const, amount: "7.00", hours: null, detail: { ...actual.detail, kind: "payment" as const, amount: "7.00", hours: null } }))], successors: [], reimbursement: { claims: [{ id: report.snapshot.reimbursement!.claimId, version: 2, state: "reviewed", current_report_id: report.id, draft }], reports: [report], events: [] } };
  return { source, sourceHash: "a".repeat(64), records: [] };
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe("saved closeout evidence and recovery", () => {
  it("starts amounts and work unassessed and never converts accepted claims to cash", () => {
    const { source } = example(); source.reimbursement.claims[0].state = "accepted";
    const assessment = initialCloseoutAssessment(source);
    expect(assessment.claims[0]).toMatchObject({ receipts: [], refundDue: null, evidence: "" });
    expect(assessment.work[0]).toMatchObject({ disposition: "unassessed", successorRevisionId: null, amount: null });
    expect(closeoutClaimBalance(source, source.reimbursement.claims[0].id, assessment)).toBeNull();
    assessment.claims[0].evidence = "Synthetic bank reconciliation";
    assessment.claims[0].receipts = [{ actualVersionId: randomUUID(), amount: "7.03" }];
    expect(closeoutClaimBalance(source, source.reimbursement.claims[0].id, assessment)).toBe("2.97");
    assessment.claims[0].receipts[0].amount = "11.00";
    expect(closeoutClaimBalance(source, source.reimbursement.claims[0].id, assessment)).toBe("-1.00");
  });
  it("multi carryover reads legacy mappings without changing retry identity and validates allocation amounts", () => {
    const data = example(), assessment = initialCloseoutAssessment(data.source), row = assessment.work[0];
    expect(carryoverAllocations(row)).toEqual([]);
    Object.assign(row, { disposition: "carryover", successorRevisionId: randomUUID(), successorElementId: randomUUID(), sourceFundId: randomUUID(), successorFundId: randomUUID(), amount: "12.30" });
    const before = JSON.stringify(row), allocations = carryoverAllocations(row);
    expect(allocations).toEqual([{ successorRevisionId: row.successorRevisionId, successorElementId: row.successorElementId, sourceFundId: row.sourceFundId, successorFundId: row.successorFundId, amount: "12.30" }]);
    expect(JSON.stringify(row)).toBe(before);
    const command = { kind: "save", requestId: randomUUID(), reportId: data.source.report.id, expectedVersion: 0, sourceHash: data.sourceHash, assessment };
    expect(closeoutCommandSchema.parse(command)).toEqual(command);
    row.allocations = [{ ...allocations[0], amount: "0.001" }];
    expect(closeoutCommandSchema.safeParse(command).success).toBe(false);
    row.allocations[0].amount = "0.00";
    expect(closeoutCommandSchema.parse(command)).toEqual(command);
    expect(carryoverAllocations(row)).toEqual(row.allocations);
    row.allocations = Array.from({ length: 101 }, () => ({ ...allocations[0] }));
    expect(closeoutCommandSchema.safeParse(command).success).toBe(false);
    row.allocations = [];
    expect(carryoverAllocations(row)).toEqual([]);
  });
  it("multi carryover form saves distinct rows, clears dependent choices and supports removal", async () => {
    const data = example(), bodies: unknown[] = [], baseline = data.source.report.snapshot.baseline;
    data.source.successors = [1, 2].map(revision => ({ ...baseline, id: randomUUID(), program_id: randomUUID(), revision, title: `Successor ${revision}`, content_json: { ...baseline.content_json, preparation: { ...baseline.content_json.preparation!, funds: baseline.content_json.preparation!.funds.map(f => ({ ...f, kind: "carryover" as const })) } } }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") { bodies.push(JSON.parse(String(options.body))); return Response.json({ error: "Synthetic retained uncertain save" }, { status: 503 }); }
      return Response.json(data);
    }));
    render(<CloseoutPanel programId={randomUUID()} userId={randomUUID()} reports={[data.source.report]}/>);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Reconciliation source report"), { target: { value: data.source.report.id } });
    await screen.findByLabelText("Work 1 disposition");
    fireEvent.change(screen.getByLabelText("Work 1 disposition"), { target: { value: "carryover" } });
    const set = (n: number, label: string, value: string) => fireEvent.change(screen.getByLabelText(`Work 1 allocation ${n} ${label}`), { target: { value } });
    const target = data.source.successors[0], fund = target.content_json.preparation!.funds[0], element = target.content_json.elements[0];
    set(1, "successor baseline", target.id); set(1, "successor element", element.id); set(1, "source fund", fund.id); set(1, "successor fund", fund.id); set(1, "carryover amount", "12.30");
    fireEvent.click(screen.getByRole("button", { name: "Add carryover allocation to work 1" }));
    set(2, "successor baseline", target.id); set(2, "successor element", element.id); set(2, "source fund", fund.id); set(2, "successor fund", fund.id); set(2, "carryover amount", "7.70");
    set(2, "successor baseline", data.source.successors[1].id);
    expect(screen.getByLabelText("Work 1 allocation 2 successor element")).toHaveValue("");
    expect(screen.getByLabelText("Work 1 allocation 2 successor fund")).toHaveValue("");
    set(2, "successor element", element.id); set(2, "successor fund", fund.id);
    fireEvent.click(screen.getByRole("button", { name: "Add carryover allocation to work 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove allocation 3 from work 1" }));
    expect(screen.queryByLabelText("Work 1 allocation 3 successor baseline")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save reconciliation draft" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ assessment: { work: [{ successorRevisionId: null, successorElementId: null, sourceFundId: null, successorFundId: null, amount: null, allocations: [{ successorRevisionId: target.id, successorElementId: element.id, sourceFundId: fund.id, successorFundId: fund.id, amount: "12.30" }, { successorRevisionId: data.source.successors[1].id, successorElementId: element.id, sourceFundId: fund.id, successorFundId: fund.id, amount: "7.70" }] }] } });
  });
  it("refund matching preserves unknown, partial and excess disbursements separately from receipts", () => {
    const { source } = example(), assessment = initialCloseoutAssessment(source), row = assessment.claims[0];
    expect(closeoutRefundBalance(row)).toBeNull();
    row.refundDue = "6.00"; expect(closeoutRefundBalance(row)).toBeNull();
    row.evidence = "Synthetic outgoing payment reference";
    expect(closeoutRefundBalance(row)).toBe("6.00");
    row.refundPayments = [{ actualVersionId: randomUUID(), amount: "4.01" }];
    expect(closeoutRefundBalance(row)).toBe("1.99");
    expect(closeoutClaimBalance(source, row.claimId, assessment)).toBe("10.00");
    row.refundPayments[0].amount = "7.00";
    expect(closeoutRefundBalance(row)).toBe("-1.00");
    row.refundDue = null; expect(closeoutRefundBalance(row)).toBeNull();
  });
  it("refund matching retains legacy retry payloads and validates exact amounts", () => {
    const data = example(), command = { kind: "save", requestId: randomUUID(), reportId: data.source.report.id, expectedVersion: 0, sourceHash: data.sourceHash, assessment: initialCloseoutAssessment(data.source) };
    expect(closeoutCommandSchema.parse(command)).toEqual(command);
    command.assessment.claims[0].refundPayments = [{ actualVersionId: randomUUID(), amount: "0.001" }];
    expect(closeoutCommandSchema.safeParse(command).success).toBe(false);
    command.assessment.claims[0].refundPayments[0].amount = "4.01";
    expect(closeoutCommandSchema.parse(command)).toEqual(command);
  });
  it("refund matching sends the selected payment and amount and can remove a match", async () => {
    const data = example(), bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") { bodies.push(JSON.parse(String(options.body))); return Response.json({ version: 1 }); }
      return Response.json(data);
    }));
    render(<CloseoutPanel programId={randomUUID()} userId={randomUUID()} reports={[data.source.report]}/>);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Reconciliation source report"), { target: { value: data.source.report.id } });
    await screen.findByRole("button", { name: "Match refund payment to claim 1" });
    fireEvent.click(screen.getByRole("button", { name: "Match refund payment to claim 1" }));
    expect(screen.queryByRole("option", { name: /synthetic-EUR-receipt/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Claim 1 refund payment 1"), { target: { value: data.source.actuals[1].id } });
    expect(screen.getByText(`Payment reference: ${data.source.actuals[1].detail.sourceReference}`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Claim 1 refund payment 1 amount"), { target: { value: "4.00" } });
    fireEvent.change(screen.getByLabelText("Claim 1 refund due (blank means unknown)"), { target: { value: "6.00" } });
    fireEvent.change(screen.getByLabelText("Claim 1 reconciliation evidence"), { target: { value: "Synthetic outgoing reference" } });
    expect(screen.getByText(/Assessed refund less matched outbound payments: 2.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save reconciliation draft" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ kind: "save", assessment: { claims: [{ refundPayments: [{ actualVersionId: data.source.actuals[1].id, amount: "4.00" }], refundDue: "6.00", evidence: "Synthetic outgoing reference" }] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Match refund payment to claim 1" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Match refund payment to claim 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove refund payment 1 from claim 1" }));
    expect(screen.queryByLabelText("Claim 1 refund payment 1")).not.toBeInTheDocument();
  });
  it("rejects malformed money and unapproved command fields", () => {
    const data = example(); const command = { kind: "save", requestId: randomUUID(), reportId: data.source.report.id, expectedVersion: 0, sourceHash: data.sourceHash, assessment: initialCloseoutAssessment(data.source) };
    expect(closeoutCommandSchema.safeParse(command).success).toBe(true);
    command.assessment.claims[0].refundDue = "0.001";
    expect(closeoutCommandSchema.safeParse(command).success).toBe(false);
    expect(closeoutCommandSchema.safeParse({ ...command, kind: "approve", assessment: undefined, note: "", actorId: randomUUID() }).success).toBe(false);
  });
  it("retains an uncertain save across remount and retries exactly once without allowing a second command", async () => {
    const data = example(), programId = randomUUID(), userId = randomUUID(), bodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") { bodies.push(String(options.body)); return Response.json({ error: "Synthetic interrupted response" }, { status: 503 }); }
      return Response.json(data);
    }); vi.stubGlobal("fetch", fetcher);
    const view = render(<CloseoutPanel programId={programId} userId={userId} reports={[data.source.report]}/>);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Reconciliation source report"), { target: { value: data.source.report.id } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save reconciliation draft" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save reconciliation draft" }));
    await screen.findByText("Synthetic interrupted response");
    expect(screen.getByRole("button", { name: "Save reconciliation draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save reconciliation approval" })).toBeDisabled();
    view.unmount();
    render(<CloseoutPanel programId={programId} userId={userId} reports={[data.source.report]}/>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry reconciliation save" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry reconciliation save" }));
    await waitFor(() => expect(bodies).toHaveLength(2)); expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(localStorage.getItem(`owp-closeout-pending:${userId}:${programId}`)!)).toEqual(JSON.parse(bodies[0]));
  });
  it("requires a saved current assessment for approval and hides private exports after a failed reload", async () => {
    const data = example();
    data.records = [{ id: randomUUID(), version: 1, state: "draft", report_id: data.source.report.id, source_hash: data.sourceHash, content_hash: "b".repeat(64), actor_id: randomUUID(), created_at: "2026-09-09T00:00:00Z", content: { source: data.source, assessment: initialCloseoutAssessment(data.source), note: "" } }];
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(data)).mockResolvedValueOnce(Response.json({ error: "Synthetic history unavailable" }, { status: 503 })).mockImplementation(async () => Response.json(data)); vi.stubGlobal("fetch", fetcher);
    render(<CloseoutPanel programId={randomUUID()} userId={randomUUID()} reports={[data.source.report]}/>);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Reconciliation source report"), { target: { value: data.source.report.id } });
    await screen.findByRole("button", { name: "Save reconciliation version 1 JSON" });
    fireEvent.change(screen.getByLabelText("Reconciliation approval or reopening evidence"), { target: { value: "Synthetic authority" } });
    expect(screen.getByRole("button", { name: "Save reconciliation approval" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Match receipt to claim 1" }));
    expect(screen.getByRole("option", { name: /synthetic-USD-receipt/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /synthetic-EUR-receipt/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Register completeness and reconciliation evidence"), { target: { value: "Unsaved edits" } });
    expect(screen.getByRole("button", { name: "Save reconciliation approval" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload reconciliation" }));
    await screen.findByText("Synthetic history unavailable");
    expect(screen.queryByRole("button", { name: "Save reconciliation version 1 JSON" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save reconciliation approval" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload reconciliation" }));
    await screen.findByRole("button", { name: "Save reconciliation version 1 JSON" });
    expect(screen.queryByText("Synthetic history unavailable")).not.toBeInTheDocument();
  });
  it("closes separately from approval, retains uncertain decisions and requires period reopening before correction", async () => {
    const data = example(), programId = randomUUID(), userId = randomUUID(), bodies: Record<string, unknown>[] = [];
    const record = { id: randomUUID(), version: 2, state: "approved" as const, report_id: data.source.report.id, source_hash: data.sourceHash, content_hash: "b".repeat(64), actor_id: userId, created_at: "2026-09-09T00:00:00Z", content: { source: data.source, assessment: initialCloseoutAssessment(data.source), note: "Synthetic approval" } };
    data.records = [record]; data.closures = [];
    let loseResponse = true;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const command = JSON.parse(String(options.body)); bodies.push(command);
        if (loseResponse) { loseResponse = false; return Response.json({ error: "Synthetic lost closure response" }, { status: 503 }); }
        data.closures = [{ id: randomUUID(), period_id: data.source.report.period_id, version: 1, kind: "close_period", starts_on: "2026-07-01", ends_on: "2026-08-31", reconciliation_id: record.id, content: { note: "Synthetic closure authority" }, content_hash: "c".repeat(64), actor_id: userId, created_at: "2026-09-09T00:00:00Z" }];
        return Response.json({ version: 1 });
      }
      return Response.json(data);
    }));
    const view = render(<CloseoutPanel programId={programId} userId={userId} reports={[data.source.report]}/>);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Reconciliation source report"), { target: { value: data.source.report.id } });
    await screen.findByRole("button", { name: "Close accounting period" });
    expect(screen.getByRole("button", { name: "Close accounting period" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reconciliation approval or reopening evidence"), { target: { value: "Synthetic closure authority" } });
    fireEvent.click(screen.getByRole("button", { name: "Close accounting period" }));
    await screen.findByText("Synthetic lost closure response");
    expect(screen.getByRole("button", { name: "Close accounting period" })).toBeDisabled();
    expect(bodies[0]).toMatchObject({ kind: "close_period", expectedClosureVersion: 0, expectedVersion: 2, sourceHash: data.sourceHash, reportId: record.report_id });
    view.unmount();
    render(<CloseoutPanel programId={programId} userId={userId} reports={[data.source.report]}/>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry reconciliation save" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry reconciliation save" }));
    await screen.findByRole("button", { name: "Reopen accounting period" });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(screen.getByRole("button", { name: "Reopen approved reconciliation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save reconciliation draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save period decision 1 JSON" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reconciliation approval or reopening evidence"), { target: { value: "Synthetic authorized correction" } });
    expect(screen.getByRole("button", { name: "Reopen approved reconciliation" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reopen accounting period" }));
    await waitFor(() => expect(bodies[2]).toMatchObject({ kind: "reopen_period", expectedClosureVersion: 1, note: "Synthetic authorized correction" }));
  });
});
