import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectComparisonStarter } from "@/components/models/project-comparison-starter";
import { summarizeProjectComparison } from "@/lib/models/project-comparison";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const EMPTY = {
  areaLabel: "Mendocino County",
  networkCount: 0,
  scenarioSetCount: 0,
  modelCount: 0,
  aequilibraeModelCount: 0,
  activitySimModelCount: 0,
  runCount: 0,
  aequilibraeRunCount: 0,
  activitySimRunCount: 0,
  checkedRunCount: 0,
  comparisonPacketCount: 0,
  unreadable: [],
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("project comparison guidance", () => {
  it("does not turn missing evidence into a traffic, VMT, or value claim", () => {
    const summary = summarizeProjectComparison(EMPTY);
    expect(summary.state).toBe("not_started");
    expect(summary.firstMissingStep).toBe("network");
    expect(summary.trafficAnswer).toMatch(/^Unavailable/);
    expect(summary.vmtAnswer).toMatch(/^Unavailable/);
    expect(summary.valueAnswer).toMatch(/Not supportable/);
    expect(summary.uncertainties).toContain("No shared road-network basis is registered.");
  });

  it("lets the long not-started status wrap inside a narrow comparison panel", () => {
    render(
      <ProjectComparisonStarter
        projectId="11111111-1111-4111-8111-111111111111"
        projectName="Main Street"
        facts={EMPTY}
      />,
    );

    expect(screen.getByText("Baseline-versus-build comparison not started")).toHaveClass(
      "min-w-0",
      "max-w-full",
      "shrink",
      "whitespace-normal",
    );
  });

  it("keeps a failed fact read unknown instead of calling it absent", () => {
    const summary = summarizeProjectComparison({ ...EMPTY, unreadable: ["run"] });
    expect(summary.state).toBe("unknown");
    expect(summary.trafficAnswer).toMatch(/could not be read/);
    expect(summary.uncertainties).toEqual(["The run record could not be read."]);
  });

  it("treats a registered managed basis as ready while disclosing the snapshot is not a result", () => {
    const summary = summarizeProjectComparison({
      ...EMPTY,
      managedNetworkBasisCount: 1,
      scenarioSetCount: 1,
      modelCount: 2,
      aequilibraeModelCount: 1,
      activitySimModelCount: 1,
    });
    expect(summary.state).toBe("runs_missing");
    expect(summary.firstMissingStep).toBe("run");
    expect(summary.uncertainties).not.toContain("No shared road-network basis is registered.");
    expect(summary.trafficAnswer).toMatch(/^Unavailable/);
  });

  it("reports a saved exact comparison as stale instead of denying that it exists", () => {
    const summary = summarizeProjectComparison({
      ...EMPTY,
      managedNetworkBasisCount: 1,
      guidedProjectComparison: true,
      scenarioSetCount: 1,
      modelCount: 2,
      aequilibraeModelCount: 1,
      activitySimModelCount: 1,
      aequilibraeRunCount: 2,
      activitySimRunCount: 2,
      guidedComparisonCheckedCount: 1,
      comparisonPacketCount: 0,
      savedComparisonPacketCount: 1,
    });

    expect(summary.state).toBe("packet_stale");
    expect(summary.label).toBe("Saved comparison needs refresh");
    expect(summary.uncertainties).toContain("The saved comparison does not match the latest exact four outputs; preserve it and save a refreshed snapshot after review.");
    expect(summary.uncertainties.join(" ")).not.toMatch(/No unaveraged baseline-versus-build comparison report is saved/);
  });

  it("starts one project-scoped scaffold and sends the planner to the first real missing input", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        scenarioSetId: "scenario-1",
        networkBasis: "worker_osm_snapshot",
        nextRun: {
          method: "aequilibrae",
          scenario: "baseline",
          modelId: "model-aeq",
          scenarioEntryId: "entry-baseline",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProjectComparisonStarter
        projectId="11111111-1111-4111-8111-111111111111"
        projectName="Main Street"
        facts={EMPTY}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Begin guided comparison" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/models/project-comparison",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectId: "11111111-1111-4111-8111-111111111111" }),
      }),
    );
    expect(navigation.push).toHaveBeenCalledWith(
      "/models/model-aeq?projectId=11111111-1111-4111-8111-111111111111&scenarioEntryId=entry-baseline#run-model",
    );
  });

  it("requires a sourced, non-zero build change before routing to a build run", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: "needs_build_assumption",
          scenarioSetId: "scenario-1",
          networkBasis: "worker_osm_snapshot",
          buildAssumptionRequired: true,
          nextRun: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: "ready_for_run",
          scenarioSetId: "scenario-1",
          networkBasis: "worker_osm_snapshot",
          nextRun: {
            method: "aequilibrae",
            scenario: "build",
            modelId: "model-aeq",
            scenarioEntryId: "entry-build",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProjectComparisonStarter
        projectId="11111111-1111-4111-8111-111111111111"
        projectName="Main Street"
        facts={{ ...EMPTY, scenarioSetCount: 1, modelCount: 2 }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue guided comparison" }));
    expect(await screen.findByTestId("guided-build-assumption")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Daily auto-trip change (%)"), { target: { value: "-8" } });
    fireEvent.change(screen.getByLabelText("What that change is based on"), {
      target: { value: "Local corridor mode-shift study, 2025" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save assumption and continue" }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(
      "/models/model-aeq?projectId=11111111-1111-4111-8111-111111111111&scenarioEntryId=entry-build#run-model",
    ));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/models/project-comparison",
      expect.objectContaining({
        body: JSON.stringify({
          projectId: "11111111-1111-4111-8111-111111111111",
          buildAssumption: {
            autoTripChangePct: -8,
            basis: "Local corridor mode-shift study, 2025",
          },
        }),
      }),
    );
  });

  it("reports successful ActivitySim preflight without routing as though assignment finished", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: "needs_activitysim_runtime",
          scenarioSetId: "scenario-1",
          networkBasis: "worker_osm_snapshot",
          nextRun: {
            method: "activitysim",
            scenario: "baseline",
            modelId: "model-asim",
            scenarioEntryId: "entry-baseline",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: "ready_for_run",
          scenarioSetId: "scenario-1",
          networkBasis: "worker_osm_snapshot",
          nextRun: {
            method: "activitysim",
            scenario: "baseline",
            modelId: "model-asim",
            scenarioEntryId: "entry-baseline",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProjectComparisonStarter
        projectId="11111111-1111-4111-8111-111111111111"
        projectName="Main Street"
        facts={{ ...EMPTY, scenarioSetCount: 1, modelCount: 2 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue guided comparison" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/preflight succeeded.*no assigned link volumes/i);
    expect(navigation.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry ActivitySim after configuring runtime" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(
      "/models/model-asim?projectId=11111111-1111-4111-8111-111111111111&scenarioEntryId=entry-baseline#run-model",
    ));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/models/project-comparison",
      expect.objectContaining({
        body: JSON.stringify({
          projectId: "11111111-1111-4111-8111-111111111111",
          retryActivitySim: true,
        }),
      }),
    );
  });

  it("reports a missing ActivitySim assignment artifact separately from unavailable runtime", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "needs_activitysim_output",
        scenarioSetId: "scenario-1",
        networkBasis: "worker_osm_snapshot",
        nextRun: {
          method: "activitysim",
          scenario: "baseline",
          modelId: "model-asim",
          scenarioEntryId: "entry-baseline",
        },
      }),
    }));

    render(
      <ProjectComparisonStarter
        projectId="11111111-1111-4111-8111-111111111111"
        projectName="Main Street"
        facts={{ ...EMPTY, scenarioSetCount: 1, modelCount: 2 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue guided comparison" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/job finished.*could not verify assigned link-volume output/i);
    expect(status).not.toHaveTextContent(/configure an ActivitySim execution runtime/i);
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
