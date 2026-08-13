import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The planning-period editor, tested where the claims actually live.
 *
 * Three of these assertions exist because the thing they check is invisible
 * from inside the component and would have shipped silently:
 *
 * 1. THE MIDPOINT THE ROW DISPLAYS IS THE ENGINE'S. `bandMidpoint()` in the
 *    editor duplicates `midpoint()` in `@/lib/rtp/fiscal-constraint`, which is
 *    module-private and cannot be imported. A comment saying "MUST MATCH" is a
 *    convention, and a convention cannot fail a build. So the year the row
 *    STATES is compared against the year `buildRtpFiscalConstraint` actually
 *    uses for the same band, over ranges where flooring and rounding disagree —
 *    which is the only mutation that matters, and the only one a hand-written
 *    expected value would not catch.
 *
 * 2. A REFUSAL'S `hint` REACHES THE PLANNER. The route's read failures come
 *    from `classifyRouteReadFailure`, whose body is `{ error, hint }` and never
 *    `details`. A surface that reads only `error` and `details` shows "RTP cycle
 *    schema is not available yet" and drops "Apply the latest Supabase
 *    migrations, then try again" — the only instruction in the response.
 *
 * 3. A CREATE THAT LANDED AND COULD NOT BE READ BACK SAYS SO. That answers
 *    **201**, so `response.ok` is true and the ordinary success path runs:
 *    the form closes, the refresh cannot see the row, and the planner adds the
 *    period a second time. The route writes a sentence for this; the surface
 *    has to show it.
 */

const routerRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: routerRefresh }),
}));

import { RtpHorizonBandEditor } from "@/components/rtp/rtp-horizon-band-editor";
import { confirmDestructiveAction, confirmDialogText, declineConfirmation } from "./helpers/confirm-dialog";
import { buildRtpFiscalConstraint, type RtpHorizonBandInput } from "@/lib/rtp/fiscal-constraint";

const RTP_CYCLE_ID = "44444444-4444-4444-8444-444444444444";

function band(overrides: Partial<RtpHorizonBandInput> = {}): RtpHorizonBandInput {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    label: "First ten years",
    startYear: 2026,
    endYear: 2035,
    escalationTargetYear: null,
    costEstimateBasis: "itemized",
    sortOrder: 0,
    ...overrides,
  };
}

/** The year the ENGINE will treat this band's money as spent. */
function engineExpenditureYear(input: RtpHorizonBandInput): number {
  const summary = buildRtpFiscalConstraint({
    cycleFinancialBasisYear: null,
    annualInflationRate: null,
    bands: [input],
    lines: [],
    projects: [],
  });
  const result = summary.bands.find((entry) => entry.bandId === input.id);
  if (!result) throw new Error("the engine did not return the band it was given");
  return result.expenditureYear;
}

function mockFetchOnce(response: { status: number; body: unknown }) {
  // Typed with the arguments the component actually passes, so the assertions
  // below can read the request body without casting through `any`.
  const fetchMock = vi.fn(
    async (_input: string, _init?: { method?: string; body?: string }) =>
      new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RtpHorizonBandEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Ranges whose year-span is ODD, so (start + end) / 2 is a .5 and flooring
  // and rounding give different answers. A single even-span fixture would pass
  // against either rule and prove nothing.
  it.each([
    [2026, 2035],
    [2031, 2050],
    [1999, 2000],
  ])(
    "states the same assumed expenditure year for %i–%i that the fiscal engine uses",
    (startYear, endYear) => {
      const subject = band({ startYear, endYear, escalationTargetYear: null });
      const expected = engineExpenditureYear(subject);

      render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[subject]} canWrite />);

      expect(screen.getByText(String(expected))).toBeInTheDocument();
      expect(screen.getByText(/assumed from the middle of the period/i)).toBeInTheDocument();
    }
  );

  it("states the agency's own year, and does not call it assumed, when one is set", () => {
    render(
      <RtpHorizonBandEditor
        rtpCycleId={RTP_CYCLE_ID}
        bands={[band({ startYear: 2026, endYear: 2035, escalationTargetYear: 2028 })]}
        canWrite
      />
    );

    expect(screen.getByText("2028")).toBeInTheDocument();
    expect(screen.queryByText(/assumed from the middle of the period/i)).not.toBeInTheDocument();
  });

  it("labels every field of the form", () => {
    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /add the first period/i }));

    expect(screen.getByLabelText(/what this period is called/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^first year$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^last year$/i)).toBeInTheDocument();

    // The money questions live on the flow's second step. Getting there needs
    // the years, because the primitive refuses to advance past a blank
    // required field — which is the point of it.
    fireEvent.change(screen.getByLabelText(/what this period is called/i), {
      target: { value: "First ten years" },
    });
    fireEvent.change(screen.getByLabelText(/^first year$/i), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText(/^last year$/i), { target: { value: "2035" } });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    expect(screen.getByLabelText(/year money in this period is treated as spent/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/how costs are reported for this period/i)).toBeInTheDocument();
  });

  it("explains what a plan with no periods cannot do, rather than showing an empty box", () => {
    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[]} canWrite />);

    expect(screen.getByText(/no planning periods yet/i)).toBeInTheDocument();
    expect(screen.getByText(/fiscal constraint check will decline to give an answer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add the first period/i })).toBeInTheDocument();
  });

  it("tells a view-only planner why there is no button rather than showing nothing", () => {
    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[]} canWrite={false} />);

    expect(screen.queryByRole("button", { name: /add the first period/i })).not.toBeInTheDocument();
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument();
  });

  it("shows a refusal's hint, not only its headline", async () => {
    // The shape `classifyRouteReadFailure` produces. There is no `details` here
    // at all — the instruction lives in `hint`.
    mockFetchOnce({
      status: 503,
      body: {
        error: "RTP cycle schema is not available yet",
        hint: "Apply the latest Supabase migrations, then try again.",
      },
    });

    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /add the first period/i }));
    fireEvent.change(screen.getByLabelText(/what this period is called/i), {
      target: { value: "First ten years" },
    });
    fireEvent.change(screen.getByLabelText(/^first year$/i), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText(/^last year$/i), { target: { value: "2035" } });
    // The money questions are the flow's second step.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add period/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("RTP cycle schema is not available yet");
    expect(alert).toHaveTextContent("Apply the latest Supabase migrations, then try again.");
  });

  it("discloses a create that was written and could not be read back", async () => {
    mockFetchOnce({
      status: 201,
      body: {
        created: true,
        record: null,
        details:
          "The horizon period was created, but this request could not read it back — the table allows " +
          "the insert and does not allow this reader to select the row. Nothing needs to be retried; " +
          "retrying would create a second one.",
      },
    });

    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /add the first period/i }));
    fireEvent.change(screen.getByLabelText(/what this period is called/i), {
      target: { value: "First ten years" },
    });
    fireEvent.change(screen.getByLabelText(/^first year$/i), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText(/^last year$/i), { target: { value: "2035" } });
    // The money questions are the flow's second step.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add period/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/retrying would create a second one/i);
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
  });

  it("sends an emptied escalation year as null, never as 0", async () => {
    const fetchMock = mockFetchOnce({ status: 200, body: { band: band() } });

    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /add the first period/i }));
    fireEvent.change(screen.getByLabelText(/what this period is called/i), {
      target: { value: "First ten years" },
    });
    fireEvent.change(screen.getByLabelText(/^first year$/i), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText(/^last year$/i), { target: { value: "2035" } });
    // The money questions are the flow's second step.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add period/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body ?? "{}") as Record<string, unknown>;
    expect(body.escalationTargetYear).toBeNull();
    expect(body.escalationTargetYear).not.toBe(0);
    // The workspace is never the browser's to state.
    expect(body).not.toHaveProperty("workspaceId");
  });

  it("asks for a sort order past the highest in use, not the number of periods", async () => {
    // Two periods whose sort orders are 0 and 7 — a plan that has had a period
    // removed. `bands.length` would be 2, which is free here but collides the
    // moment the gap is elsewhere; the honest answer is 8.
    const fetchMock = mockFetchOnce({ status: 200, body: { band: band() } });

    render(
      <RtpHorizonBandEditor
        rtpCycleId={RTP_CYCLE_ID}
        bands={[
          band({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "Early", sortOrder: 0 }),
          band({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Late", sortOrder: 7 }),
        ]}
        canWrite
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /add a period/i }));
    fireEvent.change(screen.getByLabelText(/what this period is called/i), {
      target: { value: "Middle" },
    });
    fireEvent.change(screen.getByLabelText(/^first year$/i), { target: { value: "2036" } });
    fireEvent.change(screen.getByLabelText(/^last year$/i), { target: { value: "2045" } });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add period/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body ?? "{}") as Record<string, unknown>;
    expect(body.sortOrder).toBe(8);
  });

  it("shows a blocked delete's headline AND the sentence naming what has to move", async () => {
    mockFetchOnce({
      status: 409,
      body: {
        error: "This period still has money assigned to it",
        details:
          "2 revenue or cost lines are still assigned to this period (STBG). Move them to another " +
          "period or remove them, then delete this period.",
      },
    });

    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[band()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await confirmDestructiveAction("Remove this period");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This period still has money assigned to it");
    expect(alert).toHaveTextContent(/Move them to another period/i);
  });

  it("reports an uncountable project-link count as unknown, never as none", async () => {
    mockFetchOnce({ status: 200, body: { ok: true, bandId: band().id, projectLinksUnassigned: null } });

    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[band()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await confirmDestructiveAction("Remove this period");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/could not be counted/i);
  });

  /**
   * FOUND BY MUTATION, not by reading. Every removal test here drove the
   * confirmation and then asserted on the result, so making the editor IGNORE
   * the planner's answer changed nothing and the whole suite stayed green. The
   * period the planner declined to remove would have been removed anyway, and
   * with it — ON DELETE SET NULL — the period assignment of every project
   * programmed into it. Nothing asserted the "no" path until now.
   */
  it("removes nothing when the planner declines", async () => {
    const fetchMock = mockFetchOnce({ status: 200, body: { ok: true } });

    render(<RtpHorizonBandEditor rtpCycleId={RTP_CYCLE_ID} bands={[band()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    // The question names the period and the cost of removing it, so a planner
    // can answer it without leaving the page to check what is programmed there.
    const copy = await confirmDialogText();
    expect(copy).toContain("First ten years");
    expect(copy).toMatch(/left without a period/i);

    await declineConfirmation();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
