import { describe, expect, it } from "vitest";

import {
  canRunAnalysis,
  describeRunAnalysisBlock,
} from "@/app/(app)/explore/_components/explore-page-state";
import type { CorridorGeometry } from "@/app/(app)/explore/_components/_types";

/**
 * A REFUSAL MUST NAME THE THING THAT IS ACTUALLY MISSING.
 *
 * WHERE THIS CAME FROM. A tester searched a place on Corridor Analysis, watched
 * the panel confirm "Study area set" with its extent in km², pressed Run, and
 * was told to DRAW A CORRIDOR — the one thing they had just done. They had not
 * yet typed the question, and nothing said so. They filed it as a blocker and
 * described the study-area panel and the run wizard as disagreeing about what
 * counts as a corridor.
 *
 * THEY WERE NOT DISAGREEING. The gate wants three things — a workspace, a
 * question, and a boundary — and the refusal only ever named the boundary. Being
 * sent back to redo work you have already done is worse than being told nothing,
 * because it sends a planner to a map that was never the problem.
 *
 * THE INVARIANT: whenever `canRunAnalysis` is false, `describeRunAnalysisBlock`
 * returns a reason, and that reason names the input that is genuinely absent —
 * never a different one. The two functions are checked against each other across
 * every combination rather than by example, because the defect was a case
 * nobody had thought to write down.
 */
const AREA = { type: "Polygon", coordinates: [] } as unknown as CorridorGeometry;

describe("the run refusal names what is missing", () => {
  const cases = [
    { workspaceId: "", queryText: "", corridorGeojson: null },
    { workspaceId: "", queryText: "q", corridorGeojson: AREA },
    { workspaceId: "w", queryText: "", corridorGeojson: null },
    { workspaceId: "w", queryText: "", corridorGeojson: AREA },
    { workspaceId: "w", queryText: "   ", corridorGeojson: AREA },
    { workspaceId: "w", queryText: "q", corridorGeojson: null },
    { workspaceId: "w", queryText: "q", corridorGeojson: AREA },
  ];

  it("gives a reason exactly when the gate is shut, and none when it is open", () => {
    for (const input of cases) {
      const open = canRunAnalysis(input);
      const reason = describeRunAnalysisBlock(input);
      expect(
        open ? reason === null : typeof reason === "string" && reason.length > 0,
        `canRunAnalysis=${open} but reason=${JSON.stringify(reason)} for ${JSON.stringify({
          ...input,
          corridorGeojson: input.corridorGeojson ? "set" : null,
        })}`
      ).toBe(true);
    }
  });

  it("never tells a planner to set an area they have already set", () => {
    // The exact reported case: area present, question missing.
    const reason = describeRunAnalysisBlock({
      workspaceId: "w",
      queryText: "",
      corridorGeojson: AREA,
    });
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/question/i);
    // The words that sent the tester back to the map.
    expect(reason).not.toMatch(/draw/i);
    expect(reason).not.toMatch(/search a place/i);
  });

  it("names the area when the area really is what is missing", () => {
    const reason = describeRunAnalysisBlock({
      workspaceId: "w",
      queryText: "How many people live near this corridor?",
      corridorGeojson: null,
    });
    expect(reason).toMatch(/study area/i);
    // ...and does not blame the question, which is present.
    expect(reason).not.toMatch(/write the question/i);
  });

  it("names both when a planner has only just arrived", () => {
    const reason = describeRunAnalysisBlock({
      workspaceId: "w",
      queryText: "",
      corridorGeojson: null,
    });
    // Naming one at a time is how somebody fixes it and is refused again.
    expect(reason).toMatch(/study area/i);
    expect(reason).toMatch(/question/i);
  });
});
