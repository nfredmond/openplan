import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RtpPerformanceMeasureEditor,
  type RtpPerformanceMeasureRow,
} from "@/components/rtp/rtp-performance-measure-editor";

/**
 * THE SCREEN SIDE OF "A MEASURED ZERO IS NOT A BLANK BOX".
 *
 * `rtp-performance-measures-route.test.ts` proves the ROUTE keeps the two
 * apart. Nothing proved the SCREEN did, and the screen has its own two ways of
 * losing a zero, neither of which any route test can see:
 *
 *   1. rendering — `value ? format(value) : "No baseline recorded"` prints
 *      "No baseline recorded" for an agency that measured zero pedestrian
 *      fatalities, which is the result it most wants to state;
 *   2. authoring — `Number(box)` on an empty box is `0`, so a planner who left
 *      the baseline blank sends a baseline of zero they never measured, and the
 *      route can only store faithfully what it was handed.
 *
 * So these assertions read what is on the screen and what was handed to
 * `fetch`, never a fixture echoed back.
 *
 * MUTATIONS RUN, with the failure each actually produced (verified by breaking
 * the component, running, and restoring — not predicted):
 *
 *   1. `formatMeasureValue`: `if (numeric === null) return null` ->
 *      `if (!numeric) return null`
 *      => "shows a measured zero as a number" and "shows a measured zero that
 *         arrived as a string" fail: unable to find text "0 per year".
 *   2. `buildMeasurePayload`: `baselineValue: baselineValue.value` ->
 *      `Number(draft.baselineValue)`
 *      => "sends an untouched baseline box as null, never as 0" fails:
 *         expected +0 to be null.
 *   3. `parseOptionalDecimal`: drop the `if (!trimmed) return {ok:true,
 *      value:null}` early return
 *      => same test fails: expected +0 to be null.
 *   4. delete the duplicate-key check in `buildMeasurePayload`
 *      => "refuses a duplicate key before spending a request" fails: fetch was
 *         called once.
 *   5. `dataSource ? … : <warning>` -> `dataSource ? … : null`
 *      => "says out loud that a measure has no data source" fails.
 *   6. delete the sentence naming what a measure is from the empty state
 *      => "explains what a performance measure is when there are none" fails.
 *   7. delete the in-form banner from the CREATE form
 *      => four refusal tests fail with "Unable to find role=alert".
 *   8. delete the in-form banner from the EDIT form
 *      => ONLY "puts a refusal inside the edit form" fails.
 *      This test exists BECAUSE of an accidental mutation that deleted exactly
 *      this line and broke nothing: the two forms each render the banner, and a
 *      suite that only drives the create form leaves the other half unguarded.
 *   9. restore the pre-review display-order behaviour — `if (value !== null &&
 *      !Number.isInteger(value))` plus `sortOrder: value ?? 0`
 *      => "refuses an emptied display order" and "puts a refusal inside the
 *         edit form" fail: no alert, and the request goes out with 0.
 *      CORRECTION worth keeping: the first attempt at this mutation deleted the
 *      null branch but left `!Number.isInteger(value)` UNGUARDED, so null still
 *      produced a refusal ("must be a whole number") and every test passed. A
 *      mutation that does not reproduce the ORIGINAL code proves nothing about
 *      the change — it only proves the file is still self-consistent.
 */

const REFRESH = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: REFRESH, push: vi.fn() }) }));

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";

function measure(overrides: Partial<RtpPerformanceMeasureRow> = {}): RtpPerformanceMeasureRow {
  return {
    id: "measure-1",
    measureKey: "fatalities",
    label: "Traffic fatalities",
    unit: "per year",
    baselineValue: null,
    baselineYear: null,
    targetValue: null,
    targetYear: null,
    dataSource: "CCRS 2024",
    notes: null,
    sortOrder: 0,
    ...overrides,
  };
}

const fetchMock = vi.fn();

/** The JSON body of the single request the component made. */
function sentBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ measure: {} }) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("a measured zero survives the screen", () => {
  it("shows a measured zero as a number, not as 'no baseline recorded'", () => {
    render(
      <RtpPerformanceMeasureEditor
        rtpCycleId={CYCLE_ID}
        measures={[measure({ baselineValue: 0, baselineYear: 2024 })]}
        canWrite
      />
    );

    expect(screen.getByText("0 per year")).toBeInTheDocument();
    expect(screen.queryByText("No baseline recorded")).not.toBeInTheDocument();
  });

  it("shows a measured zero that arrived as a string", () => {
    // `NUMERIC(18,4)` can reach a page as `"0"`, and `typeof value === "number"`
    // would read that as "not measured".
    render(
      <RtpPerformanceMeasureEditor
        rtpCycleId={CYCLE_ID}
        measures={[measure({ baselineValue: "0", targetValue: "0.0000" })]}
        canWrite
      />
    );

    expect(screen.getAllByText("0 per year").length).toBe(2);
  });

  it("still says so when a baseline really is absent", () => {
    render(<RtpPerformanceMeasureEditor rtpCycleId={CYCLE_ID} measures={[measure()]} canWrite />);

    expect(screen.getByText("No baseline recorded")).toBeInTheDocument();
    expect(screen.getByText("No target set")).toBeInTheDocument();
  });
});

describe("authoring a measure", () => {
  function openCreateForm() {
    render(<RtpPerformanceMeasureEditor rtpCycleId={CYCLE_ID} measures={[measure()]} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /Add performance measure/i }));
  }

  it("labels every box a planner has to fill in", () => {
    openCreateForm();

    for (const label of [
      /^Measure name$/,
      /^Measure key$/,
      /^Unit/,
      /^Baseline value/,
      /^Baseline year/,
      /^Target value/,
      /^Target year/,
      /^Data source/,
      /^Notes/,
      /^Display order/,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("sends an untouched baseline box as null, never as 0", async () => {
    openCreateForm();

    fireEvent.change(screen.getByLabelText(/^Measure key$/), { target: { value: "bridge-condition" } });
    fireEvent.change(screen.getByLabelText(/^Measure name$/), { target: { value: "Bridges in poor condition" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add measure$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = sentBody();
    // `Number("")` is 0. A 0 here is an agency publishing a baseline it never
    // measured, and the route would store it faithfully.
    expect(body.baselineValue).toBeNull();
    expect(body.targetValue).toBeNull();
    expect(body.baselineYear).toBeNull();
    expect(body.targetYear).toBeNull();
  });

  it("sends a typed zero as zero", async () => {
    openCreateForm();

    fireEvent.change(screen.getByLabelText(/^Measure key$/), { target: { value: "ped-fatalities" } });
    fireEvent.change(screen.getByLabelText(/^Measure name$/), { target: { value: "Pedestrian fatalities" } });
    fireEvent.change(screen.getByLabelText(/^Baseline value/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add measure$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody().baselineValue).toBe(0);
  });

  it("refuses a duplicate key before spending a request", async () => {
    openCreateForm();

    fireEvent.change(screen.getByLabelText(/^Measure key$/), { target: { value: "fatalities" } });
    fireEvent.change(screen.getByLabelText(/^Measure name$/), { target: { value: "Another go at fatalities" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add measure$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already has a measure with the key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts the refusal inside the form the planner just submitted", async () => {
    // A plan with a dozen measures puts the form far below the section
    // heading. A banner pinned to the top is then a refusal a sighted planner
    // never sees — the Save button appears to do nothing at all.
    openCreateForm();

    fireEvent.change(screen.getByLabelText(/^Measure key$/), { target: { value: "fatalities" } });
    fireEvent.change(screen.getByLabelText(/^Measure name$/), { target: { value: "Duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add measure$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.closest("form")).not.toBeNull();
    // One alert, so a screen reader announces the refusal once.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("refuses an emptied display order rather than silently sending 0", async () => {
    // The route's own rule for `sort_order`: a blank box is a caller mistake,
    // not an "unset". Reading it as 0 would move an edited measure to the top
    // of the plan's list without anyone choosing that.
    openCreateForm();

    fireEvent.change(screen.getByLabelText(/^Measure key$/), { target: { value: "transit-ridership" } });
    fireEvent.change(screen.getByLabelText(/^Measure name$/), { target: { value: "Annual transit boardings" } });
    fireEvent.change(screen.getByLabelText(/^Display order/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add measure$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/display order/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the box a refusal is about", async () => {
    openCreateForm();

    fireEvent.change(screen.getByLabelText(/^Measure key$/), { target: { value: "vmt" } });
    fireEvent.change(screen.getByLabelText(/^Measure name$/), { target: { value: "VMT per capita" } });
    fireEvent.change(screen.getByLabelText(/^Baseline year/), { target: { value: "1492" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add measure$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/baseline year/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("correcting an existing measure", () => {
  function openEditForm() {
    render(
      <RtpPerformanceMeasureEditor
        rtpCycleId={CYCLE_ID}
        measures={[measure({ baselineValue: 0, baselineYear: 2024 })]}
        canWrite
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Edit Traffic fatalities/i }));
  }

  it("sends the correction as a PATCH naming the measure, and keeps its zero", async () => {
    openEditForm();

    fireEvent.change(screen.getByLabelText(/^Data source/), { target: { value: "CCRS 2025" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save measure$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const body = sentBody();
    expect(body.measureId).toBe("measure-1");
    expect(body.dataSource).toBe("CCRS 2025");
    // The form was seeded from a measured zero; saving an unrelated edit must
    // not turn it into "not measured".
    expect(body.baselineValue).toBe(0);
  });

  it("puts a refusal inside the edit form, not only above the list", async () => {
    // Found by an accidental mutation: the create form and the edit form each
    // render this banner, and a test that only drives the create form leaves
    // the other half free to lose it.
    openEditForm();

    fireEvent.change(screen.getByLabelText(/^Display order/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save measure$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.closest("form")).not.toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what the row says about its own evidence", () => {
  it("says out loud that a measure has no data source", () => {
    render(
      <RtpPerformanceMeasureEditor rtpCycleId={CYCLE_ID} measures={[measure({ dataSource: null })]} canWrite />
    );

    expect(screen.getByText(/assertion rather than\s+evidence/i)).toBeInTheDocument();
  });

  it("explains what a performance measure is when there are none", () => {
    render(<RtpPerformanceMeasureEditor rtpCycleId={CYCLE_ID} measures={[]} canWrite />);

    expect(screen.getByText(/No performance measures recorded/i)).toBeInTheDocument();
    // An empty state that only says "none" leaves a planner with nothing to do.
    expect(screen.getByText(/where the numbers come from/i)).toBeInTheDocument();
  });

  it("offers a reader no way to author anything", () => {
    render(<RtpPerformanceMeasureEditor rtpCycleId={CYCLE_ID} measures={[measure()]} canWrite={false} />);

    expect(screen.queryByRole("button", { name: /Add performance measure/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/i })).not.toBeInTheDocument();
  });
});
