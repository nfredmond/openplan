import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { InvoiceRecordComposer } from "@/components/billing/invoice-record-composer";

describe("InvoiceRecordComposer", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("updates the net request preview live from gross amount and retention", () => {
    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[{ id: "project-1", name: "Nevada County ATP" }]}
      />
    );

    const grossAmountInput = screen.getByLabelText("Gross amount");
    const retentionPercentInput = screen.getByLabelText("Retention %");
    const previewCard = screen.getByText("Net request preview").closest("aside");

    expect(previewCard).not.toBeNull();
    const preview = within(previewCard as HTMLElement);
    expect(preview.getByText("Gross amount")).toBeInTheDocument();
    expect(preview.getByText("Retention (0.00%)")).toBeInTheDocument();
    expect(preview.getAllByText("$0.00")).toHaveLength(3);

    fireEvent.change(grossAmountInput, { target: { value: "12500" } });
    fireEvent.change(retentionPercentInput, { target: { value: "5" } });

    expect(preview.getByText("Retention (5.00%)")).toBeInTheDocument();
    expect(preview.getByText("$12,500.00")).toBeInTheDocument();
    expect(preview.getByText("$625.00")).toBeInTheDocument();
    expect(preview.getByText("$11,875.00")).toBeInTheDocument();
  });

  it("shows gross as net when retention is zero", () => {
    render(
      <InvoiceRecordComposer
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        canWrite
        projects={[]}
      />
    );

    fireEvent.change(screen.getByLabelText("Gross amount"), { target: { value: "3200" } });

    expect(screen.getByText("Retention (0.00%)")).toBeInTheDocument();
    expect(screen.getAllByText("$3,200.00")).toHaveLength(2);
  });
});
