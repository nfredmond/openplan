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
