import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";
import { modelingClaimReportLanguage } from "@/lib/models/evidence-backbone";
import {
  evidenceCountSourceStatusLabel,
  normalizeEvidencePacket,
  renderModelRunProvenanceMarkdown,
} from "@/lib/models/evidence-packet";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

const CREDIBILITY_PACKET = {
  packet_version: "2.0",
  run_id: MODEL_RUN_ID,
  model_id: MODEL_ID,
  model_title: "Davis count check",
  engine: "aequilibrae",
  count_source: {
    status: "available",
    dataset_id: "42um-tgh5",
    vintage: "2024",
    supported_road_classes: ["interstate", "minor_arterial"],
    eligible_rows: 120,
    excluded_rows: 7,
    exclusion_reasons: { non_inventory_direction: 4, ramp_not_represented: 3 },
    coverage_statement: "Federal-aid highway section AADT.",
    limitation: "Unsupported road classes are unknown, not zero traffic.",
  },
  gateway_volume_basis: {
    measured: 0,
    inferred: 8,
    unsupported: 2,
    default_method: "flat road-class daily volume times lanes",
    limitation: "The nationwide measured-AADT candidate failed independent validation.",
  },
  calibration_selection: {
    status: "selected",
    evidence_role: "candidate_selection_not_accuracy",
    baseline: { objective: 0.5007, median_ape: 40 },
    selected: { objective: 0.4016, median_ape: 44 },
    reason: "This holdout chose calibration steps and is not an independent accuracy result.",
  },
  independent_validation: {
    status: "not_run",
    supports_claim_tier: false,
    stations_matched: 0,
    median_ape: null,
    reason: "No untouched count set evaluated the selected calibration.",
  },
};

function normalized(packet: Record<string, unknown> = CREDIBILITY_PACKET) {
  return normalizeEvidencePacket({
    rawPacket: packet,
    modelId: MODEL_ID,
    modelRunId: MODEL_RUN_ID,
    modelTitle: "Davis count check",
    runRecord: { id: MODEL_RUN_ID, engine_key: "aequilibrae", status: "succeeded" },
    artifacts: [],
    stages: [],
    kpis: [],
    generatedAt: "2026-08-23T12:00:00.000Z",
  });
}

describe("model-run credibility evidence contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the four version-2 evidence blocks without promoting selection evidence", () => {
    const packet = normalized();
    expect(packet.packet_version).toBe("2.0");
    expect(packet.count_source).toMatchObject({ status: "available", dataset_id: "42um-tgh5", vintage: "2024" });
    expect(packet.gateway_volume_basis).toMatchObject({ measured: 0, inferred: 8, unsupported: 2 });
    expect(packet.calibration_selection).toMatchObject({ evidence_role: "candidate_selection_not_accuracy" });
    expect(packet.independent_validation).toEqual(expect.objectContaining({
      status: "not_run",
      supports_claim_tier: false,
    }));
  });

  it("keeps source failure states visibly different", () => {
    expect(evidenceCountSourceStatusLabel("source_unavailable")).toBe("Source unavailable");
    expect(evidenceCountSourceStatusLabel("geography_unsupported")).toBe("Geography unsupported");
    expect(evidenceCountSourceStatusLabel("no_eligible_sections")).toBe("No eligible sections");
    expect(evidenceCountSourceStatusLabel("no_traffic_found")).toBe("No traffic found");
  });

  it("defines the calibrated tier by separate untouched validation", () => {
    const language = modelingClaimReportLanguage({
      track: "assignment",
      claimStatus: "calibrated_to_counts",
      statusReason: "",
      reasons: [],
      validationSummary: {
        passed: 0,
        warned: 0,
        failed: 0,
        missingRequiredMetricKeys: [],
        requiredMetricKeys: [],
      },
    });
    expect(language).toContain("separate untouched observed-count validation");
    expect(language).toContain("candidate-selection record");
  });

  it("renders a downloadable provenance document from the normalized packet", () => {
    const markdown = renderModelRunProvenanceMarkdown(normalized());
    expect(markdown).toContain("# Model run provenance: Davis count check");
    expect(markdown).toContain("Dataset: 42um-tgh5");
    expect(markdown).toContain("Measured: 0");
    expect(markdown).toContain("Baseline median APE: 40%");
    expect(markdown).toContain("Selected median APE: 44%");
    expect(markdown).toContain("candidate-selection evidence, not an accuracy result");
    expect(markdown).toContain("Supports a count-backed accuracy statement: no");
  });

  it("shows the evidence and its limitations on the run page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => CREDIBILITY_PACKET })));
    render(
      <ModelRunEvidencePanel
        modelId={MODEL_ID}
        modelRunId={MODEL_RUN_ID}
        runTitle="Davis count check"
        runStatus="succeeded"
        engineKey="aequilibrae"
        comparisonCandidates={[]}
        claimStatus="prototype_only"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /inspect evidence/i }));
    const block = await waitFor(() => screen.getByTestId("model-run-credibility-evidence"));
    expect(block).toHaveTextContent("42um-tgh5");
    expect(block).toHaveTextContent("2024");
    expect(block).toHaveTextContent("interstate, minor_arterial");
    expect(block).toHaveTextContent("120 / 7");
    expect(block).toHaveTextContent("Measured");
    expect(block).toHaveTextContent("0");
    expect(block).toHaveTextContent("Inferred");
    expect(block).toHaveTextContent("8");
    expect(screen.getByTestId("gateway-volume-basis-counts")).toHaveClass(
      "grid-cols-1",
      "sm:grid-cols-3"
    );
    expect(block).toHaveTextContent("Baseline");
    expect(block).toHaveTextContent("0.5007");
    expect(block).toHaveTextContent("40%");
    expect(block).toHaveTextContent("Selected calibration");
    expect(block).toHaveTextContent("0.4016");
    expect(block).toHaveTextContent("44%");
    expect(block).toHaveTextContent("Selection evidence only");
    expect(block).toHaveTextContent("The holdout selects parameters. It is not an independent accuracy test.");
    expect(block).toHaveTextContent("Not run");
    expect(block).toHaveTextContent("No untouched count set evaluated the selected calibration");
    expect(screen.getByRole("link", { name: /download provenance document/i })).toHaveAttribute(
      "href",
      `/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/evidence-packet?format=markdown`
    );
  });
});
