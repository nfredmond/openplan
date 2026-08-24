/**
 * Workspace jurisdiction and legal-process selection remain human decisions.
 * Both routes exist for owners and admins, but neither may acquire an assistant
 * action without first removing this refusal and recording why that changed.
 */
import { describe, expect, it } from "vitest";

import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

const REFUSED = [
  {
    label: "setting the workspace home geography",
    words: ["home", "geography"],
    provoker: "set_workspace_home_geography",
    reason:
      "The place of record re-frames maps, data coverage, and legal configuration for every planner in the workspace.",
  },
  {
    label: "selecting the workspace stage-gate template",
    words: ["stage", "gate", "template"],
    provoker: "rebind_workspace_stage_gate_template",
    reason:
      "Choosing the agency's delivery process changes the checklist and evidence requirements shown on every project board.",
  },
] as const;

const registered = Object.keys(ACTION_METADATA);
const matches = (kind: string, words: readonly string[]) =>
  words.every((word) => kind.includes(word));

describe("workspace jurisdiction actions remain human-only", () => {
  for (const refusal of REFUSED) {
    it(`does not register ${refusal.label}`, () => {
      expect(
        registered.filter((kind) => matches(kind, refusal.words)),
        `${refusal.reason} If that argument changes, record why before removing this refusal.`
      ).toEqual([]);
    });
  }

  it("proves each matcher recognizes a plausible action name", () => {
    for (const refusal of REFUSED) {
      expect(matches(refusal.provoker, refusal.words)).toBe(true);
    }
  });

  it("does not catch the existing human-approved stage-gate hold action", () => {
    expect(registered).toContain("record_stage_gate_hold");
    expect(
      REFUSED.filter((refusal) => matches("record_stage_gate_hold", refusal.words))
    ).toEqual([]);
  });
});
