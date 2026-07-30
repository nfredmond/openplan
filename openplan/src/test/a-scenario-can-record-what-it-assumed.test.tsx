import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioSpinePanel } from "@/components/scenarios/scenario-spine-panel";

/**
 * THREE QUARTERS OF THE PROVENANCE CHAIN, BUILT AND NEVER SHOWN.
 *
 * A scenario set carries assumption sets, data packages, indicator snapshots and
 * comparison snapshots. Only the last had a surface. The other three had
 * complete, tested, access-gated POST routes with no caller, and the summary GET
 * that returns all four was equally dark — so a planner could not record what a
 * scenario assumed, where its numbers came from, or what was measured, and could
 * not read any of it back.
 *
 * The tables sat empty, which reads as "this agency recorded no assumptions"
 * rather than "OpenPlan never offered to record any."
 */

const SET_ID = "11111111-1111-4111-8111-111111111111";

function spine(overrides: Record<string, unknown> = {}) {
  return {
    baseline: {
      id: "entry-baseline",
      label: "2025 baseline",
      summary: null,
      status: "active",
      attachedRunId: null,
      assumptionCount: 0,
    },
    branches: [
      {
        id: "entry-branch",
        label: "Corridor build",
        summary: null,
        status: "active",
        attachedRunId: null,
        assumptionCount: 2,
      },
    ],
    counts: { assumptionSets: 0, dataPackages: 0, indicatorSnapshots: 0, comparisonSnapshots: 0 },
    assumptionSets: [],
    dataPackages: [],
    indicatorSnapshots: [],
    schemaPending: false,
    ...overrides,
  };
}

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const renderPanel = async () => {
  const result = render(<ScenarioSpinePanel scenarioSetId={SET_ID} />);
  await screen.findByRole("heading", { name: /Assumption sets/i });
  return result;
};

describe("a scenario can record what it assumed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(spine())));
  });

  it("reads the spine summary that had no caller", async () => {
    await renderPanel();

    expect(fetch).toHaveBeenCalledWith(`/api/scenarios/${SET_ID}/spine`);
  });

  it("shows all three record kinds, not just the one that was already wired", async () => {
    await renderPanel();

    expect(screen.getByRole("heading", { name: /Assumption sets/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Data packages/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Indicator snapshots/i })).toBeInTheDocument();
  });

  it("writes an assumption set through the route that had no caller", async () => {
    await renderPanel();

    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[0]));
    fireEvent.change(screen.getByLabelText(/^label$/i), { target: { value: "Trend growth" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^save$/i })));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/scenarios/${SET_ID}/spine/assumption-sets`,
        expect.objectContaining({ method: "POST" })
      );
    });
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].endsWith("assumption-sets")
    );
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject({
      label: "Trend growth",
      status: "draft",
    });
  });

  it("re-reads the spine after a write instead of showing what was submitted", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok(spine()))
      .mockResolvedValueOnce(ok({ assumptionSet: { id: "as-1" } }))
      .mockResolvedValueOnce(
        ok(
          spine({
            counts: { assumptionSets: 1, dataPackages: 0, indicatorSnapshots: 0, comparisonSnapshots: 0 },
            assumptionSets: [
              {
                id: "as-1",
                scenario_entry_id: "entry-baseline",
                // The route can attach to the baseline and normalise what was
                // sent, so the stored row is not always the submitted one.
                label: "Trend growth (baseline)",
                summary: null,
                status: "draft",
                updated_at: "2026-07-30T00:00:00Z",
              },
            ],
          })
        )
      );

    await renderPanel();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[0]));
    fireEvent.change(screen.getByLabelText(/^label$/i), { target: { value: "Trend growth" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^save$/i })));

    expect(await screen.findByText("Trend growth (baseline)")).toBeInTheDocument();
  });

  it("keeps the form open and says nothing was saved when the write fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok(spine()))
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Scenario entry not found" }) });

    await renderPanel();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[0]));
    fireEvent.change(screen.getByLabelText(/^label$/i), { target: { value: "Trend growth" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^save$/i })));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Scenario entry not found/i);
    // Losing typed input on a failed save is how a planner loses a paragraph.
    expect(screen.getByLabelText(/^label$/i)).toHaveValue("Trend growth");
  });

  it("calls a pending migration what it is, and offers nothing to write to", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok(spine({ schemaPending: true })));

    await renderPanel();

    // Zero rows because the tables do not exist is not the same fact as zero
    // rows because nobody recorded any, and only one is about this agency.
    expect(screen.getByText(/pending migration, not an empty scenario set/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^add$/i })).toBeNull();
  });

  it("does not report a failed read as an empty spine", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Failed to load scenario spine" }),
    });

    render(<ScenarioSpinePanel scenarioSetId={SET_ID} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/problem reading the records, not a statement that there are none/i);
  });

  it("offers every scenario branch as a target, with baseline the default", async () => {
    await renderPanel();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: /^add$/i })[0]));

    const select = screen.getByLabelText(/^scenario$/i) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Baseline",
      "2025 baseline",
      "Corridor build",
    ]);
  });
});
