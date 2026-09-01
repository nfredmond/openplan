import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { GuidedComparisonSaveButton } from "@/components/scenarios/guided-comparison-save";

const props = {
  scenarioSetId: "11111111-1111-4111-8111-111111111111",
  baselineEntryId: "22222222-2222-4222-8222-222222222222",
  baselineEntryLabel: "No-build baseline",
  candidateEntryId: "33333333-3333-4333-8333-333333333333",
  candidateEntryLabel: "Build scenario",
};

describe("exact guided comparison save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the existing comparison route to freeze four separate exact outputs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comparisonSnapshot: { id: "snapshot-1", status: "ready" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GuidedComparisonSaveButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Save exact guided comparison" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/scenarios/${props.scenarioSetId}/spine/comparison-snapshots`);
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      baselineEntryId: props.baselineEntryId,
      candidateEntryId: props.candidateEntryId,
      status: "ready",
      metadata: { kind: "guided_project_comparison" },
    });
    expect(body.summary).toContain("AequilibraE and ActivitySim remain separate");
    expect(body.caveats).toEqual(expect.arrayContaining([
      expect.stringContaining("not calibration or a forecast"),
      expect.stringContaining("No method averaging"),
    ]));
    expect(await screen.findByText("Exact guided comparison saved.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the route's exact repair state instead of claiming a save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "A ready guided comparison requires current baseline and build output artifacts from both methods.",
        repairState: "needs_model_outputs",
      }),
    }));

    render(<GuidedComparisonSaveButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Save exact guided comparison" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A ready guided comparison requires current baseline and build output artifacts from both methods. Repair state: needs model outputs.",
    );
    expect(screen.queryByText("Exact guided comparison saved.")).not.toBeInTheDocument();
  });

  it("is reachable from the scenario page only for a declared guided comparison", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../app/(app)/scenarios/[scenarioSetId]/page.tsx"),
      "utf8",
    );
    expect(page).toContain("GuidedComparisonSavePanel");
    expect(page).toContain("hasGuidedProjectComparisonIntent");
    expect(page).toContain("config_json");
    expect(page).toContain("guidedComparisonAlreadySaved");
  });

  it("does not call an attached worker run missing in the legacy readiness card", () => {
    const registry = readFileSync(
      path.resolve(__dirname, "../components/scenarios/scenario-entry-registry.tsx"),
      "utf8",
    );
    expect(registry).toContain("baselineRunId ?? baselineModelRunId");
    expect(registry).toContain("entry.attached_run_id ?? entry.attached_model_run_id");
  });

  it("states the rough four-job duration before the project start control", () => {
    const modelsPage = readFileSync(
      path.resolve(__dirname, "../app/(app)/models/page.tsx"),
      "utf8",
    );
    const selector = modelsPage.indexOf('id="choose-project-comparison"');
    const start = modelsPage.indexOf("Start project comparison", selector);
    const estimate = modelsPage.indexOf("Time to allow: roughly 10–40 minutes", selector);
    expect(selector).toBeGreaterThan(-1);
    expect(estimate).toBeGreaterThan(selector);
    expect(estimate).toBeLessThan(start);
  });
});
