import { randomUUID } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportingPanel } from "@/components/programs/work-program/reporting-panel";
import type { PeriodReport } from "@/lib/programs/work-program/reporting";
import { ReimbursementPanel } from "@/components/programs/work-program/reimbursement-panel";
import { CloseoutReview } from "@/components/programs/work-program/closeout-review";
import { reviewWorkProgramCloseout, type CloseoutHistory } from "@/lib/programs/work-program/closeout-review";
import { packetFixture } from "./helpers/owp-reimbursement-fixture";
import { downloadText } from "@/lib/export/download";
vi.mock("@/lib/export/download", () => ({ downloadText: vi.fn() }));
function closeoutFixture() {
  const { report: original, draft } = packetFixture();
  const corrected: PeriodReport = structuredClone(original);
  corrected.id = randomUUID(); corrected.snapshot_hash = "d".repeat(64);
  corrected.corrects_report_id = original.id;
  corrected.snapshot.reimbursement!.packetVersion = 2;
  corrected.snapshot.reimbursement!.reimbursementTotal = "9.00";
  const source: PeriodReport = structuredClone(original);
  source.id = draft.reportId;
  delete source.snapshot.reimbursement;
  const history: CloseoutHistory = {
    claims: [{ id: original.snapshot.reimbursement!.claimId, version: 8, state: "accepted", draft, current_report_id: corrected.id }],
    reports: [original, corrected],
    events: [{ id: randomUUID(), claim_id: original.snapshot.reimbursement!.claimId, sequence: 8, kind: "accept", report_id: corrected.id, note: "Synthetic acceptance evidence, no payment", actor_id: randomUUID(), created_at: "2026-09-09T00:00:00Z" }],
  };
  return { source, original, corrected, history };
}
describe("OWP closeout review boundaries", () => {
  it("uses one corrected request and leaves acceptance, commitments and refunds unreconciled", () => {
    const { source, history } = closeoutFixture();
    const before = JSON.stringify({ source, history });
    const review = reviewWorkProgramCloseout(source, history);
    expect(review.claims.map(claim => claim.retainedRequest)).toEqual(["9.00"]);
    expect(review.claims[0].balanceDue).toBeNull();
    expect(review.claims[0].evidence[0].note).toContain("no payment");
    expect(review.recorded.incurred).toBe("12.35");
    expect(review.outstandingCommitments).toBeNull();
    expect(review.refundsDue).toBeNull();
    expect(review.approvedCarryover).toBeNull();
    expect(review.status).toBe("unapproved_closeout_review");
    expect(review.fullCycleThrough).toBe(false);
    expect(review.baselineHash).toBe(source.snapshot.baseline.content_sha256);
    expect(JSON.stringify({ source, history })).toBe(before);
  });
  it.each(["id", "hash", "currency", "claim", "missing"])("keeps a %s mismatch unresolved instead of mixing another baseline or claim", fault => {
    const { source, corrected, history } = closeoutFixture();
    if (fault === "id") corrected.snapshot.baseline.id = randomUUID();
    if (fault === "hash") corrected.snapshot.baseline.content_sha256 = "e".repeat(64);
    if (fault === "currency") corrected.snapshot.baseline.content_json.currency = "EUR";
    if (fault === "claim") corrected.snapshot.reimbursement!.claimId = randomUUID();
    if (fault === "missing") history.reports = [];
    const review = reviewWorkProgramCloseout(source, history);
    expect(review.claims[0].baselineMatches).toBe(false);
    expect(review.claims[0].retainedRequest).toBeNull();
    expect(review.claims[0].balanceDue).toBeNull();
  });
  it("refuses cumulative duplicate sources and unissued or reimbursement snapshots", () => {
    const { source, original, history } = closeoutFixture();
    expect(() => reviewWorkProgramCloseout(original, history)).toThrow("issued management report");
    source.snapshot.workingPreview = true;
    expect(() => reviewWorkProgramCloseout(source, history)).toThrow("issued management report");
    delete source.snapshot.workingPreview;
    source.snapshot.actuals.push(structuredClone(source.snapshot.actuals[0]));
    expect(() => reviewWorkProgramCloseout(source, history)).toThrow("repeats a physical source");
  });
  it("retains unknown unfinished estimates and exact amounts without promoting carryover", () => {
    const { source, history } = closeoutFixture();
    const actual = source.snapshot.actuals[0];
    actual.kind = "commitment"; actual.amount = "999999999999.99";
    actual.allocations[0].amount = actual.amount;
    source.snapshot.period.progress[0].remainingCost = null;
    const review = reviewWorkProgramCloseout(source, history);
    expect(review.recorded.commitments).toBe("999999999999.99");
    expect(review.recorded.incurred).toBe("0.00");
    expect(review.unfinishedWork[0].remainingEstimate).toBeNull();
    expect(review.unfinishedWork[0].successorElementId).toBeNull();
    expect(review.unfinishedWork[0].carryoverApproval).toBeNull();
  });
  it("withholds an export when history is unavailable and exports exact retained inputs after recovery", () => {
    const { source, history } = closeoutFixture();
    const view = render(<CloseoutReview reports={[source]} history={null}/>);
    fireEvent.change(screen.getByLabelText("Closeout source report"), { target: { value: source.id } });
    expect(screen.getByText(/history is unavailable or loading/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save private closeout review JSON" })).not.toBeInTheDocument();
    view.rerender(<CloseoutReview reports={[source]} history={history}/>);
    expect(screen.getByText(/Outstanding balance: Unknown/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save private closeout review JSON" }));
    const exported = JSON.parse(vi.mocked(downloadText).mock.calls.at(-1)![0]);
    expect(exported.sourceReport).toEqual(source);
    expect(exported.reimbursementHistory).toEqual(history);
    expect(exported.review.claims[0].retainedRequest).toBe("9.00");
    view.rerender(<CloseoutReview reports={[source]} history={null}/>);
    expect(screen.queryByText(/Outstanding balance: Unknown/)).not.toBeInTheDocument();
  });
  it("withdraws a displayed review if reloading reimbursement history fails", async () => {
    const { source, history } = closeoutFixture();
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => history })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Synthetic interrupted history read" }) });
    vi.stubGlobal("fetch", fetcher);
    try {
      render(<ReimbursementPanel programId={randomUUID()} userId={randomUUID()} reports={[source]}/>);
      await screen.findByRole("button", { name: "Synthetic packet · accepted" });
      fireEvent.change(screen.getByLabelText("Closeout source report"), { target: { value: source.id } });
      expect(screen.getByRole("button", { name: "Save private closeout review JSON" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Reload packet history" }));
      await screen.findByText("Synthetic interrupted history read");
      expect(screen.queryByRole("button", { name: "Save private closeout review JSON" })).not.toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([false, true])("shows closeout navigation only with manager access: %s", async canManage => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ canManage, revisions: [] }) }));
    try {
      render(<ReportingPanel programId={randomUUID()} workspaceId={randomUUID()} userId={randomUUID()}/>);
      await screen.findByText(/Save a preparation revision below/);
      expect(screen.queryByRole("link", { name: "Closeout review" }) !== null).toBe(canManage);
      expect(screen.queryByRole("link", { name: "Saved reconciliation" }) !== null).toBe(canManage);
    } finally { vi.unstubAllGlobals(); }
  });

});
