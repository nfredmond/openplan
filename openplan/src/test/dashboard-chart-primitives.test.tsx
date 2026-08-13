import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartBlockedNote, ChartMeterRows } from "@/components/ui/chart-primitives";
import { series, type InsightPoint } from "@/lib/dashboard/insights";

/**
 * THE OVER-AWARD WARNING, WHICH WAS GUARDED BY NOTHING.
 *
 * `ChartMeterRows` draws money DRAWN inside money AUTHORISED. When the draw
 * exceeds the award, three things change: the fill turns the warning colour, an
 * alert icon appears, and the row is labelled "Over the award —". All three hang
 * on one expression, `percent > 100`. Mutating it to `percent > 1000` removed
 * every one of them and all 84 dashboard tests stayed green — a money figure
 * losing its warning silently, on a meter a grants administrator reads to decide
 * whether their agency has over-claimed against a funder.
 *
 * WHAT THIS FILE CANNOT PROVE, and it is most of what the reader experiences.
 * jsdom applies no stylesheet, has no box model and does not resolve CSS custom
 * properties, so nothing here establishes that `--warn` is a visible colour
 * against the track, that the icon is the right size, or that the row reads as
 * alarming. Those were measured in a real browser. What jsdom CAN prove is that
 * the marking is PRESENT and attached to the right row — which is exactly what
 * the mutation removed.
 */

const point = (label: string, drawn: number, authorised: number): InsightPoint => ({
  label,
  value: drawn,
  reference: authorised,
  formattedValue: `$${drawn}`,
  detail: `$${drawn} drawn against $${authorised} authorised`,
});

function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest("li");
  if (!row) throw new Error(`no meter row rendered for ${label}`);
  return row;
}

describe("money drawn beyond the award", () => {
  it("marks the over-drawn row and only the over-drawn row", () => {
    render(
      <ChartMeterRows
        series={series([
          point("STBG", 40_000, 100_000),
          point("CMAQ", 120_000, 100_000),
          // Exactly at the award is NOT over it. A boundary that warns on 100%
          // would cry wolf on every fully-drawn grant, which is how a real
          // warning gets ignored.
          point("ATP", 100_000, 100_000),
        ])}
      />
    );

    expect(rowFor("CMAQ")).toHaveAttribute("data-over-award", "true");
    expect(rowFor("STBG")).toHaveAttribute("data-over-award", "false");
    expect(rowFor("ATP")).toHaveAttribute("data-over-award", "false");
  });

  it("says 'Over the award' in words, on that row", () => {
    render(<ChartMeterRows series={series([point("STBG", 40_000, 100_000), point("CMAQ", 120_000, 100_000)])} />);

    expect(rowFor("CMAQ")).toHaveTextContent("Over the award");
    expect(rowFor("STBG")).not.toHaveTextContent("Over the award");
  });

  it("carries the alert icon on the over-drawn row and not on a normal one", () => {
    render(<ChartMeterRows series={series([point("STBG", 40_000, 100_000), point("CMAQ", 120_000, 100_000)])} />);

    // The lucide icon is the only decorative SVG inside a meter row.
    expect(rowFor("CMAQ").querySelectorAll("svg").length).toBe(1);
    expect(rowFor("STBG").querySelectorAll("svg").length).toBe(0);
  });

  it("prints the real percentage rather than capping the number at 100%", () => {
    render(<ChartMeterRows series={series([point("CMAQ", 120_000, 100_000)])} />);
    expect(rowFor("CMAQ")).toHaveTextContent("120%");
  });

  /**
   * The FILL is clamped and the NUMBER is not, deliberately: a bar cannot leave
   * its track, so the length stops at 100% while the words say 120%. This
   * asserts the clamp stays, because a fill wider than its container is how a
   * reader concludes the figure is broken rather than the award.
   */
  it("keeps the fill inside the track while the words exceed it", () => {
    render(<ChartMeterRows series={series([point("CMAQ", 120_000, 100_000)])} />);
    const fill = rowFor("CMAQ").querySelector<HTMLElement>("div[style*='width']");
    expect(fill?.style.width).toBe("100%");
  });

  /** An award with nothing drawn against it draws NOTHING, not a courtesy sliver. */
  it("draws a zero draw as zero width", () => {
    render(<ChartMeterRows series={series([point("STBG", 0, 100_000)])} />);
    const fill = rowFor("STBG").querySelector<HTMLElement>("div[style*='width']");
    expect(fill?.style.width).toBe("0%");
  });
});

/**
 * The blocked note is the one place a failed read and an empty workspace are
 * told apart on screen. `impossible` was added 2026-08-13 for a lane count that
 * cannot exist, and it must not collapse into the default "Nothing here yet".
 */
describe("the sentence shown instead of a figure", () => {
  it("gives an impossible value its own lead, not the empty one", () => {
    const { unmount } = render(
      <ChartBlockedNote reason="Grants (-3) reported a count that cannot exist." kind="impossible" />
    );
    const note = screen.getByTestId("chart-blocked");
    expect(note).toHaveAttribute("data-blocked-kind", "impossible");
    expect(note).toHaveTextContent("Something is counted wrong");
    expect(note).not.toHaveTextContent("Nothing here yet");
    unmount();

    render(<ChartBlockedNote reason="Nothing has run yet." kind="empty" />);
    expect(screen.getByTestId("chart-blocked")).toHaveTextContent("Nothing here yet");
  });
});
