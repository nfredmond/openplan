import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { deliveryFixture } from "./fixtures/contract-delivery";
import { accountingHandoffRows, type CloseoutPackage } from "@/lib/invoicing/contracts/closeout-export";
import { contractSnapshotTables } from "@/lib/invoicing/contracts/export";
import type { ContractSnapshot, ContractState } from "@/lib/invoicing/contracts/schema";

/**
 * KI-2026-10-12-007, second limit. Voiding a draft contract invoice keeps its
 * billing source row as history, and the same work may then be billed on a new
 * invoice (KI-2026-10-12-005). Contract exports listed both rows, so the work
 * read as billed twice. Exports now leave out sources on a voided invoice and
 * keep a source whose invoice the state does not list.
 */
function fixture() {
  const f = deliveryFixture();
  const entry = randomUUID(), version = randomUUID(), voided = randomUUID(), reissued = randomUUID(), unlisted = randomUUID();
  const invoice = (id: string, number: string, status: string) => ({ id, invoice_number: number, status, subtotal_amount: "120.00", retention_amount: "0.00", currency_code: "USD", invoice_date: "2026-09-05", sent_date: status === "sent" ? "2026-09-06" : null, updated_at: "2026-09-06T00:00:00Z" });
  const source = (invoiceId: string, lineId: string) => ({ id: randomUUID(), entry_id: entry, actual_version_id: version, invoice_id: invoiceId, billing_rate_id: null, lines: [{ lineId, taskId: f.task, deliverableId: f.review, amount: "120.00", hours: "1.00", share: 10000 }] });
  const ids = { voidLine: randomUUID(), sentLine: randomUUID(), unlistedLine: randomUUID() };
  const state: ContractState = {
    ...f.state,
    invoices: [invoice(voided, "SYNTH-VOID-1", "void"), invoice(reissued, "SYNTH-2", "sent")],
    billingSources: [source(voided, ids.voidLine), source(reissued, ids.sentLine), source(unlisted, ids.unlistedLine)],
  };
  return { f, state, voided, reissued, unlisted, ids };
}

const allocationInvoices = (state: ContractState) => {
  const report: ContractSnapshot = { id: randomUUID(), title: "Synthetic", created_at: "2026-09-08", snapshot_hash: "f".repeat(64), snapshot: { ...state, asOf: "2026-09-08", sourceCutoff: "2026-09-08T12:00:00Z", coverageComplete: true, coverageEvidence: "Synthetic", baselineId: state.baselines[0].id, originalBaselineId: state.baselines[0].id } };
  const table = contractSnapshotTables(report).find((t) => t.name === "Billing source allocations")!;
  return table.rows.slice(1).map((row) => row[0]);
};

const handoffLines = (state: ContractState) => {
  const pkg: CloseoutPackage = { formatVersion: 3, state, request: { asOf: "2026-09-08" }, position: { invoices: [], workAccepted: false, financialSettled: false, incurred: "120.00", authorizedCost: "500.00", underspend: "380.00", commitments: "0.00", warnings: [], openObligations: 0 } };
  return accountingHandoffRows(pkg).filter((row) => row[0] === "outgoing_billing_allocation").map((row) => [row[1], row[6]]);
};

describe("contract exports and voided draft billing sources", () => {
  it("lists the reissued invoice's source once and leaves out the voided draft's source in the snapshot tables", () => {
    const { state, voided, reissued, unlisted } = fixture();
    expect(allocationInvoices(state)).toEqual([reissued, unlisted]);
    expect(allocationInvoices(state)).not.toContain(voided);
  });

  it("leaves the voided draft's allocation out of the accounting handoff and keeps the invoice record in the state", () => {
    const { state, voided, reissued, unlisted, ids } = fixture();
    expect(handoffLines(state)).toEqual([[ids.sentLine, reissued], [ids.unlistedLine, unlisted]]);
    expect(state.invoices.find((i) => i.id === voided)?.status).toBe("void");
    expect(state.billingSources).toHaveLength(3);
  });

  it("keeps every source when no invoice is void", () => {
    const { state, voided, reissued, unlisted } = fixture();
    state.invoices = state.invoices.map((i) => (i.id === voided ? { ...i, status: "draft" } : i));
    expect(allocationInvoices(state)).toEqual([voided, reissued, unlisted]);
    expect(handoffLines(state)).toHaveLength(3);
  });
});
