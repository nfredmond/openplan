import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { InvoiceRecordComposer } from "@/components/invoicing/invoice-record-composer";

/**
 * A NEGATIVE AMOUNT IS REFUSED FOR THE RIGHT REASON.
 *
 * Lane 84 typed -500 as a reimbursement request's gross amount. The composer
 * refused it (correctly), but said "Give the gross amount as a plain number,
 * with no commas or currency sign", which -500 already is. The refusal now says
 * the amount cannot be less than zero; text that is not a number keeps the
 * old message.
 *
 * Blind category: what the server does with the amount (the route has its own
 * schema); the award form's matching change is not rendered here.
 */
function openToMoney() {
  fireEvent.click(screen.getByTestId("invoice-record-composer-open"));
  fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-1" } });
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

function tryAmount(value: string): string {
  render(<InvoiceRecordComposer workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" canWrite projects={[]} reimbursementProfile={null} />);
  openToMoney();
  fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
  return document.getElementById("log-invoice-record-amount-problem")?.textContent ?? "";
}

describe("the reimbursement composer's amount refusal", () => {
  it("says a negative amount cannot be less than zero", () => {
    const message = tryAmount("-500");
    expect(message).toBe("The gross amount cannot be less than zero.");
    expect(message).not.toContain("commas");
  });

  it("keeps the plain-number message for text that is not a number", () => {
    expect(tryAmount("about five hundred")).toBe("Give the gross amount as a plain number, with no commas or currency sign.");
  });
});
