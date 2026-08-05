/**
 * Recording what a project costs in a plan.
 *
 * The whole fiscal-constraint check depends on one distinction surviving the
 * round trip: a project with no cost recorded is UNPRICED, and unpriced is not
 * zero. If this control ever submits 0 for a blank field, a plan's constrained
 * total looks complete while a project's real cost was never entered, and the
 * plan reports itself fiscally constrained — on the one number a funder
 * verifies. That is what most of this file is about.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { RtpLinkCostEditor } from "@/components/projects/rtp-link-cost-editor";

const BANDS = [
  { id: "band-1", label: "First ten years", startYear: 2026, endYear: 2035 },
  { id: "band-2", label: "2036–2050", startYear: 2036, endYear: 2050 },
];

function renderEditor(overrides: Partial<React.ComponentProps<typeof RtpLinkCostEditor>> = {}) {
  return render(
    <RtpLinkCostEditor
      projectId="project-1"
      linkId="link-1"
      bands={BANDS}
      initialEstimatedCost={null}
      initialCostBasisYear={null}
      initialHorizonBandId={null}
      canWrite
      {...overrides}
    />
  );
}

function mockFetch(ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    json: async () => (ok ? {} : { error: "Nope" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof mockFetch>) {
  const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe("an unpriced project says so, rather than showing a zero", () => {
  it("tells the planner the project is not counted in the fiscal constraint", () => {
    renderEditor();
    expect(screen.getByText(/not counted in the plan's fiscal constraint/i)).toBeInTheDocument();
    // The failure this guards: rendering an absent cost as $0.
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("shows the recorded cost, its basis year and its period once entered", () => {
    renderEditor({
      initialEstimatedCost: 25_000_000,
      initialCostBasisYear: 2026,
      initialHorizonBandId: "band-1",
    });
    expect(screen.getByText("$25,000,000")).toBeInTheDocument();
    expect(screen.getByText(/in 2026 dollars/)).toBeInTheDocument();
    expect(screen.getByText(/First ten years/)).toBeInTheDocument();
  });

  it("says outright when a cost has no period assigned", () => {
    renderEditor({ initialEstimatedCost: 25_000_000, initialHorizonBandId: null });
    expect(screen.getByText(/no period assigned/i)).toBeInTheDocument();
  });
});

describe("submitting", () => {
  it("sends NULL, not 0, when the cost field is left blank", async () => {
    const fetchMock = mockFetch();
    renderEditor({ initialEstimatedCost: 25_000_000, initialCostBasisYear: 2026 });

    fireEvent.click(screen.getByRole("button", { name: /edit cost/i }));
    fireEvent.change(screen.getByLabelText(/programmed cost in this plan/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save cost/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock);
    // THE assertion this file exists for.
    expect(body.estimatedCost).toBeNull();
    expect(body.estimatedCost).not.toBe(0);
  });

  it("sends the number when a cost is entered", async () => {
    const fetchMock = mockFetch();
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /add cost/i }));
    fireEvent.change(screen.getByLabelText(/programmed cost in this plan/i), { target: { value: "40000000" } });
    fireEvent.click(screen.getByRole("button", { name: /save cost/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).estimatedCost).toBe(40_000_000);
  });

  it("never lets a negative cost reach the server", async () => {
    const fetchMock = mockFetch();
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /add cost/i }));
    const input = screen.getByLabelText(/programmed cost in this plan/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /save cost/i }));

    // The `min="0"` constraint refuses the submit before the handler runs, so
    // the component's own negative check never fires here — asserted as the
    // ACTUAL behaviour rather than the one I first assumed. Both layers exist
    // on purpose: the attribute stops a person, the handler stops a
    // programmatic value, and the route rejects it a third time.
    expect(input).toBeInvalid();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the form open and shows the server's own words when a save is refused", async () => {
    const fetchMock = mockFetch(false);
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /add cost/i }));
    fireEvent.change(screen.getByLabelText(/programmed cost in this plan/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /save cost/i }));

    await waitFor(() => expect(screen.getByText("Nope")).toBeInTheDocument());
    // It DID reach the server — this is a server-side refusal, not a client one.
    expect(fetchMock).toHaveBeenCalled();
    // And a refused save must not look like a successful one.
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /save cost/i })).toBeInTheDocument();
  });
});

describe("the period a cost is filed under", () => {
  it("offers only the periods this link's own plan declares", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /add cost/i }));

    const select = screen.getByLabelText(/period of the plan that pays for it/i);
    const options = Array.from(select.querySelectorAll("option")).map((option) => option.textContent);
    expect(options).toEqual([
      "No period assigned",
      "First ten years (2026–2035)",
      "2036–2050 (2036–2050)",
    ]);
  });

  it("explains what to do when the plan has declared no periods yet", async () => {
    renderEditor({ bands: [] });
    fireEvent.click(screen.getByRole("button", { name: /add cost/i }));

    // A dead select would leave a planner with no idea why they cannot proceed.
    expect(screen.getByText(/no periods declared yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/period of the plan that pays for it/i)).toBeNull();
  });
});

describe("a viewer", () => {
  it("sees the recorded cost and no control to change it", () => {
    renderEditor({ initialEstimatedCost: 25_000_000, canWrite: false });
    expect(screen.getByText("$25,000,000")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cost/i })).toBeNull();
  });
});
