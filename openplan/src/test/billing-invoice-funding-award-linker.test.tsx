import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { InvoiceFundingAwardLinker } from "@/components/invoicing/invoice-funding-award-linker";

describe("InvoiceFundingAwardLinker", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("filters award options to the linked project and patches the invoice link", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/funding-awards/award-1/handoff") return {
        ok: true,
        json: async () => ({ award: { current_handoff_revision_id: "revision-1", latest_handoff_revision_id: "revision-1", currency_code: "USD" }, history: [{ id: "revision-1", terms: { ceiling: "1200.35" } }] }),
      };
      if (url === "/api/invoicing/invoices/invoice-1") return { ok: true, json: async () => ({ invoice: { id: "invoice-1" } }) };
      throw new Error(`Unexpected request ${url}`);
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
    const review = await screen.findByLabelText("I reviewed the current award conditions and currency.");
    fireEvent.click(screen.getByRole("button", { name: "Save funding link" }));
    expect(await screen.findByText("Review effective award terms before linking.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/funding-awards/award-1/handoff"]);
    fireEvent.click(review);
    fireEvent.click(screen.getByRole("button", { name: "Save funding link" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/invoicing/invoices/invoice-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: "workspace-1", fundingAwardId: "award-1", awardHandoffRevisionId: "revision-1", currencyCode: "USD" }),
      });
      expect(refreshMock).toHaveBeenCalled();
    });
  });
  it("asks why when a relink passes the new award's ceiling, then saves the link with the note (review 95)", async () => {
    const patches: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === "/api/funding-awards/award-2/handoff") return {
        ok: true,
        json: async () => ({ award: { current_handoff_revision_id: null, latest_handoff_revision_id: null, currency_code: null }, history: [] }),
      };
      if (url === "/api/invoicing/invoices/invoice-1") {
        const body = JSON.parse(init?.body ?? "{}");
        patches.push(body);
        return body.overCeilingNote
          ? { ok: true, status: 200, json: async () => ({ invoice: { id: "invoice-1" } }) }
          : {
              ok: false,
              status: 422,
              json: async () => ({
                code: "over_award_ceiling",
                error: "This would bring claims on the award to $105,000.00, $5,000.00 above its $100,000.00 ceiling. Add a note saying why to claim above the award.",
              }),
            };
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <InvoiceFundingAwardLinker
        invoiceId="invoice-1"
        workspaceId="workspace-1"
        projectId="project-1"
        currentFundingAwardId="award-1"
        fundingAwards={[
          { id: "award-1", title: "ATP 2026", projectId: "project-1" },
          { id: "award-2", title: "SS4A 2026", projectId: "project-1" },
        ]}
        canWrite
      />
    );

    fireEvent.change(screen.getByLabelText("Funding award link"), { target: { value: "award-2" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/funding-awards/award-2/handoff", { cache: "no-store" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save funding link" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save funding link" }));

    expect(await screen.findByText(/\$5,000\.00 above its \$100,000\.00 ceiling/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Why claim above the award (required)"), { target: { value: "Moved to the award that funds this phase." } });
    fireEvent.click(screen.getByRole("button", { name: "Save link with note" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(patches).toHaveLength(2);
    expect(patches[1]).toMatchObject({ fundingAwardId: "award-2", overCeilingNote: "Moved to the award that funds this phase." });
  });
});
