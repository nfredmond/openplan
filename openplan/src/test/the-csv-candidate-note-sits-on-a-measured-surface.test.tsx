import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectEstimatedCostEditor } from "@/components/projects/project-estimated-cost-editor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * THE CSV CANDIDATE NOTE SITS ON A SURFACE THE PALETTE TEST MEASURES.
 *
 * Lane 84 ran axe-core 4.11.1 on the project Funding tab in dark mode at 1440
 * px: the muted note under "Bring in a project candidate from CSV" measured
 * 3.88:1 (#90959c on #33393d). The section was painted `bg-muted/20`, a tint of
 * the muted TEXT colour (KI-2026-11-14-111), which
 * `palette-text-clears-every-surface.test.ts` does not measure. `bg-secondary`
 * is one of the surfaces it does measure, in every palette and both modes.
 *
 * Blind category: the colour of the rendered pixels; this checks the class the
 * section is painted with, and the palette test checks that class's colours.
 */
describe("the CSV candidate section on the Funding tab", () => {
  it("is painted on bg-secondary, not on a tint of the muted text colour", () => {
    render(
      <ProjectEstimatedCostEditor
        project={{
          id: "33333333-3333-4333-8333-333333333333",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          estimated_cost_amount: null,
          estimated_cost_currency: null,
          estimated_cost_basis_year: null,
          estimated_cost_source_document_id: null,
        }}
        canWrite
        estimateSource={{ status: "unlinked", entry: null }}
        documents={[]}
      />
    );
    const section = screen.getByRole("region", { name: "Bring in a project candidate from CSV" });
    expect(section.className.split(/\s+/)).toContain("bg-secondary");
    expect(section.className).not.toMatch(/(?<![\w:-])bg-muted(?![\w-])/);
  });
});
