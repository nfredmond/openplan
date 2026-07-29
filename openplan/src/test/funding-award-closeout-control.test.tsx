import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import {
  FundingAwardCloseoutPanel,
  type FundingAwardCloseoutAward,
} from "@/components/grants/funding-award-closeout-control";

const OPEN_AWARD: FundingAwardCloseoutAward = {
  id: "award-1",
  title: "ATP Cycle 7 construction",
  spendingStatus: "active",
};

function normalizedTextOf(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function renderPanel(overrides?: {
  awards?: FundingAwardCloseoutAward[];
  canClose?: boolean;
}) {
  return render(
    <FundingAwardCloseoutPanel
      projectName="Willow Creek complete streets"
      awards={overrides?.awards ?? [OPEN_AWARD]}
      canClose={overrides?.canClose ?? true}
    />
  );
}

function openConfirmStep() {
  fireEvent.click(screen.getByRole("button", { name: "Close out award" }));
}

describe("FundingAwardCloseoutPanel", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("names the dollar shortfall and where the unpaid money is sitting when the server refuses on coverage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Closeout requires 100% paid invoice coverage against the awarded amount",
        coverage: {
          awardedAmount: 1_000_000,
          paidAmount: 400_000,
          outstandingAmount: 600_000,
          coverageRatio: 0.4,
          invoiceStatusBreakdown: {
            paidCount: 2,
            paidAmount: 400_000,
            activeCount: 1,
            activeAmount: 350_000,
            draftCount: 3,
            draftAmount: 250_000,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    const refusal = await screen.findByRole("alert");
    const refusalText = normalizedTextOf(refusal);

    expect(refusalText).toContain(
      "Paid invoices cover $400,000 of the $1,000,000 awarded (40%) — $600,000 is still short."
    );
    expect(refusalText).toContain("2 paid invoices · $400,000");
    // The middle bucket holds internal-review, submitted and approved-for-payment
    // invoices, so it names those three rather than calling all of them
    // "submitted" — which for an approved-for-payment invoice is simply untrue.
    expect(refusalText).toContain("1 invoice in the payment flow · $350,000");
    expect(refusalText).toContain(
      "in internal review, submitted, or approved for payment, so not yet paid"
    );
    expect(refusalText).toContain("3 draft invoices · $250,000");
    // The whole point of the refusal is that it is specific; a bare failure line
    // would send the planner back to the billing register with no idea what is
    // missing.
    expect(refusalText).not.toMatch(/\bfailed\b/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("says the award has no awarded amount rather than reporting a shortfall against zero", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Closeout requires 100% paid invoice coverage against the awarded amount",
        coverage: {
          awardedAmount: 0,
          paidAmount: 0,
          outstandingAmount: 0,
          coverageRatio: 0,
          invoiceStatusBreakdown: {
            paidCount: 0,
            paidAmount: 0,
            activeCount: 0,
            activeAmount: 0,
            draftCount: 0,
            draftAmount: 0,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    const refusalText = normalizedTextOf(await screen.findByRole("alert"));
    expect(refusalText).toContain("This award has no awarded amount recorded");
    expect(refusalText).not.toContain("$0 is still short");
  });

  it("reports an award the server says was already closed as success, not as a failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        awardId: "award-1",
        status: "already_closed",
        coverage: {
          awardedAmount: 1_000_000,
          paidAmount: 1_000_000,
          outstandingAmount: 0,
          coverageRatio: 1,
          invoiceStatusBreakdown: {
            paidCount: 4,
            paidAmount: 1_000_000,
            activeCount: 0,
            activeAmount: 0,
            draftCount: 0,
            draftAmount: 0,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    const outcome = await screen.findByRole("status");
    expect(normalizedTextOf(outcome)).toContain("ATP Cycle 7 construction was already closed out.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());

    // The idempotent path files no milestone and rebuilds no posture, so the
    // success message must not borrow the claims the real close-out makes.
    expect(normalizedTextOf(outcome)).toContain("no new milestone or posture rebuild was filed");
  });

  it("discloses the RTP posture rebuild before any close-out request is sent", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();

    const disclosure = normalizedTextOf(
      screen.getByText(/Rebuilds Willow Creek complete streets/).closest("ul") as HTMLElement
    );
    expect(disclosure).toContain("RTP funding posture");
    expect(disclosure).toContain("files a close-out milestone");
    // This used to assert the panel warned that close-out was one-way, because
    // it was: no route re-opened an award, so a mis-click closed it forever.
    // PATCH /api/funding-awards/[awardId] ended that, and the disclosure was
    // updated rather than dropped — a confirm step that still called the act
    // irreversible would be scaring the planner with a fact that is no longer
    // one, while hiding the condition that now applies.
    expect(disclosure).toContain("Reversible, but not quietly");
    expect(disclosure).toContain("written reason");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the operator's close-out note and confirms the award is now fully spent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        awardId: "award-1",
        coverage: {
          awardedAmount: 1_000_000,
          paidAmount: 1_000_000,
          outstandingAmount: 0,
          coverageRatio: 1,
          invoiceStatusBreakdown: {
            paidCount: 4,
            paidAmount: 1_000_000,
            activeCount: 0,
            activeAmount: 0,
            draftCount: 0,
            draftAmount: 0,
          },
        },
        closedAt: "2026-07-28T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.change(screen.getByLabelText("Close-out note (optional)"), {
      target: { value: "Final invoice 2026-14 paid in full." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/funding-awards/award-1/closeout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "Final invoice 2026-14 paid in full." }),
      });
    });

    const outcome = normalizedTextOf(await screen.findByRole("status"));
    expect(outcome).toContain("Closed out ATP Cycle 7 construction.");
    expect(outcome).toContain("Marked fully spent against $1,000,000 paid on the $1,000,000 awarded.");
    // The route logs and swallows a failed milestone insert or posture rebuild and
    // still answers 200, so the confirmation may not report them as done.
    expect(outcome).toContain("does not report on those two writes");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("shows the server's own reason when close-out is refused for something other than coverage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Workspace access denied" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    expect(normalizedTextOf(await screen.findByRole("alert"))).toContain("Workspace access denied");
  });

  it("reports the HTTP status when a refusal carries no reason at all", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    expect(normalizedTextOf(await screen.findByRole("alert"))).toContain(
      "refused with HTTP 502 and no reason given"
    );
  });

  it("offers no close-out on an award already recorded fully spent", () => {
    renderPanel({
      awards: [{ id: "award-2", title: "RAISE 2027 design", spendingStatus: "fully_spent" }],
    });

    expect(screen.getByText("Closed out")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close out award" })).not.toBeInTheDocument();
  });

  it("withholds the close-out control without claiming the reader is barred from close-out", () => {
    renderPanel({ canClose: false });

    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close out award" })).not.toBeInTheDocument();

    // `canClose` may be a narrower signal than the route's own check — /grants
    // once gated this on invoices.write (owner/admin) while the route authorizes
    // programs.write (owner/admin/member). So the copy may say the control is
    // withheld here, and may NOT tell the reader they personally cannot close an
    // award, which for a member would be simply false.
    const panel = screen.getByText(/Close-out marks an award fully spent/);
    const panelText = normalizedTextOf(panel);
    expect(panelText).toContain("this view is not offering it");
    expect(panelText).toContain("the server decides per project who may record a close-out");
    expect(panelText).not.toMatch(/read-only for you|you (?:cannot|can't|may not)/i);
  });

  it("says the breakdown is missing rather than rendering absent counts as three zeroes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Closeout requires 100% paid invoice coverage against the awarded amount",
        // A refusal whose breakdown never arrived: parsing it partially would
        // print "0 paid invoices", which is a claim about this award's billing
        // register made out of a field that was never read.
        coverage: {
          awardedAmount: 500_000,
          paidAmount: 100_000,
          outstandingAmount: 400_000,
          coverageRatio: 0.2,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    const refusalText = normalizedTextOf(await screen.findByRole("alert"));
    expect(refusalText).toContain("Paid invoices cover $100,000 of the $500,000 awarded (20%)");
    expect(refusalText).toContain("refusal arrived without its invoice breakdown");
    expect(refusalText).not.toMatch(/0 paid invoice/);
  });

  it("does not claim an award has no linked invoices when a rejected one would look identical", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Closeout requires 100% paid invoice coverage against the awarded amount",
        coverage: {
          awardedAmount: 500_000,
          paidAmount: 0,
          outstandingAmount: 500_000,
          coverageRatio: 0,
          invoiceStatusBreakdown: {
            paidCount: 0,
            paidAmount: 0,
            activeCount: 0,
            activeAmount: 0,
            draftCount: 0,
            draftAmount: 0,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    const refusalText = normalizedTextOf(await screen.findByRole("alert"));
    // Rejected invoices are in none of the three buckets, so all-zero counts do
    // not prove an empty billing register. The copy may state what the counts
    // show and may not turn that absence into "nothing is linked here".
    expect(refusalText).toContain(
      "No paid, in-flight, or draft invoice is linked to this award"
    );
    expect(refusalText).toContain("an award whose only invoice was rejected reads the same way");
    expect(refusalText).not.toMatch(/No invoices are linked to this award yet/);
    expect(refusalText).toContain("Start a reimbursement record before closing it out");
  });

  it("floors the coverage percent so a nearly-covered award never reads 100% next to a refusal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Closeout requires 100% paid invoice coverage against the awarded amount",
        coverage: {
          awardedAmount: 1_000_000,
          paidAmount: 999_000,
          outstandingAmount: 1_000,
          coverageRatio: 0.999,
          invoiceStatusBreakdown: {
            paidCount: 9,
            paidAmount: 999_000,
            activeCount: 0,
            activeAmount: 0,
            draftCount: 1,
            draftAmount: 1_000,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    openConfirmStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirm close-out" }));

    const refusalText = normalizedTextOf(await screen.findByRole("alert"));
    // Rounded, 99.9% would render "100%" in the same breath as a refusal for
    // not being fully covered — which reads as a bug in the refusal.
    expect(refusalText).toContain("(99%)");
    expect(refusalText).not.toContain("(100%)");
    expect(refusalText).toContain("$1,000 is still short");
  });

  /**
   * A closed award used to render one line — "Recorded fully spent" — whether it
   * had been earned to the dollar against paid invoices or born closed by a
   * mis-click on the create form. These pin that the two now read differently,
   * and that a caller which did not load the basis is told so rather than shown
   * the earned wording by default.
   */
  it("tells an earned close-out apart from one recorded on import", () => {
    renderPanel({
      awards: [
        {
          ...OPEN_AWARD,
          spendingStatus: "fully_spent",
          closureBasis: "earned_coverage",
          closedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    expect(screen.getByText("Closed out on invoice coverage")).toBeTruthy();
    expect(screen.getByText(/Paid invoices covered the full awarded amount/)).toBeTruthy();
  });

  it("says an imported closure was asserted, and shows the basis that was stated", () => {
    renderPanel({
      awards: [
        {
          ...OPEN_AWARD,
          spendingStatus: "fully_spent",
          closureBasis: "recorded_on_import",
          closedAt: "2026-07-01T00:00:00.000Z",
          closureNote: "Closed by the county in FY22; final invoice held by the sponsor.",
        },
      ],
    });
    expect(screen.getByText("Recorded as closed on import")).toBeTruthy();
    expect(screen.getByText(/No invoice coverage was checked/)).toBeTruthy();
    expect(screen.getByText(/Closed by the county in FY22/)).toBeTruthy();
  });

  it("does not present a closure whose basis it never loaded as an earned one", () => {
    // `undefined` means the caller did not select the column. Rendering the
    // earned wording here would state, as fact, something this view never read.
    renderPanel({ awards: [{ ...OPEN_AWARD, spendingStatus: "fully_spent" }] });

    expect(screen.getByText("Closure basis not loaded")).toBeTruthy();
    expect(screen.getByText(/cannot tell an earned close-out from one recorded on import/)).toBeTruthy();
    expect(screen.queryByText(/Paid invoices covered the full awarded amount/)).toBeNull();
  });

  it("re-opens a closed award only with a written reason, and keeps the milestone disclosure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        awardId: "award-1",
        status: "reopened",
        priorClosureBasis: "recorded_on_import",
        details: "Re-opened. Any close-out milestone already filed on this project is left in place.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel({
      awards: [{ ...OPEN_AWARD, spendingStatus: "fully_spent", closureBasis: "recorded_on_import" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Re-open award" }));

    // Blank reason: refused here, before any request is sent. The API and the
    // database refuse it too; this is the layer that can say which box is empty.
    fireEvent.click(screen.getByRole("button", { name: "Confirm re-open" }));
    expect(normalizedTextOf(await screen.findByRole("alert"))).toContain("needs a written reason");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reason (required)"), {
      target: { value: "Funder de-obligated the final $200k." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm re-open" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/funding-awards/award-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      reopen: { reason: "Funder de-obligated the final $200k.", spendingStatus: "active" },
    });

    const outcome = normalizedTextOf(await screen.findByRole("status"));
    expect(outcome).toContain("Re-opened ATP Cycle 7 construction");
    expect(outcome).toContain("recorded as closed on import");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("offers no re-open to a reader the view is not offering writes to", () => {
    renderPanel({
      awards: [{ ...OPEN_AWARD, spendingStatus: "fully_spent", closureBasis: "earned_coverage" }],
      canClose: false,
    });

    expect(screen.queryByRole("button", { name: "Re-open award" })).toBeNull();
    // The provenance itself is still shown: reading how an award was closed is
    // not a write, and withholding it would hide the distinction from exactly
    // the readers most likely to be auditing it.
    expect(screen.getByText("Closed out on invoice coverage")).toBeTruthy();
  });
});
