import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudyAreaPicker } from "@/components/models/study-area-picker";

// Rehearsal defect D3, layout half. The large-area hint is a flex row. With the
// sentence as loose text beside an icon and a <strong>, each text run became
// its own flex item, so the sentence rendered as three squeezed columns.
// Blind category: jsdom has no layout; this checks the DOM shape that causes
// the columns, not the rendered width.

vi.mock("next/dynamic", () => ({ default: () => () => null }));

afterEach(() => cleanup());

const LARGE_AREA = JSON.stringify({
  type: "Polygon",
  coordinates: [[[-121.3, 39.1], [-120.3, 39.1], [-120.3, 39.6], [-121.3, 39.6], [-121.3, 39.1]]],
});

describe("large study area hint", () => {
  it("keeps the sentence in one flex item beside the icon", () => {
    render(<StudyAreaPicker corridorText={LARGE_AREA} onCorridorChange={() => {}} />);
    const row = screen.getByText(/Large study area, best run on the/).closest("p");
    expect(row).not.toBeNull();
    const looseText = Array.from(row!.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    expect(looseText).toHaveLength(0);
    expect(row!.children).toHaveLength(2);
  });

  it("is not shown when the caller is not choosing an area for a model run", () => {
    render(<StudyAreaPicker corridorText={LARGE_AREA} onCorridorChange={() => {}} showRunEngineHint={false} />);
    expect(screen.queryByText(/Large study area/)).toBeNull();
  });
});
