import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

const BENCHMARK_FIT_BLOCK = {
  grade: "sketch_screening",
  vmt_percent_error: 18.2,
  mode_split_rmse: 6.4,
  fit_score_0_100: 49.6,
  components: { vmt_score: 63.6, mode_split_score: 36 },
  reference: {
    vmt_per_capita: 22,
    mode_split_pct: { auto: 88, transit: 1.5, walk: 6, bike: 1.5, shared: 3 },
  },
  sources: ["VMT per capita reference 22.0 — a screening reference, not a local observation."],
  recommendation: "Large deviation from reference benchmarks — treat results as illustrative",
};

function mockEvidenceFetch(packet: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => packet,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel() {
  return render(
    <ModelRunEvidencePanel
      modelId={MODEL_ID}
      modelRunId={MODEL_RUN_ID}
      runTitle="Sketch corridor run"
      runStatus="succeeded"
      engineKey="sketch_abm"
      comparisonCandidates={[]}
    />
  );
}

async function openEvidence() {
  fireEvent.click(screen.getByRole("button", { name: /inspect evidence/i }));
  await waitFor(() => expect(screen.getByText(/packet posture/i)).toBeInTheDocument());
}

describe("ModelRunEvidencePanel benchmark fit block", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders score, components, errors, recommendation, sources, and the distinction line", async () => {
    mockEvidenceFetch({
      engine: "sketch_abm",
      benchmark_fit: BENCHMARK_FIT_BLOCK,
      caveats: ["Screening-grade sketch output over a synthetic population and distance-based skims."],
    });

    renderPanel();
    await openEvidence();

    const block = screen.getByTestId("evidence-benchmark-fit");
    expect(block).toHaveTextContent("Benchmark fit");
    expect(block).toHaveTextContent("Fit 50/100");
    expect(block).toHaveTextContent("VMT component");
    expect(block).toHaveTextContent("64/100");
    expect(block).toHaveTextContent("Mode-split component");
    expect(block).toHaveTextContent("36/100");
    expect(block).toHaveTextContent("+18.2%");
    expect(block).toHaveTextContent("6.4 pct-pts");
    expect(block).toHaveTextContent(
      "Large deviation from reference benchmarks — treat results as illustrative"
    );
    expect(block).toHaveTextContent("not a local observation");
    // The one-sentence distinction between county-run validation and
    // sketch benchmark fit.
    expect(block).toHaveTextContent(
      "County-run validation compares against observed traffic counts, while sketch benchmark fit compares against reference benchmarks only."
    );
  });

  it("uses the warning badge tone when the fit score is below 60", async () => {
    mockEvidenceFetch({ engine: "sketch_abm", benchmark_fit: BENCHMARK_FIT_BLOCK });

    renderPanel();
    await openEvidence();

    const badge = screen.getByText("Fit 50/100");
    expect(badge.className).toContain("--copper");
  });

  it("uses a non-warning badge tone at or above 60", async () => {
    mockEvidenceFetch({
      engine: "sketch_abm",
      benchmark_fit: { ...BENCHMARK_FIT_BLOCK, fit_score_0_100: 82.3 },
    });

    renderPanel();
    await openEvidence();

    const badge = screen.getByText("Fit 82/100");
    expect(badge.className).not.toContain("--copper");
  });

  it("omits the block entirely when the packet has no benchmark fit", async () => {
    mockEvidenceFetch({ engine: "aequilibrae" });

    renderPanel();
    await openEvidence();

    expect(screen.queryByTestId("evidence-benchmark-fit")).not.toBeInTheDocument();
  });
});
