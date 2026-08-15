import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExploreEmptyResultBoard } from "@/app/(app)/explore/_components/explore-empty-result-board";
import {
  CORRIDOR_ANALYSIS_DOES_NOT_ANSWER,
  CORRIDOR_ANALYSIS_TRAFFIC_HREF,
  TRAVEL_MODEL_WHAT_IT_TAKES,
} from "@/lib/analysis/what-this-answers";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

/**
 * A TOOL MUST SAY WHAT IT DOES NOT ANSWER, BEFORE THE WORK.
 *
 * WHERE THIS CAME FROM. A tester was sent to find out "how much traffic, how
 * much driving" on a corridor, reached for Corridor Analysis — the tool the app
 * itself points at — spent three steps setting it up, waited through the run,
 * and got demographics, mode share, collisions and three scores. No traffic
 * figure anywhere. In their words the tool "is very close to answering 'how much
 * traffic would this handle'", which is exactly what made it expensive: it looks
 * like the right tool right up until the result arrives.
 *
 * THE FIX IS NOT A NUMBER. Corridor Analysis has no road network and no demand
 * model, so a traffic figure from it would be invented — the flattering answer
 * this repository exists to refuse. It says so instead, before the setup and
 * again beside the result, and names what does answer the question.
 *
 * WHAT IS ASSERTED: the sentence is on screen BEFORE a run, it names the thing
 * the tool cannot do rather than hinting, and it points somewhere. The result
 * card carries the same sentence from the same constant, which is what stops
 * the two drifting into different promises.
 */
describe("the tool says what it does not answer", () => {
  it("says it before a planner spends the setup", () => {
    render(<ExploreEmptyResultBoard />);
    const board = screen.getByText(/no analysis selected/i).closest("section")!;
    expect(board.textContent).toContain(CORRIDOR_ANALYSIS_DOES_NOT_ANSWER);
  });

  it("names traffic and miles driven, rather than hinting at a limit", () => {
    // A vague "results are indicative" would satisfy a looser assertion and
    // would not have saved this tester.
    expect(CORRIDOR_ANALYSIS_DOES_NOT_ANSWER).toMatch(/traffic volumes/i);
    expect(CORRIDOR_ANALYSIS_DOES_NOT_ANSWER).toMatch(/miles driven/i);
  });

  it("points at where the number does come from", () => {
    render(<ExploreEmptyResultBoard />);
    const link = screen.getByRole("link", { name: /run a travel model/i });
    expect(link.getAttribute("href")).toBe(CORRIDOR_ANALYSIS_TRAFFIC_HREF);
  });

  it("promises nothing about the accuracy of the thing it points at", () => {
    // The model lane's estimate is screening-grade and known to run low. This
    // sentence is a direction, not an endorsement — the run carries its own
    // grade beside its own figures, and duplicating that claim here would put a
    // second, unqualified version of it in the product.
    expect(CORRIDOR_ANALYSIS_DOES_NOT_ANSWER).not.toMatch(/accurate|precise|reliable|exact/i);
  });

  /**
   * THE OTHER END OF THAT LINK.
   *
   * Sending somebody to the travel-model route without saying what it involves
   * moves the disappointment rather than removing it. The tester who followed
   * this trail found a multi-step engineering workflow and could not finish it
   * in a week — which is honest, because estimating traffic properly is expert
   * work, and shortening it by hiding steps would produce a number nobody could
   * defend. What they should have known is the SHAPE of the job, on arrival.
   */
  it("says what the route it points at actually involves", () => {
    expect(TRAVEL_MODEL_WHAT_IT_TAKES).toMatch(/road network/i);
    expect(TRAVEL_MODEL_WHAT_IT_TAKES).toMatch(/longer route|expert work/i);
    // Before you start, not partway through — the tester's actual complaint.
    expect(TRAVEL_MODEL_WHAT_IT_TAKES).toMatch(/before you start/i);
  });

  it("still promises nothing about how good that estimate is", () => {
    // The run carries its own grade beside its own figures. A second,
    // unqualified quality claim here would be the one that gets quoted.
    expect(TRAVEL_MODEL_WHAT_IT_TAKES).not.toMatch(/accurate|precise|reliable|exact|definitive/i);
  });
});
