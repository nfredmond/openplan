import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ModelLinkedRecordsBoard,
  type ModelLinkedRecordSection,
} from "@/components/models/model-linked-records";

function section(overrides: Partial<ModelLinkedRecordSection> = {}): ModelLinkedRecordSection {
  return {
    title: "Plan links",
    count: 0,
    emptyCopy: "Attach plans when the model supports a specific package.",
    records: [],
    ...overrides,
  };
}

describe("ModelLinkedRecordsBoard", () => {
  it("renders the empty-state block when every section has zero records", () => {
    const sections: ModelLinkedRecordSection[] = [
      section({ title: "Scenario links" }),
      section({ title: "Plan links" }),
      section({ title: "Report links" }),
    ];

    render(<ModelLinkedRecordsBoard sections={sections} totalLinkCount={0} />);

    expect(screen.getByText("No explicit links yet")).toBeTruthy();
    expect(screen.queryByText("Scenario links")).toBeNull();
  });

  it("renders one DataTable per section when at least one section has records", () => {
    const sections: ModelLinkedRecordSection[] = [
      section({
        title: "Scenario links",
        count: 1,
        records: [
          {
            id: "s1",
            title: "VMT pilot",
            href: "/scenarios/s1",
            statusLabel: "Scenario record",
            timestampLabel: "Apr 18",
            meta: ["What if parking is priced?"],
          },
        ],
      }),
      section({
        title: "Plan links",
        count: 0,
        records: [],
      }),
    ];

    render(<ModelLinkedRecordsBoard sections={sections} totalLinkCount={1} />);

    expect(screen.getByText("Scenario links")).toBeTruthy();
    expect(screen.getByText("Plan links")).toBeTruthy();
    expect(screen.getByText("1 linked")).toBeTruthy();
    expect(screen.getByText("0 linked")).toBeTruthy();
    expect(screen.getByText("1 explicit links")).toBeTruthy();

    const link = screen.getByRole("link", { name: "VMT pilot" });
    expect(link.getAttribute("href")).toBe("/scenarios/s1");

    expect(screen.getByText("What if parking is priced?")).toBeTruthy();
    expect(screen.getByText("Apr 18")).toBeTruthy();
    expect(screen.getByText("Attach plans when the model supports a specific package.")).toBeTruthy();
  });

  it("renders a non-linked record as plain text when href is null", () => {
    const sections: ModelLinkedRecordSection[] = [
      section({
        title: "Recorded runs",
        count: 1,
        records: [
          {
            id: "r1",
            title: "Overnight run",
            href: null,
            statusLabel: "Recorded run",
            timestampLabel: "Apr 17",
            meta: [],
          },
        ],
      }),
    ];

    render(<ModelLinkedRecordsBoard sections={sections} totalLinkCount={1} />);

    expect(screen.queryByRole("link", { name: "Overnight run" })).toBeNull();
    expect(screen.getByText("Overnight run")).toBeTruthy();
  });
});

/**
 * The defect these cover: a section renders from `records`, and an empty
 * `records` meant BOTH "nothing is linked" and "the query that would have said
 * so failed". The board answered the confident one for both — "0 linked", an
 * "Empty" badge, and copy telling the planner to go and attach something they
 * may have attached already.
 */
describe("ModelLinkedRecordsBoard when a read failed", () => {
  const UNREADABLE =
    "3 plans are linked to this model, and the records could not be read. This list is empty " +
    "because the query failed, not because nothing is attached.";

  it("does not collapse into the empty state when the only section is unreadable", () => {
    // Before: `count > 0` was the sole test, so an unreadable section counted as
    // zero and the whole board said "No explicit links yet".
    const sections: ModelLinkedRecordSection[] = [
      section({ title: "Plan links", count: 3, unavailable: UNREADABLE }),
    ];

    render(<ModelLinkedRecordsBoard sections={sections} totalLinkCount={3} />);

    expect(screen.queryByText("No explicit links yet")).toBeNull();
    expect(screen.getByText("Plan links")).toBeTruthy();
    expect(screen.getByText(UNREADABLE)).toBeTruthy();
  });

  it("marks the section unreadable rather than empty, and shows the links it knows about", () => {
    const sections: ModelLinkedRecordSection[] = [
      section({ title: "Plan links", count: 3, unavailable: UNREADABLE }),
      section({ title: "Report links", count: 0 }),
    ];

    render(<ModelLinkedRecordsBoard sections={sections} totalLinkCount={3} />);

    expect(screen.getByText("Unreadable")).toBeTruthy();
    // The count comes from `model_links`, which WAS read — so the board can
    // still say how many are attached even though it cannot list them.
    expect(screen.getByText("3 linked")).toBeTruthy();
    // The section that genuinely is empty still says so.
    expect(screen.getByText("Empty")).toBeTruthy();
  });

  it("never shows the invitation to attach records over a failed read", () => {
    const sections: ModelLinkedRecordSection[] = [
      section({
        title: "Plan links",
        count: 3,
        emptyCopy: "Attach plans when the model supports a specific package.",
        unavailable: UNREADABLE,
      }),
    ];

    render(<ModelLinkedRecordsBoard sections={sections} totalLinkCount={3} />);

    expect(screen.queryByText("Attach plans when the model supports a specific package.")).toBeNull();
  });

  it("stops reporting a total when the link set itself could not be read", () => {
    // `totalLinkCount` is `links.length` — and when the `model_links` read
    // fails, that array was never filled. Rendering "0 explicit links" would
    // state the failure as a count.
    const sections: ModelLinkedRecordSection[] = [section({ title: "Plan links", count: 0 })];

    render(<ModelLinkedRecordsBoard sections={sections} totalLinkCount={0} linkSetUnavailable />);

    expect(screen.queryByText("0 explicit links")).toBeNull();
    expect(screen.getByText("links unreadable")).toBeTruthy();
    expect(screen.getByText("This model's links could not be read")).toBeTruthy();
    expect(screen.queryByText("No explicit links yet")).toBeNull();
  });
});
