import { describe, expect, it } from "vitest";
import { synthesisContinuationCommandSchema, synthesisContinuationPageSchema } from "@/lib/engagement/synthesis-continuation-records";

const id = (n: number) => `c7720000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const parent = { parentRequestId: id(1), parentActorId: id(2), parentIntentSha256: "a".repeat(64), sourceId: id(3),
  sourceSha256: "b".repeat(64), throughSequence: 4, segmentResultsManifestSha256: "c".repeat(64) };
const intent = { schemaVersion: 1, sourceId: parent.sourceId, sourceSha256: parent.sourceSha256, connectionId: id(4),
  configurationRevisionId: id(5), configurationHash: "d".repeat(64), modelId: "synthetic-日本語", taskByteLimit: 65536 };
const command = { stage: "context", requestId: id(6), parent, frameByteLimit: 4096, intentText: JSON.stringify(intent, null, 2), targetRecordId: `item:${id(7)}` };
const page = { schemaVersion: 1, campaignId: id(8), workspaceId: id(9), parent, cancelled: false, interpretation: "not_assessed",
  offset: 0, pageSize: 25, total: 1, nextOffset: null,
  entries: [{ recordId: command.targetRecordId, kind: "item", label: "Synthetic contribution", excerpt: "日本語", excerptTruncated: false }] };

describe("portable continuation contracts", () => {
  it("preserves exact provider intent whitespace and explicit stage/target", () => {
    expect(synthesisContinuationCommandSchema.parse(command)).toEqual(command);
    const { targetRecordId: _target, ...thematic } = command;
    expect(synthesisContinuationCommandSchema.parse({ ...thematic, stage: "thematic" })).toEqual({ ...thematic, stage: "thematic" });
  });
  it.each([{ ...command, intentText: "{" }, { ...command, requestId: parent.parentRequestId }, { ...command, stage: "thematic" },
    { ...command, intentText: JSON.stringify({ ...intent, sourceId: id(99) }) },
    { ...command, intentText: JSON.stringify({ ...intent, sourceSha256: "e".repeat(64) }) },
    { ...command, intentText: JSON.stringify({ ...intent, execute: true }) },
    { ...command, intentText: JSON.stringify({ ...intent, modelId: "界".repeat(160) }).padEnd(3900, " ") },
    { ...command, execute: true }, { ...command, parent: { ...parent, throughSequence: 0.5 } }, { ...command, frameByteLimit: 1_048_577 }])(
    "refuses a changed identity, stage, resource limit or authority-bearing command %j", value => {
      expect(() => synthesisContinuationCommandSchema.parse(value)).toThrow();
    });
  it("keeps the preview separate from meaning or complete contribution content", () => {
    expect(synthesisContinuationPageSchema.parse(page)).toEqual(page);
    expect(synthesisContinuationPageSchema.parse({ ...page, offset: 1, entries: [] })).toMatchObject({ offset: 1, nextOffset: null });
  });
  it.each([{ ...page, total: 0 }, { ...page, total: 2 }, { ...page, nextOffset: 1 }, { ...page, offset: 2 },
    { ...page, entries: [...page.entries, ...page.entries], total: 2 }, { ...page, interpretation: "approved" },
    { ...page, entries: [{ ...page.entries[0], kind: "answer" }] }, { ...page, entries: [{ ...page.entries[0], excerpt: "a".repeat(281) }] }])(
    "refuses incomplete page accounting, duplicate identity or promoted claims %j", value => {
      expect(() => synthesisContinuationPageSchema.parse(value)).toThrow();
    });
});
