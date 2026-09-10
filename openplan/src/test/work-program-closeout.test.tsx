import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { randomUUID } from "node:crypto";
import { packetFixture } from "./helpers/owp-reimbursement-fixture";
import { closeoutClaimBalance, closeoutCommandSchema, initialCloseoutAssessment, type CloseoutData, type CloseoutSource } from "@/lib/programs/work-program/closeout";
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
