import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceStageGatePanel } from "@/components/workspaces/workspace-stage-gate-panel";
import { buildStageGateRebindChoices } from "@/lib/stage-gates/rebind";

/**
 * ONE SCREEN MUST NOT GIVE TWO ANSWERS ABOUT THE SAME SETTING.
 *
 * WHERE THIS CAME FROM. Two fresh testers, driving a real browser with no
 * knowledge of this codebase, independently walked into this in their first hour
 * on 2026-08-14. After confirming a stage-gate rebind, the notice said
 * "Bound to <new template>" while the section header eight lines above still
 * named the OLD one. The PATCH had already returned 200. A planner reads two
 * contradicting facts about the same setting and cannot tell which is true.
 *
 * WHAT THIS DOES NOT ASK FOR, AND WHY IT MATTERS. It does not ask the panel to
 * refresh. Every gate diff on that screen — what leaves the board, what arrives
 * — was computed by the server against the binding that existed when the page
 * rendered, so refreshing part of it would leave a picker offering a second
 * rebind reviewed against facts that no longer hold. The panel closing itself
 * and pointing at a reload is deliberate and correct. The ONLY thing asserted
 * here is that the header names the binding this session actually wrote.
 *
 * THE CHOICES COME FROM THE REAL BUILDER, not a hand-written literal. This repo
 * has a recorded case of a described fixture passing for an offer no board could
 * ever render; a fixture that spells its own template names would prove nothing
 * about what a planner is shown. Template names here are whatever the live
 * registry carries.
 *
 * jsdom applies no stylesheet and has no box model, so nothing here is evidence
 * about where on screen either string sits — only that the header text follows
 * the write.
 */
describe("the stage-gate header names the binding this session wrote", () => {
  const choices = buildStageGateRebindChoices({
    id: "w1",
    stage_gate_template_id: null,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function firstOption() {
    if (choices.kind !== "bound" && choices.kind !== "no_binding_recorded") return null;
    const options = "options" in choices ? choices.options : [];
    return options[0] ?? null;
  }

  it("renders a rebind choice at all, or this file proves nothing", () => {
    // A deployment registering fewer than one alternative cannot reach the
    // dead end, and a silently empty option list would make every assertion
    // below vacuously true.
    expect(firstOption()).not.toBeNull();
  });

  it("shows the template just bound, not the one the page rendered with", async () => {
    const option = firstOption();
    if (!option) throw new Error("no rebind option; the guard above should have caught this");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ templateId: option.templateId }), { status: 200 })
    );

    render(<WorkspaceStageGatePanel workspaceId="w1" canManage choices={choices} />);

    const before = document.body.textContent ?? "";

    fireEvent.click(screen.getByRole("radio", { name: new RegExp(option.templateName, "i") }));
    const review = screen.getByRole("button", { name: /review|rebind|change/i });
    fireEvent.click(review);
    const confirm = await screen.findByRole("button", { name: /rebind|confirm|change/i });
    fireEvent.click(confirm);

    // The notice proves the write happened; the header is the thing under test.
    await screen.findByText(new RegExp(`Bound to ${option.templateName}`, "i"));

    const heading = screen.getByRole("heading", { name: /stage-gate template/i });
    const header = heading.parentElement;
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain(option.templateName);
    expect(header?.textContent).toContain(option.templateVersion);
    expect(before).not.toBe(document.body.textContent);
  });
});
