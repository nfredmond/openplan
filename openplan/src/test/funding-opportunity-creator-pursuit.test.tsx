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

    const kindSelect = screen.getByLabelText("Pursuit kind") as HTMLSelectElement;
    expect(kindSelect.value).toBe("grant");
    // The solicitation input only exists for proposals.
    expect(screen.queryByLabelText(/Solicitation number/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Opportunity title"), {
      target: { value: "2027 ATP cycle call" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save funding opportunity/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = submittedBody();
    expect(body.pursuitKind).toBe("grant");
    expect(body.solicitationNumber).toBeUndefined();
  });

  it("reveals the solicitation number for a proposal and submits both", async () => {
    render(<FundingOpportunityCreator programs={[]} projects={[]} />);

    fireEvent.change(screen.getByLabelText("Pursuit kind"), { target: { value: "proposal" } });

    fireEvent.change(screen.getByLabelText(/Solicitation number/), {
      target: { value: "RFP-2026-014" },
    });
    fireEvent.change(screen.getByLabelText("Opportunity title"), {
      target: { value: "On-call planning services RFP" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save funding opportunity/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = submittedBody();
    expect(body.pursuitKind).toBe("proposal");
    expect(body.solicitationNumber).toBe("RFP-2026-014");
  });
});
