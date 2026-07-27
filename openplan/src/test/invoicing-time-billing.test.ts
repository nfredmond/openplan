import { describe, expect, it } from "vitest";
import {
  groupUnbilledTime,
  isUnbilledTimeEntry,
  resolveHourlyRate,
  summarizeUnbilledTime,
  TIME_BILLING_UNIT_LABEL,
} from "@/lib/invoicing/time-billing";

const ENGAGEMENT_RATES = [
  { labor_category: "Senior Planner", hourly_rate: 195 },
  { labor_category: "GIS Analyst", hourly_rate: 140 },
];

const DEFAULT_RATES = [
  { labor_category: "Senior Planner", hourly_rate: 180 },
  { labor_category: "Associate Planner", hourly_rate: 120 },
];

describe("resolveHourlyRate", () => {
  it("prefers the engagement table over the workspace default", () => {
    expect(
      resolveHourlyRate({
        laborCategory: "Senior Planner",
        engagementRateEntries: ENGAGEMENT_RATES,
        defaultRateEntries: DEFAULT_RATES,
      })
    ).toEqual({ rate: 195, source: "engagement_table" });
  });

  it("falls back to the default table when the engagement table has no match", () => {
    expect(
      resolveHourlyRate({
        laborCategory: "Associate Planner",
        engagementRateEntries: ENGAGEMENT_RATES,
        defaultRateEntries: DEFAULT_RATES,
      })
    ).toEqual({ rate: 120, source: "default_table" });
  });

  it("answers an explicit none when nothing matches — a rate is never invented", () => {
    expect(
      resolveHourlyRate({
        laborCategory: "Drone Pilot",
        engagementRateEntries: ENGAGEMENT_RATES,
        defaultRateEntries: DEFAULT_RATES,
      })
    ).toEqual({ rate: null, source: "none" });
    expect(resolveHourlyRate({ laborCategory: null })).toEqual({ rate: null, source: "none" });
    expect(resolveHourlyRate({ laborCategory: "   " })).toEqual({ rate: null, source: "none" });
  });

  it("matches categories case-insensitively and tolerates string rates", () => {
    expect(
      resolveHourlyRate({
        laborCategory: "senior planner",
        defaultRateEntries: [{ labor_category: "Senior Planner", hourly_rate: "180.00" }],
      })
    ).toEqual({ rate: 180, source: "default_table" });
  });
});

describe("isUnbilledTimeEntry", () => {
  it("counts billable, unstamped entries only", () => {
    expect(isUnbilledTimeEntry({ billable: true, billed_line_item_id: null })).toBe(true);
    expect(isUnbilledTimeEntry({})).toBe(true); // billable defaults true in the schema
    expect(isUnbilledTimeEntry({ billable: false })).toBe(false);
    expect(isUnbilledTimeEntry({ billed_line_item_id: "li-1" })).toBe(false);
  });
});

describe("groupUnbilledTime", () => {
  const entries = [
    { id: "t1", staff_id: "s1", labor_category: "Senior Planner", hours: 8, entry_date: "2026-07-01" },
    { id: "t2", staff_id: "s1", labor_category: "Senior Planner", hours: 4.5, entry_date: "2026-07-02" },
    { id: "t3", staff_id: "s2", labor_category: "Associate Planner", hours: 6, entry_date: "2026-07-03" },
    { id: "t4", staff_id: "s2", labor_category: "Drone Pilot", hours: 3, entry_date: "2026-07-04" },
    { id: "t5", staff_id: "s1", labor_category: "Senior Planner", hours: 2, billed_line_item_id: "li-9" },
    { id: "t6", staff_id: "s1", labor_category: "Senior Planner", hours: 1, billable: false },
  ];

  it("groups by staff and category with looked-up rates and hour quantities", () => {
    const drafts = groupUnbilledTime(entries, {
      by: "staff_category",
      engagementRateEntries: ENGAGEMENT_RATES,
      defaultRateEntries: DEFAULT_RATES,
      staffNamesById: { s1: "J. Doe", s2: "R. Roe" },
    });

    expect(drafts).toHaveLength(3);

    const senior = drafts.find((d) => d.description === "Senior Planner — J. Doe");
    expect(senior).toMatchObject({
      quantity: 12.5,
      unit_label: TIME_BILLING_UNIT_LABEL,
      unit_amount: 195,
      amount: 2437.5,
      needsRate: false,
      sourceTimeEntryIds: ["t1", "t2"],
    });

    const associate = drafts.find((d) => d.description === "Associate Planner — R. Roe");
    expect(associate).toMatchObject({ quantity: 6, unit_amount: 120, amount: 720, needsRate: false });
  });

  it("splits rateless time into an explicit needsRate draft with a null amount", () => {
    const drafts = groupUnbilledTime(entries, {
      by: "staff_category",
      engagementRateEntries: ENGAGEMENT_RATES,
      defaultRateEntries: DEFAULT_RATES,
      staffNamesById: { s2: "R. Roe" },
    });

    const rateless = drafts.find((d) => d.description === "Drone Pilot — R. Roe");
    expect(rateless).toMatchObject({
      quantity: 3,
      unit_amount: null,
      amount: null,
      needsRate: true,
      sourceTimeEntryIds: ["t4"],
    });
  });

  it("excludes billed and non-billable entries from every draft", () => {
    const drafts = groupUnbilledTime(entries, {
      by: "staff_category",
      engagementRateEntries: ENGAGEMENT_RATES,
      defaultRateEntries: DEFAULT_RATES,
    });

    const allIds = drafts.flatMap((d) => d.sourceTimeEntryIds);
    expect(allIds).not.toContain("t5");
    expect(allIds).not.toContain("t6");
  });

  it("groups by deliverable, pricing each entry by its own category", () => {
    const drafts = groupUnbilledTime(
      [
        { id: "t1", deliverable_id: "d1", labor_category: "Senior Planner", hours: 2 },
        { id: "t2", deliverable_id: "d1", labor_category: "Associate Planner", hours: 3 },
        { id: "t3", deliverable_id: null, labor_category: "Senior Planner", hours: 1 },
      ],
      {
        by: "deliverable",
        engagementRateEntries: ENGAGEMENT_RATES,
        defaultRateEntries: DEFAULT_RATES,
        deliverableTitlesById: { d1: "Existing Conditions Report" },
      }
    );

    const report = drafts.find((d) => d.description === "Existing Conditions Report");
    // 2h @ 195 + 3h @ 120 = 750; mixed rates → no single unit_amount.
    expect(report).toMatchObject({ quantity: 5, unit_amount: null, amount: 750, needsRate: false });

    const general = drafts.find((d) => d.description === "General (no deliverable)");
    expect(general).toMatchObject({ quantity: 1, unit_amount: 195, amount: 195, needsRate: false });
  });

  it("keeps rateless deliverable time out of the priced deliverable draft", () => {
    const drafts = groupUnbilledTime(
      [
        { id: "t1", deliverable_id: "d1", labor_category: "Senior Planner", hours: 2 },
        { id: "t2", deliverable_id: "d1", labor_category: "Drone Pilot", hours: 3 },
      ],
      {
        by: "deliverable",
        engagementRateEntries: ENGAGEMENT_RATES,
        defaultRateEntries: DEFAULT_RATES,
        deliverableTitlesById: { d1: "Existing Conditions Report" },
      }
    );

    expect(drafts).toHaveLength(2);
    const priced = drafts.find((d) => !d.needsRate);
    const rateless = drafts.find((d) => d.needsRate);
    expect(priced).toMatchObject({ quantity: 2, amount: 390, sourceTimeEntryIds: ["t1"] });
    expect(rateless).toMatchObject({ quantity: 3, amount: null, unit_amount: null, sourceTimeEntryIds: ["t2"] });
  });
});

describe("summarizeUnbilledTime", () => {
  it("sums hours, counts entries and distinct staff, and finds the oldest date", () => {
    const summary = summarizeUnbilledTime([
      { id: "t1", staff_id: "s1", hours: 8, entry_date: "2026-07-03" },
      { id: "t2", staff_id: "s1", hours: "4.25", entry_date: "2026-06-15" },
      { id: "t3", staff_id: "s2", hours: 6, entry_date: "2026-07-10" },
      { id: "t4", staff_id: "s3", hours: 2, entry_date: "2026-05-01", billed_line_item_id: "li-1" },
      { id: "t5", staff_id: "s3", hours: 2, entry_date: "2026-05-02", billable: false },
    ]);

    expect(summary).toEqual({
      hours: 18.25,
      entryCount: 3,
      staffCount: 2,
      oldestEntryDate: "2026-06-15",
    });
  });

  it("is empty-safe", () => {
    expect(summarizeUnbilledTime([])).toEqual({
      hours: 0,
      entryCount: 0,
      staffCount: 0,
      oldestEntryDate: null,
    });
    expect(summarizeUnbilledTime(null).entryCount).toBe(0);
  });
});
