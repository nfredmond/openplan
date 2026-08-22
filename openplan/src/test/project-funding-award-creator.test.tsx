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
 *
 * UPDATED 2026-08-22: the creator is a guided flow. Every assertion below is
 * the one it always made — the helpers reach the step holding the field first,
 * and the closure basis now lives on a step that appears only when the box is
 * ticked. Nothing was weakened to make it pass.
 */

function renderCreator() {
  return render(
    <ProjectFundingAwardCreator
      projectId="44444444-4444-4444-8444-444444444444"
      opportunityOptions={[]}
    />
  );
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

/** Open the flow, answer the required name, and land on the spending step. */
function openToSpending() {
  fireEvent.click(screen.getByTestId("funding-award-creator-open"));
  fireEvent.change(screen.getByLabelText("Award name"), {
    target: { value: "Historic ATP award" },
  });
  fireEvent.change(screen.getByLabelText("Awarded amount"), { target: { value: "500000" } });
  next();
}

/** From the spending step to the last one, where the submit lives. */
function advanceToEnd(throughClosure: boolean) {
  next();
  if (throughClosure) next();
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Save the award" }));
}

describe("ProjectFundingAwardCreator", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("offers no way to create an award already closed from the status dropdown", () => {
    renderCreator();
    openToSpending();

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
    openToSpending();
    fireEvent.click(screen.getByLabelText(/This award closed before it was recorded here/));
    // Ticking the box opens a step that an ordinary award never sees.
    next();
    fireEvent.change(screen.getByLabelText("Basis for the closure (required)"), {
      target: { value: "Closed by the county in FY22; final invoice held by the sponsor." },
    });
    next();
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

  it("offers both award deadlines, and sends the lapse date it was given", async () => {
    /**
     * THE ONLY PLACE A LAPSE DATE CAN BE ENTERED, so this is the test that says
     * the column is reachable at all. A capability no planner can get to is
     * this repository's most-repeated defect, and a reminder about a date
     * nobody can type in is exactly that shape.
     *
     * The two fields are asserted TOGETHER and given different values: a form
     * that wired the new input to the obligation state — or that posted the
     * same string twice — passes a single-field fixture and fails this one.
     *
     * MUTATION-VERIFIED: pointing `expenditureDeadlineAt` at the obligation
     * state fails on the obligation assertion; dropping the field from the POST
     * body fails on the lapse one.
     */
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ awardId: "award-1", closureBasis: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCreator();
    openToSpending();
    advanceToEnd(false);
    fireEvent.change(screen.getByLabelText("Obligation due"), {
      target: { value: "2026-09-30T00:00" },
    });
    fireEvent.change(screen.getByLabelText(/Expenditure deadline/), {
      target: { value: "2028-06-30T00:00" },
    });

    // Asserted BEFORE submitting: the flow closes on success, so the sentence
    // explaining what a lapse date is must be checked while the step carrying
    // it is on screen — the only moment a planner reads it. Checked against the
    // step's own text rather than with `getByText`, which matches per element
    // and could not see this hint beside its field.
    expect(document.querySelector("dialog")?.textContent ?? "").toContain(
      "funds must be spent by"
    );

    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));

    expect(new Date(String(body.obligationDueAt)).toISOString()).toBe(
      new Date("2026-09-30T00:00").toISOString()
    );
    expect(new Date(String(body.expenditureDeadlineAt)).toISOString()).toBe(
      new Date("2028-06-30T00:00").toISOString()
    );
  });

  it("sends no lapse date when the field is left blank", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ awardId: "award-1", closureBasis: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCreator();
    openToSpending();
    advanceToEnd(false);
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.expenditureDeadlineAt).toBeUndefined();
  });

  it("will not send an import closure with no stated basis", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderCreator();
    openToSpending();
    fireEvent.click(screen.getByLabelText(/This award closed before it was recorded here/));
    // The closure step opens; leaving its basis blank must stop the flow there.
    next();
    next();

    expect(await screen.findAllByText(/needs a written basis/)).toBeTruthy();
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
    openToSpending();
    advanceToEnd(false);
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
    openToSpending();
    advanceToEnd(false);
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));

    expect(body.spendingStatus).toBe("not_started");
    expect(body.recordClosedOnImport).toBeUndefined();
    expect(await screen.findByText("Funding award saved.")).toBeTruthy();
  });
});
