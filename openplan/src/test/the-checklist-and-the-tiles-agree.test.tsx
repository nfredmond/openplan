/**
 * ONE PAGE MAY NOT MAKE TWO CLAIMS ABOUT ONE FAILED READ.
 *
 * When the dashboard's runs query fails, the four KPI tiles say "Could not
 * load — this is a failed query, not an empty workspace". Directly above them
 * the first-run checklist used to say "No analysis runs yet.", because
 * `hasRuns` is derived from the returned rows and a failed read returns an
 * empty array. A planner reading the two together learns the wrong thing from
 * whichever they believe.
 *
 * WHAT THIS DOES NOT PROVE: jsdom applies no stylesheet and has no box model,
 * so nothing here shows the two sit on the same screen, or that either is
 * visible. It asserts the words, which is the part that contradicted.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";

const BASE = {
  aiKeyConfigured: true,
  homeGeographyIsSet: true,
  homeGeographyLabel: "Somewhere",
  canManageWorkspace: true,
  intent: null,
  engagementCampaignCount: 0,
} as const;

describe("the checklist tells a failed read apart from an empty workspace", () => {
  it("does not claim there are no runs when the read failed", () => {
    render(<FirstRunChecklist {...BASE} hasRuns={false} runsUnreadable />);

    expect(screen.queryByText(/No analysis runs yet/i)).toBeNull();
    expect(screen.getByText(/that read failed/i)).toBeTruthy();
    expect(screen.getByText(/not the same as having none/i)).toBeTruthy();
  });

  it("still says plainly when the workspace genuinely has none", () => {
    render(<FirstRunChecklist {...BASE} hasRuns={false} />);

    expect(screen.getByText(/No analysis runs yet/i)).toBeTruthy();
    expect(screen.queryByText(/that read failed/i)).toBeNull();
  });

  it("says so when there are runs", () => {
    render(<FirstRunChecklist {...BASE} hasRuns />);

    expect(screen.getByText(/has saved analysis runs/i)).toBeTruthy();
  });
});
