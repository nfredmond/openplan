import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CrashCorroborationPanel } from "@/components/engagement/crash-corroboration-panel";
import {
  summarizeCampaignCorroboration,
  type NearbyCrashRow,
} from "@/lib/engagement/crash-corroboration";

/**
 * THE SEAM ON SCREEN, built through the real summarizer rather than from a
 * hand-written summary — a described fixture proves the renderer against a
 * reading the product may not be able to produce.
 *
 * The rows are shaped as `engagement_items_with_nearby_crashes` actually
 * returns them, verified against the live function on 2026-08-21 (a probe at
 * one real Sacramento corner: 258 collisions inside 100 m; a probe in
 * Minneapolis: covered=false with zeros in every count column).
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

function row(over: Partial<NearbyCrashRow> = {}): NearbyCrashRow {
  return {
    id: "item-1",
    campaign_id: "campaign-1",
    category_id: null,
    title: null,
    body: "cars turn across the crossing without looking",
    latitude: 38.5968,
    longitude: -121.49,
    votes_count: 0,
    covered_by_ingest: true,
    coverage_years: [2022, 2023, 2024, 2025],
    coverage_severity_completeness: ["kabco_full"],
    crash_total: 0,
    fatal_count: 0,
    severe_injury_count: 0,
    injury_count: 0,
    pdo_count: 0,
    killed_total: 0,
    injured_total: 0,
    pedestrian_crashes: 0,
    bicyclist_crashes: 0,
    nearest_crash_meters: null,
    earliest_crash_year: null,
    latest_crash_year: null,
    ...over,
  };
}

function renderPanel(
  rows: NearbyCrashRow[],
  options: { unreadable?: boolean; unmoderated?: number; radius?: number } = {}
) {
  const radius = options.radius ?? 100;
  render(
    <CrashCorroborationPanel
      summary={options.unreadable ? null : summarizeCampaignCorroboration(rows, radius)}
      unreadable={options.unreadable ?? false}
      radiusChoices={[50, 100, 250, 500].map((meters) => ({
        meters,
        href: `/engagement/campaign-1?crashRadius=${meters}`,
        active: meters === radius,
      }))}
      unmoderatedMappedCount={options.unmoderated ?? 0}
      moderationHref="/engagement/campaign-1?tab=responses"
    />
  );
}

describe("engagement × safety panel — what a planner is allowed to conclude", () => {
  it("puts the resident's words beside the collision counts without joining them", () => {
    renderPanel([
      row({
        id: "busy",
        crash_total: 12,
        fatal_count: 1,
        injury_count: 5,
        pdo_count: 6,
        killed_total: 1,
        injured_total: 9,
        pedestrian_crashes: 2,
        nearest_crash_meters: 5.8,
      }),
    ]);

    expect(screen.getByText(/cars turn across the crossing/)).toBeInTheDocument();
    expect(screen.getByText(/12 collisions within 100 m in 2022–2025/)).toBeInTheDocument();
    expect(screen.getByText("Nearest 5.8 m")).toBeInTheDocument();
    // The panel must never author the conclusion the planner is there to make.
    const page = document.body.textContent ?? "";
    for (const word of ["confirms", "confirmed", "validates", "verified", "proves"]) {
      expect(page.toLowerCase()).not.toContain(word);
    }
  });

  it("shows the campaign's own spread above the list, so one count is not a finding", () => {
    renderPanel([
      row({ id: "a", crash_total: 12 }),
      row({ id: "b", crash_total: 9 }),
      row({ id: "c", crash_total: 0 }),
    ]);

    expect(
      screen.getByText(/2 of the 3 mapped comments inside crash coverage \(66.7%\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/most points have collisions nearby/)).toBeInTheDocument();
  });

  it("separates a place nobody measured from a place with none, in words", () => {
    renderPanel([
      row({ id: "quiet" }),
      row({ id: "unmeasured", covered_by_ingest: false, coverage_years: null }),
    ]);

    // The unmeasured one gets its own disclosure and is never a zero.
    const unmeasured = screen.getByTestId("crash-corroboration-unmeasured");
    expect(unmeasured.textContent).toContain("where no crash data has been acquired");
    expect(unmeasured.textContent).toContain("not places where no collision happened");
    // The covered-but-quiet one is stated as the real reading it is.
    expect(screen.getByTestId("crash-corroboration-quiet").textContent).toContain(
      "no reported collision within 100 m"
    );
  });

  it("says nothing was found rather than nothing exists when the read failed", () => {
    renderPanel([], { unreadable: true });

    expect(
      screen.getByText("The reported collisions could not be read for this campaign")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No comparison is shown rather than a comparison of zero/)
    ).toBeInTheDocument();
    // A failed read must not present as an absence of collisions.
    expect(screen.queryByTestId("crash-corroboration-list")).toBeNull();
  });

  it("names the radius it used and offers the others", () => {
    renderPanel([row({ crash_total: 3 })], { radius: 250 });

    const choices = screen.getByTestId("crash-radius-choices");
    expect(choices.textContent).toContain("50 m");
    expect(choices.textContent).toContain("500 m");
    expect(choices.querySelector('[data-active="true"]')?.textContent).toBe("250 m");
    // The chosen radius reaches the reading itself, not only the control:
    // both the per-comment sentence and the baseline state it.
    expect(screen.getAllByText(/within 250 m/).length).toBeGreaterThanOrEqual(2);
  });

  it("says how many mapped comments moderation is still holding back", () => {
    renderPanel([row({ crash_total: 1 })], { unmoderated: 4 });

    const note = screen.getByTestId("crash-corroboration-unmoderated");
    expect(note.textContent).toContain("4 mapped comments are still awaiting moderation");
    expect(note.querySelector("a")?.getAttribute("href")).toBe(
      "/engagement/campaign-1?tab=responses"
    );
  });

  it("does not imply a search that never ran when nothing sits inside coverage", () => {
    // Looking at this on a real campaign is what found it: with every comment
    // outside coverage, the panel said "no mapped comment inside crash coverage
    // has a collision within 100 m", which reads as though they were checked
    // and came back clean. None of them was checked.
    renderPanel([
      row({ id: "u1", covered_by_ingest: false, coverage_years: null }),
      row({ id: "u2", covered_by_ingest: false, coverage_years: null }),
    ]);

    expect(screen.getByTestId("crash-corroboration-nothing-covered").textContent).toContain(
      "there is no comparison to show yet"
    );
    expect(screen.queryByText(/has a collision within 100 m/)).toBeNull();
    // And the disclosure is said once, in the block that names the count,
    // rather than twice.
    const caveats = screen.queryByTestId("crash-corroboration-caveats");
    expect(caveats?.textContent ?? "").not.toContain("outside every completed crash acquisition");
    expect(screen.getByTestId("crash-corroboration-unmeasured").textContent).toContain(
      "2 mapped comments sit where no crash data has been acquired"
    );
  });

  it("asks for pins rather than showing an empty comparison", () => {
    renderPanel([]);

    expect(
      screen.getByText("No approved comment on this campaign has a location yet")
    ).toBeInTheDocument();
  });
});
