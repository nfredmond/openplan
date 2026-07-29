import { describe, expect, it } from "vitest";

import {
  buildModerationQueueView,
  parseStoredItemModeration,
} from "@/lib/engagement/ai-moderation-shared";

/**
 * The READ side of AI moderation. `engagement_items.metadata_json` is free-form
 * jsonb, so nothing in the database enforces the assessment shape on the way
 * back out — and the campaign page used to cast whatever it found straight into
 * the typed union: `severity: (mod.severity ?? "none") as ModerationSeverity`.
 *
 * That is the failure mode this file pins. A severity string this build does not
 * know, coerced to "none", renders in the neutral tone and reads as reassurance
 * about a comment nobody has actually cleared. So an assessment that cannot be
 * interpreted is refused and COUNTED, never defaulted and never silently
 * dropped: the panel says how many it could not read.
 */

function queued(id: string, assessment: unknown) {
  return { id, body: `  comment ${id}  `, status: "pending", metadata_json: { ai_moderation: assessment } };
}

const VALID = {
  flags: ["pii"],
  severity: "high",
  rationale: "Contains a phone number.",
  suggested_action: "review",
  source: "ai",
  at: "2026-07-20T10:00:00.000Z",
};

describe("reading a stored moderation assessment", () => {
  it("refuses an unrecognized severity rather than calling it none", () => {
    expect(parseStoredItemModeration("i1", { ai_moderation: { ...VALID, severity: "critical" } })).toBeNull();
  });

  it("refuses an unrecognized suggested action rather than calling it review", () => {
    expect(parseStoredItemModeration("i1", { ai_moderation: { ...VALID, suggested_action: "reject" } })).toBeNull();
  });

  it("keeps the flags it knows and discards the ones it does not", () => {
    const parsed = parseStoredItemModeration("i1", {
      ai_moderation: { ...VALID, flags: ["pii", "witchcraft", "spam"] },
    });

    expect(parsed?.flags).toEqual(["pii", "spam"]);
  });

  it("is not a flag when no category survives", () => {
    expect(parseStoredItemModeration("i1", { ai_moderation: { ...VALID, flags: ["witchcraft"] } })).toBeNull();
  });

  it("reads a well-formed assessment through unchanged", () => {
    expect(parseStoredItemModeration("i1", { ai_moderation: VALID })).toEqual({
      item_id: "i1",
      flags: ["pii"],
      severity: "high",
      rationale: "Contains a phone number.",
      suggested_action: "review",
    });
  });
});

describe("the moderation queue a campaign page hands to the panel", () => {
  it("counts what a human must still decide, whether or not a scan ever ran", () => {
    const view = buildModerationQueueView([
      { id: "i1", body: "a", status: "pending" },
      { id: "i2", body: "b", status: "flagged" },
      { id: "i3", body: "c", status: "approved", metadata_json: { ai_moderation: VALID } },
      { id: "i4", body: "d", status: "rejected" },
    ]);

    expect(view.queueItemCount).toBe(2);
    expect(view.flagged).toEqual([]);
    // The approved item's assessment is out of scope, not unreadable.
    expect(view.unreadableAssessmentCount).toBe(0);
    expect(view.lastSource).toBeNull();
  });

  it("discloses an assessment it could not read instead of implying nothing was flagged", () => {
    const view = buildModerationQueueView([queued("i1", { ...VALID, severity: "critical" })]);

    expect(view.flagged).toEqual([]);
    expect(view.unreadableAssessmentCount).toBe(1);
  });

  it("treats a scan that found nothing as a clean result, not an unreadable one", () => {
    const view = buildModerationQueueView([
      queued("i1", { flags: [], severity: "none", rationale: "", suggested_action: "approve", source: "ai" }),
    ]);

    expect(view.flagged).toEqual([]);
    expect(view.unreadableAssessmentCount).toBe(0);
    expect(view.lastSource).toBe("ai");
  });

  it("quotes the flagged comment as a collapsed snippet", () => {
    const view = buildModerationQueueView([
      { id: "i1", body: "  line one\n\n  line two  ", status: "flagged", metadata_json: { ai_moderation: VALID } },
    ]);

    expect(view.flagged[0].snippet).toBe("line one line two");
    expect(view.flagged[0].moderation.severity).toBe("high");
  });

  it("names the source of the most recent scan, not of whichever row sorted first", () => {
    // The page loads items newest-updated first, which is not the same order as
    // newest-assessed. Reading the source off the first row let a stale AI pass
    // hide a fallback that ran after it — the panel would claim Claude judged
    // the queue when the offline heuristics did.
    const view = buildModerationQueueView([
      queued("i1", { ...VALID, source: "ai", at: "2026-07-20T10:00:00.000Z" }),
      queued("i2", { ...VALID, source: "deterministic-fallback", at: "2026-07-22T10:00:00.000Z" }),
    ]);

    expect(view.lastSource).toBe("deterministic-fallback");
  });

  it("ignores a source value it does not recognize", () => {
    const view = buildModerationQueueView([queued("i1", { ...VALID, source: "some-other-engine" })]);

    expect(view.lastSource).toBeNull();
  });
});
