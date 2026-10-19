import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDeadlineTimeZone, grantDeadlineDraft, grantDeadlinePatch } from "@/lib/grants/deadline-edit";

const recorded = {
  closesAt: "2026-10-19T18:23:45.123456+00:00",
  decisionDueAt: "2026-10-20T09:15:32.654321-04:00",
};

afterEach(() => vi.restoreAllMocks());

describe("deliberate recorded deadline edits", () => {
  it("reads the browser's declared zone rather than a machine or jurisdiction default", () => {
    const options = Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValueOnce({ ...options, timeZone: "Pacific/Chatham" });
    expect(browserDeadlineTimeZone()).toBe("Pacific/Chatham");
  });

  it.each(["", "Invalid/Zone"])("keeps an unavailable browser zone explicit (%s)", (timeZone) => {
    const options = Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValueOnce({ ...options, timeZone });
    expect(browserDeadlineTimeZone()).toBeNull();
  });

  it("keeps a failed browser zone read explicit", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementationOnce(() => {
      throw new Error("Synthetic zone read failure");
    });
    expect(browserDeadlineTimeZone()).toBeNull();
  });

  it("displays offsets in the specified zone and omits both untouched microsecond values", () => {
    const draft = grantDeadlineDraft(recorded, "America/Los_Angeles");
    expect(draft).toEqual({ closesAt: "2026-10-19T11:23", decisionDueAt: "2026-10-20T06:15" });
    expect(grantDeadlinePatch(recorded, draft, "America/Los_Angeles")).toEqual({});
    expect(recorded.closesAt).toBe("2026-10-19T18:23:45.123456+00:00");
  });

  it("changes only the deliberately edited field and preserves the other field's precision", () => {
    const draft = grantDeadlineDraft(recorded, "America/Los_Angeles");
    expect(grantDeadlinePatch(recorded, { ...draft, closesAt: "2026-10-19T11:24" }, "America/Los_Angeles"))
      .toEqual({ closesAt: "2026-10-19T18:24:00.000Z" });
    expect(grantDeadlinePatch(recorded, { ...draft, decisionDueAt: "" }, "America/Los_Angeles"))
      .toEqual({ decisionDueAt: null });
  });

  it("adds a missing date, clears an existing date, and leaves a missing untouched date absent", () => {
    const prior = { closesAt: null, decisionDueAt: recorded.decisionDueAt };
    const draft = grantDeadlineDraft(prior, "UTC");
    expect(grantDeadlinePatch(prior, { ...draft, closesAt: "2026-10-21T10:05" }, "UTC"))
      .toEqual({ closesAt: "2026-10-21T10:05:00.000Z" });
    expect(grantDeadlinePatch(prior, { ...draft, decisionDueAt: "" }, "UTC")).toEqual({ decisionDueAt: null });
    expect(grantDeadlinePatch(recorded, { ...grantDeadlineDraft(recorded, "UTC"), closesAt: "" }, "UTC")).toEqual({ closesAt: null });
  });

  it.each([
    ["America/Los_Angeles", "2026-01-15T08:30", "2026-01-15T16:30:00.000Z"],
    ["America/Los_Angeles", "2026-07-15T08:30", "2026-07-15T15:30:00.000Z"],
    ["Asia/Kolkata", "2026-01-15T08:30", "2026-01-15T03:00:00.000Z"],
    ["America/Los_Angeles", "2026-11-01T01:30", "2026-11-01T08:30:00.000Z"],
  ])("converts %s local time %s with the existing earlier-offset convention", (zone, local, expected) => {
    expect(grantDeadlinePatch({ closesAt: null, decisionDueAt: null }, { closesAt: local, decisionDueAt: "" }, zone))
      .toEqual({ closesAt: expected });
  });

  it.each(["2026-02-30T10:00", "2026-03-08T02:30", "2026-10-19T11:24:00", " ", "not a time"])(
    "refuses invalid, nonexistent or unsupported local input %s", (local) => {
      expect(() => grantDeadlinePatch(recorded, { ...grantDeadlineDraft(recorded, "America/Los_Angeles"), closesAt: local }, "America/Los_Angeles")).toThrow();
    }
  );

  it("refuses an unavailable zone and unreadable current values without treating them as empty", () => {
    expect(() => grantDeadlineDraft(recorded, "Invalid/Zone")).toThrow(/time zone/);
    expect(() => grantDeadlineDraft({ ...recorded, closesAt: "unknown" }, "UTC")).toThrow(/could not be read/);
    expect(() => grantDeadlineDraft({ ...recorded, decisionDueAt: "2026-10-19T12:00" }, "UTC")).toThrow(/could not be read/);
  });
});
