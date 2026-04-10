import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { InvoiceFundingAwardLinker } from "@/components/billing/invoice-funding-award-linker";

describe("InvoiceFundingAwardLinker", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("filters award options to the linked project and patches the invoice link", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ invoice: { id: "invoice-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <InvoiceFundingAwardLinker
        invoiceId="invoice-1"
        workspaceId="workspace-1"
        projectId="project-1"
        currentFundingAwardId={null}
        fundingAwards={[
          { id: "award-1", title: "ATP 2026", projectId: "project-1" },
          { id: "award-2", title: "RAISE 2027", projectId: "project-2" },
        ]}
        canWrite
      />
    );

    const select = screen.getByLabelText("Funding award link") as HTMLSelectElement;
    expect(screen.getByRole("option", { name: "ATP 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "RAISE 2027" })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "award-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save funding link" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/billing/invoices/invoice-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: "workspace-1", fundingAwardId: "award-1" }),
      });
      expect(refreshMock).toHaveBeenCalled();
    });
  });
});
