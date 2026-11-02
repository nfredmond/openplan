/**
 * The bracketed counts on the crash filter chips.
 *
 * They count the collisions on the map. A value its own facet has switched off
 * is never on the map, so a count beside it would always read "(0)" whatever
 * the source holds. Property-damage-only is off by default, so a small place
 * with ten property-damage crashes showed "Property damage only (0)".
 *
 * Blind category: the counts themselves come from the caller; this file does
 * not prove the caller counted the right features.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CrashFilterPanel } from "@/components/safety/crash-filter-panel";

afterEach(() => cleanup());

const COUNTS = {
  severity: { fatal: 0, severe_injury: 0, injury: 1, pdo: 0, unknown: 0 },
};

describe("crash filter counts", () => {
  it("prints no counts for a facet the source does not record", () => {
    render(
      <CrashFilterPanel
        selection={{}}
        onChange={vi.fn()}
        counts={{ ...COUNTS, collision_type: { rear_end: 0, head_on: 0 } }}
        dimensionCoverage={{ collision_type: { support: "not_supplied" } }}
        severityCompleteness="fatal_only"
        sourceConfigured
      />,
    );
    expect(screen.getByText(/does not record manner of collision/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rear end" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Rear end (0)" })).toBeNull();
  });

  it("prints no count for a value its own filter switched off", () => {
    render(
      <CrashFilterPanel
        selection={{ severity: ["fatal", "severe_injury", "injury", "unknown"] }}
        onChange={vi.fn()}
        counts={COUNTS}
        severityCompleteness="kabco_full"
        sourceConfigured
      />,
    );
    expect(screen.getByRole("button", { name: "Property damage only" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Property damage only (0)" })).toBeNull();
    // Values that are on still carry their count, including a real zero.
    expect(screen.getByRole("button", { name: "Injury (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fatal (0)" })).toBeInTheDocument();
  });

  it("counts every value when the facet has no selection", () => {
    render(
      <CrashFilterPanel selection={{}} onChange={vi.fn()} counts={COUNTS} severityCompleteness="kabco_full" sourceConfigured />,
    );
    expect(screen.getByRole("button", { name: "Property damage only (0)" })).toBeInTheDocument();
  });
});
