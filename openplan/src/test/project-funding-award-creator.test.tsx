import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { ProjectFundingAwardCreator } from "@/components/projects/project-funding-award-creator";

/**
 * The create form is where an award could be born already closed.
 *
 * "Fully spent" sat in the spending-status dropdown and was written straight
 * into the row, so one click skipped the entire close-out contract — no invoice
 * coverage check, no close-out milestone, no RTP posture rebuild — and, before
 * PATCH existed, permanently, because the close-out route answers
 * `already_closed` to every subsequent attempt.
 *
 * These pin both halves of the fix: the value is gone from the dropdown, and the
 * legitimate need it was serving (a workspace importing awards that closed years
 * ago) has an explicit path that says what it is.
 */

function renderCreator() {
  return render(
    <ProjectFundingAwardCreator
      projectId="44444444-4444-4444-8444-444444444444"
      opportunityOptions={[]}
    />
  );
}

function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText("Cycle 8 ATP award"), {
    target: { value: "Historic ATP award" },
  });
  fireEvent.change(screen.getByPlaceholderText("1750000"), { target: { value: "500000" } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /Save award/ }));
}

describe("ProjectFundingAwardCreator", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("offers no way to create an award already closed from the status dropdown", () => {
    renderCreator();

    const statusOptions = Array.from(
      (screen.getByLabelText("Spending status") as HTMLSelectElement).options
    ).map((option) => option.value);

    expect(statusOptions).toEqual(["not_started", "active", "delayed"]);
    expect(statusOptions).not.toContain("fully_spent");
  });

  it("sends a named import-closure intent, never a bare closed status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ awardId: "award-1", closureBasis: "recorded_on_import" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCreator();
    fillRequiredFields();
    fireEvent.click(screen.getByLabelText(/This award closed before it was recorded here/));
    fireEvent.change(screen.getByLabelText("Basis for the closure (required)"), {
      target: { value: "Closed by the county in FY22; final invoice held by the sponsor." },
    });
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));

    expect(body.recordClosedOnImport).toEqual({
      note: "Closed by the county in FY22; final invoice held by the sponsor.",
    });
    // The two are mutually exclusive at the API — sending both is a 400, because
    // they are two statements about the same field.
    expect(body.spendingStatus).toBeUndefined();

    // The confirmation must not borrow the words an earned close-out uses.
    expect(
      await screen.findByText(/recorded as closed on your statement/i)
    ).toBeTruthy();
    expect(screen.getByText(/No invoice coverage was checked/)).toBeTruthy();
  });

  it("will not send an import closure with no stated basis", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderCreator();
    fillRequiredFields();
    fireEvent.click(screen.getByLabelText(/This award closed before it was recorded here/));
    submit();

    expect(await screen.findByText(/needs a written basis/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's specific reason rather than a bare headline when a create is refused", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: "An award cannot be created already closed by choosing a spending status",
        details: "…send a `recordClosedOnImport` intent with a written basis.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCreator();
    fillRequiredFields();
    submit();

    // The API's `details` carries the way through; dropping it would leave the
    // planner with a refusal and no next step.
    expect(await screen.findByText(/recordClosedOnImport/)).toBeTruthy();
  });

  it("keeps an ordinary open award free of any closure claim", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ awardId: "award-1", closureBasis: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCreator();
    fillRequiredFields();
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));

    expect(body.spendingStatus).toBe("not_started");
    expect(body.recordClosedOnImport).toBeUndefined();
    expect(await screen.findByText("Funding award saved.")).toBeTruthy();
  });
});
