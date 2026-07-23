import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicCloseLoop, type PublicCloseLoopEntry } from "@/components/engagement/public-close-loop";

const ENTRIES: PublicCloseLoopEntry[] = [
  { id: "e1", themeTitle: "Safer crossings", youSaid: "Add a crosswalk at Main & 1st.", weDid: "Programmed a signal for FY26.", categoryLabel: "Safety" },
  { id: "e2", themeTitle: "Transit gaps", youSaid: "Buses skip the west side.", weDid: "", categoryLabel: null },
];

describe("PublicCloseLoop", () => {
  it("renders published entries with both the you-said and we-did sides", () => {
    render(<PublicCloseLoop entries={ENTRIES} />);
    expect(screen.getByText("Safer crossings")).toBeTruthy();
    expect(screen.getByText("Add a crosswalk at Main & 1st.")).toBeTruthy();
    expect(screen.getByText("Programmed a signal for FY26.")).toBeTruthy();
    expect(screen.getByText("Safety")).toBeTruthy();
    // Both sides are always labelled so the public reads it as accountability.
    expect(screen.getAllByText("You said").length).toBe(2);
    expect(screen.getAllByText("We did").length).toBe(2);
  });

  it("shows an honest empty state when nothing is published", () => {
    render(<PublicCloseLoop entries={[]} />);
    expect(screen.getByText(/has not published any updates/i)).toBeTruthy();
  });
});
