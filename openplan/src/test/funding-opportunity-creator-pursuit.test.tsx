import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { FundingOpportunityCreator } from "@/components/programs/funding-opportunity-creator";

const fetchMock = vi.fn();

function submittedBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ opportunityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  } as unknown as Response);
});

afterEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  vi.unstubAllGlobals();
});

describe("FundingOpportunityCreator pursuit-kind selector", () => {
  it("defaults to a grant application and submits pursuitKind grant with no solicitation field", async () => {
    render(<FundingOpportunityCreator programs={[]} projects={[]} />);
    fireEvent.click(screen.getByTestId("funding-opportunity-creator-open"));

    const kindSelect = screen.getByLabelText("What kind of pursuit?") as HTMLSelectElement;
    expect(kindSelect.value).toBe("grant");
    // The solicitation input only exists for proposals.
    expect(screen.queryByLabelText(/Solicitation number/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Opportunity name"), {
      target: { value: "2027 ATP cycle call" },
    });
    // The submit lives on the last step of the flow.
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log the opportunity" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = submittedBody();
    expect(body.pursuitKind).toBe("grant");
    expect(body.solicitationNumber).toBeUndefined();
  });

  it("reveals the solicitation number for a proposal and submits both", async () => {
    render(<FundingOpportunityCreator programs={[]} projects={[]} />);
    fireEvent.click(screen.getByTestId("funding-opportunity-creator-open"));

    fireEvent.change(screen.getByLabelText("What kind of pursuit?"), { target: { value: "proposal" } });
    fireEvent.change(screen.getByLabelText("Opportunity name"), {
      target: { value: "On-call planning services RFP" },
    });

    // Choosing "proposal" opens a step a grant never sees.
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.change(screen.getByLabelText(/Solicitation number/), {
      target: { value: "RFP-2026-014" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log the opportunity" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = submittedBody();
    expect(body.pursuitKind).toBe("proposal");
    expect(body.solicitationNumber).toBe("RFP-2026-014");
  });

  it("does not carry a solicitation number back to a grant after a change of mind", async () => {
    // The path no test covered until a surviving mutation pointed at it:
    // pick proposal, type the number, go BACK, switch to grant. The value is
    // still in flow state, and only the payload's pursuit-kind guard stops it
    // being written against a grant — which has no solicitation to answer.
    render(<FundingOpportunityCreator programs={[]} projects={[]} />);
    fireEvent.click(screen.getByTestId("funding-opportunity-creator-open"));

    fireEvent.change(screen.getByLabelText("What kind of pursuit?"), {
      target: { value: "proposal" },
    });
    fireEvent.change(screen.getByLabelText("Opportunity name"), {
      target: { value: "Changed my mind" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.change(screen.getByLabelText(/Solicitation number/), {
      target: { value: "RFP-2026-014" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    fireEvent.change(screen.getByLabelText("What kind of pursuit?"), {
      target: { value: "grant" },
    });

    // The solicitation step is gone again, so this is two steps now.
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log the opportunity" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = submittedBody();
    expect(body.pursuitKind).toBe("grant");
    expect(body.solicitationNumber).toBeUndefined();
  });

  it("trims the solicitation number rather than storing the spaces", async () => {
    render(<FundingOpportunityCreator programs={[]} projects={[]} />);
    fireEvent.click(screen.getByTestId("funding-opportunity-creator-open"));

    fireEvent.change(screen.getByLabelText("What kind of pursuit?"), {
      target: { value: "proposal" },
    });
    fireEvent.change(screen.getByLabelText("Opportunity name"), {
      target: { value: "Padded number" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.change(screen.getByLabelText(/Solicitation number/), {
      target: { value: "  RFP-2026-014  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Log the opportunity" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(submittedBody().solicitationNumber).toBe("RFP-2026-014");
  });
});
