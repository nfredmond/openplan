import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

function mockEvidenceFetch(packet: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => packet }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel(engineKey: string) {
  return render(
    <ModelRunEvidencePanel
      modelId={MODEL_ID}
      modelRunId={MODEL_RUN_ID}
      runTitle="Davis screening run"
      runStatus="succeeded"
      engineKey={engineKey}
      comparisonCandidates={[]}
    />
  );
}

async function openEvidence() {
  fireEvent.click(screen.getByRole("button", { name: /inspect evidence/i }));
  await waitFor(() => expect(screen.getByTestId("evidence-run-honesty")).toBeInTheDocument());
}

const AEQUILIBRAE_PACKET = {
  engine: "aequilibrae",
  mode_split: { transit_status: "no_local_feed", auto_mode_share_pct: 94.5 },
  provenance: {
    engine_version: "aeq-1.6.2",
    run_started_at: "2026-07-22T17:00:00.000Z",
    run_completed_at: "2026-07-22T17:06:00.000Z",
  },
  inputs: { zone_count: 42 },
  assumptions: { corridor_geojson_hash: "abcdef1234567890ffff" },
  caveats: ["Uncalibrated", "Screening-grade"],
};

describe("ModelRunEvidencePanel run-honesty header", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("badges an off-Nevada aequilibrae run as screening-grade with an honest transit label", async () => {
    mockEvidenceFetch(AEQUILIBRAE_PACKET);
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Screening-grade");
    expect(block).toHaveTextContent("Uncalibrated by default");
    // The load-bearing honesty distinction: 0 transit share is a feed gap.
    expect(block).toHaveTextContent("Transit not modeled — no local GTFS feed");
    // Reproducibility snapshot.
    expect(block).toHaveTextContent("aeq-1.6.2");
    expect(block).toHaveTextContent("42");
    expect(block).toHaveTextContent("abcdef123456");
  });

  it("shows a modeled-transit label when a covering feed was skimmed", async () => {
    mockEvidenceFetch({ ...AEQUILIBRAE_PACKET, mode_split: { transit_status: "modeled" } });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Transit modeled (local GTFS)");
    expect(block).not.toHaveTextContent("not modeled");
  });

  it("badges a prototype-surface engine as prototype-only, not screening-grade", async () => {
    mockEvidenceFetch({ engine: "behavioral_demand" });
    renderPanel("behavioral_demand");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Prototype-only");
    expect(block).not.toHaveTextContent("Uncalibrated by default");
  });
});
