import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunStage, type ModelRunArtifact } from "@/components/models/model-run-manager";

/**
 * THE CEQA SCREEN'S ENGINE GATE, AT THE ONLY PLACE THE BROWSER ENFORCES IT.
 *
 * The sketch ABM lane publishes its KPIs under `daily_vmt`, `vmt_per_capita`,
 * and `population_total` — names that ARE members of the CEQA KPI sets in
 * `src/lib/models/ceqa-vmt-screen.ts`. So the KPI-namespace firewall that keeps
 * ITE trip-gen VMT out of the CEQA screen does NOT exist for sketch_abm: if the
 * screen is handed a sketch run's KPIs, `deriveCeqaVmtScreeningInputs` happily
 * screens them, and the repo's own record documents sketch VMT running ~56%
 * below the CARB reference — which is exactly how a false "less than
 * significant" renders. The server route refuses to STORE a determination from
 * a sketch run (`VMT_DETERMINATION_ELIGIBLE_ENGINE_KEYS`), but the browser
 * screen computes and DISPLAYS one client-side before any save. The only thing
 * between a sketch run and that displayed determination is the mount condition
 * in `model-run-manager.tsx` (`run.engine_key === "aequilibrae"`). This suite
 * makes that condition structural instead of conventional.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// The study-area picker and the network map mount Mapbox; neither is under test.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

function succeededRun(engineKey: string) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "succeeded",
    run_title: "Any-place screening run",
    engine_key: engineKey,
    source_analysis_run_id: null,
    scenario_entry_id: null,
    result_summary_json: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: null,
    stages: [] as ModelRunStage[],
    artifacts: [] as ModelRunArtifact[],
    claimStatus: null,
  };
}

function renderManagerWith(run: ReturnType<typeof succeededRun>) {
  return render(
    <ModelRunManager
      modelId={MODEL_ID}
      modelTitle="Any-place screening"
      defaultQueryText="Screening run"
      defaultCorridorText=""
      scenarioEntries={[]}
      modelRuns={[run]}
      schemaPending={false}
    />
  );
}

const CEQA_SCREEN_BUTTON = /Run CEQA screen/i;

describe("ModelRunManager CEQA-screen mount gate", () => {
  it("renders the CEQA VMT screen for a succeeded aequilibrae run (positive control)", () => {
    renderManagerWith(succeededRun("aequilibrae"));
    expect(screen.getByRole("button", { name: CEQA_SCREEN_BUTTON })).toBeInTheDocument();
  });

  it("never mounts the CEQA VMT screen for a succeeded sketch_abm run", () => {
    // Sketch KPI names pass the CEQA name filter, so this mount condition is the
    // ONLY thing preventing a browser-rendered determination from sketch VMT.
    renderManagerWith(succeededRun("sketch_abm"));
    expect(screen.queryByRole("button", { name: CEQA_SCREEN_BUTTON })).toBeNull();
  });

  it("never mounts the CEQA VMT screen for an unfinished aequilibrae run", () => {
    const run = { ...succeededRun("aequilibrae"), status: "failed" };
    renderManagerWith(run);
    expect(screen.queryByRole("button", { name: CEQA_SCREEN_BUTTON })).toBeNull();
  });
});
