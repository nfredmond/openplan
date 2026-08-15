import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CorridorUpload } from "@/components/corridor/CorridorUpload";

/**
 * A CONTROL MUST NAME THE THING IT CHANGES.
 *
 * WHERE THIS CAME FROM. This card was headed "Corridor geometry" while the
 * sentence directly beneath it said the upload "becomes the study area,
 * replacing whatever is currently set". A tester on 2026-08-15 read the
 * heading, uploaded a corridor file expecting to attach a corridor, and
 * silently replaced the study area they had just drawn. The heading and its own
 * description had been contradicting each other, and the heading won, because a
 * heading is what a person reads before deciding what a control is for.
 *
 * IT WAS MADE WORSE BY BEING MOVED. The card was written for one caller and
 * mounted into a second — the project's Study area control — the same morning,
 * which put a box headed "Corridor geometry" inside a section about the study
 * area. A component that names its own context stops being honest the moment it
 * has two.
 *
 * WHAT IS ASSERTED: the heading names the study area, does not claim to be about
 * corridors, and the destructive part — that this REPLACES what is set — is on
 * screen rather than left to be discovered.
 */
describe("the boundary upload names what it changes", () => {
  function renderCard() {
    render(<CorridorUpload onUpload={vi.fn()} />);
    // The card's own section, so a heading elsewhere on a host page cannot
    // satisfy or break this.
    return screen.getByRole("heading", { name: /upload a boundary file/i }).closest("section")!;
  }

  it("names the area being set, not a corridor", () => {
    const card = renderCard();
    // "study area" is an administrator's word Nathaniel named directly; the
    // ledger prescribes "the area you are planning for".
    expect(card.textContent).toMatch(/area you are planning for/i);
    // The word that sent a planner to the wrong control. It may appear only in
    // the sentence saying this does NOT add one.
    const headingArea = card.querySelector(".analysis-studio-heading");
    expect(headingArea).not.toBeNull();
    const label = headingArea!.querySelector(".analysis-studio-label");
    expect(label?.textContent ?? "").not.toMatch(/corridor/i);
  });

  it("says on screen that it replaces what is already set", () => {
    const card = renderCard();
    // The upload is destructive. Saying so afterwards is not saying so.
    expect(card.textContent).toMatch(/replacing whatever is already set/i);
  });

  it("says plainly that it does not add a corridor", () => {
    const card = renderCard();
    expect(card.textContent).toMatch(/does not add a corridor/i);
  });
});
