import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReceivableAgingStrip } from "@/components/invoicing/receivable-aging-strip";
import { buildReceivableAgingSummary } from "@/lib/invoicing/receivables";

const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("ReceivableAgingStrip", () => {
  it("renders every bucket and calls out undated outstanding invoices explicitly", () => {
    const aging = buildReceivableAgingSummary(
      [
        // Aged into 1-30 days.
        { status: "sent", due_date: "2026-07-01", total_amount: 1000, subtotal_amount: 1000, retention_percent: 0 },
        // Aged over 90 days.
        { status: "sent", due_date: "2026-03-01", total_amount: 2500, subtotal_amount: 2500, retention_percent: 0 },
        // Three sent invoices with no due date: the undated carve-out.
        { status: "sent", due_date: null, total_amount: 100, subtotal_amount: 100, retention_percent: 0 },
        { status: "sent", due_date: null, total_amount: 200, subtotal_amount: 200, retention_percent: 0 },
        { status: "sent", due_date: null, total_amount: 300, subtotal_amount: 300, retention_percent: 0 },
        // Draft and paid never age.
        { status: "draft", due_date: "2026-01-01", total_amount: 999, subtotal_amount: 999, retention_percent: 0 },
        { status: "paid", due_date: "2026-01-01", total_amount: 999, subtotal_amount: 999, retention_percent: 0 },
      ],
      NOW
    );

    render(<ReceivableAgingStrip aging={aging} />);

    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("1-30 days")).toBeInTheDocument();
    expect(screen.getByText("31-60 days")).toBeInTheDocument();
    expect(screen.getByText("61-90 days")).toBeInTheDocument();
    expect(screen.getByText("Over 90 days")).toBeInTheDocument();
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    expect(screen.getByText("$2,500.00")).toBeInTheDocument();

    // The undated count renders explicitly, never guessed into a bucket.
    expect(
      screen.getByText(/3 outstanding without a due date \(\$600\.00\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot be aged without guessing/)).toBeInTheDocument();
  });

  it("omits the undated callout when every outstanding invoice has a due date", () => {
    const aging = buildReceivableAgingSummary(
      [{ status: "sent", due_date: "2026-07-01", total_amount: 1000, subtotal_amount: 1000, retention_percent: 0 }],
      NOW
    );

    render(<ReceivableAgingStrip aging={aging} />);

    expect(screen.queryByText(/without a due date/)).toBeNull();
  });

  it("says plainly when there is nothing outstanding to age", () => {
    const aging = buildReceivableAgingSummary([], NOW);

    render(<ReceivableAgingStrip aging={aging} />);

    expect(screen.getByText("No outstanding invoices to age.")).toBeInTheDocument();
    expect(screen.queryByText("Current")).toBeNull();
  });
});
