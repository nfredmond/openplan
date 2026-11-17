import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { InvoiceStatusAdvanceButton } from "@/components/invoicing/invoice-status-advance-button";
import { FundingAwardCloseoutPanel } from "@/components/grants/funding-award-closeout-control";
import { resubmissionInvoiceNumber } from "@/app/(app)/invoicing/_components/invoicing-page-helpers";
import { requestCostsBeforeObligation } from "@/lib/invoicing/request-dates";
import { buildAwardDrawdownLedger, type DrawdownInvoiceLike } from "@/lib/invoicing/drawdown-ledger";
import {
  buildReimbursementWorksheetHtml,
  orderResubmissionsAfterOriginals,
  summarizeWorksheetCostEntries,
} from "@/lib/invoicing/reimbursement-worksheet";
import { resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";

/**
 * The screens and documents for reimbursement request custody
 * (KI-2026-11-16-130, -135, -136, -139; KL-2026-09-04-024). The database rules
 * are proved live in award-reimbursement-custody-rls.test.ts; these check that
 * the planner is asked for what the rules require and that the worksheet
 * prints what was recorded, with "Not recorded" for what was not.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const INVOICE = "99999999-9999-4999-8999-999999999999";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function sentBody(): Record<string, unknown> {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  expect(url).toBe(`/api/invoicing/invoices/${INVOICE}`);
  return JSON.parse(String(init.body));
}

describe("the request status control", () => {
  it("asks for the payment date before marking an approved request paid", async () => {
    render(<InvoiceStatusAdvanceButton invoiceId={INVOICE} workspaceId={WORKSPACE} currentStatus="approved_for_payment" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));
    expect(fetchMock).not.toHaveBeenCalled();
    const date = screen.getByLabelText("Payment date");
    // Prefilled with the browser's own day, never left blank or guessed.
    expect((date as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(date, { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ workspaceId: WORKSPACE, status: "paid", paidDate: "2026-11-02" });
  });

  it("asks for the funder's reason before marking a submitted request rejected", async () => {
    render(<InvoiceStatusAdvanceButton invoiceId={INVOICE} workspaceId={WORKSPACE} currentStatus="submitted" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Mark rejected" }));
    fireEvent.change(screen.getByLabelText("Reason the funder gave (required)"), { target: { value: "  Revise the invoice date  " } });
    fireEvent.click(screen.getByRole("button", { name: "Mark rejected" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ workspaceId: WORKSPACE, status: "rejected", rejectionReason: "Revise the invoice date" });
  });

  it("offers rejection only on submitted and approved requests", () => {
    for (const status of ["draft", "internal_review"]) {
      const { unmount } = render(<InvoiceStatusAdvanceButton invoiceId={INVOICE} workspaceId={WORKSPACE} currentStatus={status} canWrite />);
      expect(screen.queryByRole("button", { name: "Mark rejected" })).toBeNull();
      unmount();
    }
    const { unmount } = render(<InvoiceStatusAdvanceButton invoiceId={INVOICE} workspaceId={WORKSPACE} currentStatus="approved_for_payment" canWrite />);
    expect(screen.getByRole("button", { name: "Mark rejected" })).toBeInTheDocument();
    unmount();
  });

  it("offers Resubmit on a rejected request with none yet, and nothing on a paid one", () => {
    const { unmount } = render(<InvoiceStatusAdvanceButton invoiceId={INVOICE} workspaceId={WORKSPACE} currentStatus="rejected" canWrite canResubmit />);
    expect(screen.getByRole("link", { name: "Resubmit" })).toHaveAttribute("href", `/invoicing?resubmit=${INVOICE}#record-invoice`);
    unmount();
    const second = render(<InvoiceStatusAdvanceButton invoiceId={INVOICE} workspaceId={WORKSPACE} currentStatus="rejected" canWrite canResubmit={false} />);
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();
    const paid = render(<InvoiceStatusAdvanceButton invoiceId={INVOICE} workspaceId={WORKSPACE} currentStatus="paid" canWrite canResubmit />);
    expect(paid.container).toBeEmptyDOMElement();
  });

  it("shows the server's refusal instead of claiming the move", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "A request is marked paid only after it is approved for payment" }) });
    render(<InvoiceStatusAdvanceButton invoiceId={INVOICE} workspaceId={WORKSPACE} currentStatus="submitted" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Mark approved for payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A request is marked paid only after it is approved for payment");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("a resubmission's number", () => {
  it.each([
    ["INV-2", "INV-2A"],
    ["1", "1A"],
    ["1A", "1B"],
    ["2026-14B", "2026-14C"],
    ["E-DUP", "E-DUPA"],
    ["7Z", "7ZA"],
  ])("%s becomes %s", (rejected, next) => {
    expect(resubmissionInvoiceNumber(rejected)).toBe(next);
  });
});

describe("costs before the award was obligated", () => {
  it("warns on a period that starts before the obligated date, and on an earlier invoice date with no period", () => {
    expect(requestCostsBeforeObligation({ obligatedOn: "2026-06-30", periodStart: "2026-06-29", invoiceDate: "2026-07-15" })).toHaveLength(1);
    expect(requestCostsBeforeObligation({ obligatedOn: "2026-06-30", periodStart: null, invoiceDate: "2026-01-15" })[0].message).toBe(
      "This request is dated 2026-01-15, before the award was obligated on 2026-06-30. Costs before that date are generally not reimbursable unless the agreement allows them."
    );
  });

  it("stays quiet on the obligated day itself, after it, and when no date is recorded", () => {
    expect(requestCostsBeforeObligation({ obligatedOn: "2026-06-30", periodStart: "2026-06-30", invoiceDate: null })).toEqual([]);
    expect(requestCostsBeforeObligation({ obligatedOn: null, periodStart: "2020-01-01", invoiceDate: null })).toEqual([]);
    expect(requestCostsBeforeObligation({ obligatedOn: "2026-06-30", periodStart: null, invoiceDate: null })).toEqual([]);
  });
});

const INVOICES: DrawdownInvoiceLike[] = [
  { id: "r-1", invoice_number: "INV-1", status: "paid", amount: "60000.00", retention_percent: 0, retention_amount: 0, invoice_date: "2026-02-01", paid_date: "2026-03-01" },
  { id: "r-2", invoice_number: "INV-2", status: "rejected", amount: "45000.00", retention_percent: 0, retention_amount: 0, invoice_date: "2026-03-01", rejection_reason: "Revise the invoice date" },
  { id: "r-3", invoice_number: "INV-3", status: "paid", amount: "10000.00", retention_percent: 0, retention_amount: 0, invoice_date: "2026-03-05", paid_date: null },
  { id: "r-2a", invoice_number: "INV-2A", status: "paid", amount: "45000.00", retention_percent: 0, retention_amount: 0, invoice_date: "2026-04-01", paid_date: "2026-04-20", resubmits_invoice_id: "r-2" },
];

function worksheet(award: Parameters<typeof buildReimbursementWorksheetHtml>[0]["award"]) {
  const built = buildAwardDrawdownLedger({
    award: { awarded_amount: "200000.00", match_amount: "0", match_posture: "not_required" },
    invoiceRead: { ok: true, invoices: INVOICES },
  });
  if (!built.ok) throw new Error("ledger failed");
  const profile = resolveReimbursementProfile({ workspaceJurisdiction: null });
  if (profile.kind !== "resolved") throw new Error("profile failed");
  return {
    html: buildReimbursementWorksheetHtml({
      workspace: { name: "Synthetic county" },
      award,
      period: null,
      ledger: built.ledger,
      profile: profile.binding,
      costs: summarizeWorksheetCostEntries({ ok: true, entries: [] }),
    }),
    lines: built.ledger.lines,
  };
}

describe("the worksheet", () => {
  it("lists a resubmission right after the request it replaces", () => {
    const { lines } = worksheet({ title: "Award" });
    expect(orderResubmissionsAfterOriginals(lines).map((line) => line.invoiceNumber)).toEqual(["INV-1", "INV-2", "INV-2A", "INV-3"]);
  });

  it("prints the payment date, the rejection reason and what a resubmission replaces", () => {
    const { html } = worksheet({ title: "Award" });
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("INV-2 Rejected Revise the invoice date");
    expect(text).toContain("INV-2A resubmits INV-2 Paid 2026-04-01");
    expect(text).toContain("2026-04-20");
    expect(text).toMatch(/INV-3 Paid 2026-03-05 Not recorded Not recorded/);
    // The rendered table, not only the helper: INV-2A sits under INV-2, above INV-3.
    const rows = ["<td>INV-1<", "<td>INV-2<", "<td>INV-2A<", "<td>INV-3<"].map((cell) => html.indexOf(cell));
    expect(rows.every((at) => at > -1)).toBe(true);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
  });

  it("prints the obligated date, and Not recorded when there is none", () => {
    expect(worksheet({ title: "Award", obligatedOn: "2026-01-20" }).html).toMatch(/Obligated, authorized or allocated on[\s\S]*?<td class="num">2026-01-20<\/td>/);
    expect(worksheet({ title: "Award", obligatedOn: null }).html).toMatch(/Obligated, authorized or allocated on[\s\S]*?<td class="num">Not recorded<\/td>/);
  });

  it("states a close with the balance released, and the amount released", () => {
    const { html } = worksheet({
      title: "Award",
      closure: { basis: "reconciled_with_balance", closedOn: "2026-11-16", note: "Finished under budget", releasedAmount: 85000 },
    });
    expect(html).toMatch(/Award close-out[\s\S]*?closed 2026-11-16: Finished under budget[\s\S]*?Closed with balance released/);
    expect(html).toMatch(/Balance released at close-out[\s\S]*?\$85,000\.00/);
  });

  it("prints no close-out lines for an open award", () => {
    const { html } = worksheet({ title: "Award", closure: null });
    expect(html).not.toContain("Award close-out");
    expect(html).not.toContain("Balance released");
  });
});

describe("the close-out panel", () => {
  it("sends a close with the balance released when the planner says the award finished under its ceiling", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ awardId: "award-1", closureBasis: "reconciled_with_balance", closedAt: "2026-11-17T03:00:00.000Z", releasedAmount: 600000, coverage: null }),
    });
    render(<FundingAwardCloseoutPanel projectName="Synthetic corridor" awards={[{ id: "award-1", title: "Synthetic award", spendingStatus: "active" }]} canClose />);
    fireEvent.click(screen.getByRole("button", { name: "Close out award" }));
    fireEvent.click(screen.getByLabelText(/Under the ceiling/));
    expect(screen.getByLabelText("Close-out note (required)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Close-out note (required)"), { target: { value: "Finished under budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/funding-awards/award-1/closeout");
    expect(JSON.parse(String(init.body))).toEqual({ notes: "Finished under budget", basis: "reconciled_with_balance" });
    expect(await screen.findByText("$600,000.00 recorded as released.")).toBeInTheDocument();
  });

  it("shows an open-request refusal in the server's words, not as a coverage shortfall", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Close-out needs every linked request paid or rejected",
        details: "1 linked request is still a draft, in review, submitted or approved for payment.",
        openCount: 1,
        coverage: { awardedAmount: 1000, paidAmount: 1000, outstandingAmount: 0, invoiceStatusBreakdown: { paidCount: 1, paidAmount: 1000, activeCount: 0, activeAmount: 0, draftCount: 1, draftAmount: 50 } },
      }),
    });
    render(<FundingAwardCloseoutPanel projectName="Synthetic corridor" awards={[{ id: "award-1", title: "Synthetic award", spendingStatus: "active" }]} canClose />);
    fireEvent.click(screen.getByRole("button", { name: "Close out award" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Close-out needs every linked request paid or rejected");
    expect(alert).not.toHaveTextContent("coverage is short");
  });
});
