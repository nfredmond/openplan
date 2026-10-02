// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSynthesisThematicInputManifest, verifySynthesisThematicInputMetadata, verifySynthesisThematicInputSeal } from "@/lib/engagement/synthesis-thematic-input-manifest";
import { thematicInputManifestFixture as fixture } from "./fixtures/engagement/synthesis-thematic-input-manifest";
import { makeSourceSnapshot, sourceHash as hash } from "./fixtures/engagement/synthesis-source";

describe("complete thematic input custody manifest", () => {
  it("keeps the complete mixed source in stable identifier order beyond 300 inputs", () => {
    const f = fixture(), plan = f.build();
    expect(plan.manifest.inputCount).toBe(302); expect(plan.entries.map(row => row.metadata.targetRecordId)).toEqual(f.targets);
    expect(plan.entries[0].metadata.targetRecordId).toMatch(/^answer:/); expect(plan.entries.at(-1)?.metadata.targetRecordId).toBe("item:b0000000-0000-4000-8000-000000000300");
    expect(plan.manifest.outputBytes).toBe(f.entries.reduce((sum, entry) => sum + entry.outputBytes, 0));
    expect(plan.manifestSha256).toBe(hash(plan.manifestText)); expect(plan.manifest.tailSha256).not.toBe(plan.manifest.seedSha256);
    f.entries.reverse(); expect(f.build().manifestText).toBe(plan.manifestText);
    const seal = f.makeSeal(plan); expect(verifySynthesisThematicInputSeal(seal, plan).receipt.requestId).toBe(f.scope.requestId);
  });
  it("accepts survey-only custody and refuses an empty source", () => {
    const f = fixture(makeSourceSnapshot(0)); expect(f.build().manifest.inputCount).toBe(1);
    const empty = makeSourceSnapshot(0); empty.answers = []; empty.sessions = [];
    empty.counts.answers = 0; empty.counts.sessions = 0;
    expect(() => fixture(empty).build()).toThrow("empty source");
  });
  it.each(["missing", "extra", "duplicate", "same-count-substitution", "shared-context"])("refuses %s membership", kind => {
    const f = fixture(makeSourceSnapshot(2));
    if (kind === "missing") f.entries.pop();
    if (kind === "extra") f.entries.push(structuredClone(f.entries[0]));
    if (kind === "duplicate") f.entries[1] = structuredClone(f.entries[0]);
    if (kind === "same-count-substitution") {
      const entry = f.entries[1]; entry.targetRecordId = `item:${randomUUID()}`;
      entry.proofText = JSON.stringify({ ...JSON.parse(entry.proofText), targetRecordId: entry.targetRecordId }); entry.proofSha256 = hash(entry.proofText);
    }
    if (kind === "shared-context") {
      const entry = f.entries[1]; entry.proofText = JSON.stringify({ ...JSON.parse(entry.proofText), contextRequestId: JSON.parse(f.entries[0].proofText).contextRequestId });
      entry.proofSha256 = hash(entry.proofText);
    }
    expect(() => f.build()).toThrow("membership is incomplete or differs");
  });
  it.each(["actorId", "intentSha256", "thematicSha256", "sourceId", "sourceSha256"])("refuses a self-hashed substituted %s", key => {
    const f = fixture(makeSourceSnapshot(1)), entry = f.entries[0];
    entry.proofText = JSON.stringify({ ...JSON.parse(entry.proofText), [key]: key.endsWith("Id") ? randomUUID() : "0".repeat(64) }); entry.proofSha256 = hash(entry.proofText);
    expect(() => f.build()).toThrow("proof differs from the manifest request");
  });
  it("refuses wrong source bytes, a self-hashed different source and malformed metadata", () => {
    const f = fixture(makeSourceSnapshot(1));
    expect(() => createSynthesisThematicInputManifest(f.request, f.scope, { ...f.source, snapshotText: "{}" }, f.entries)).toThrow("checksum differs");
    const other = fixture(makeSourceSnapshot(2));
    const matchingIntentEntries = other.entries.map(entry => {
      const proofText = JSON.stringify({ ...JSON.parse(entry.proofText), intentSha256: f.request.request.intentSha256 });
      return { ...entry, proofText, proofSha256: hash(proofText) };
    });
    expect(() => createSynthesisThematicInputManifest(f.request, f.scope, other.source, matchingIntentEntries)).toThrow("manifest source differs");
    const entry = f.entries[0];
    for (const patch of [{ proofSha256: "0".repeat(64) }, { outputSha256: "0".repeat(64) }]) {
      expect(() => verifySynthesisThematicInputMetadata({ ...entry, ...patch }, f.scope)).toThrow("metadata differs");
    }
    for (const outputBytes of [0, -1, 1.5, 4_194_305, Number.NaN]) expect(() => verifySynthesisThematicInputMetadata({ ...entry, outputBytes }, f.scope)).toThrow();
    expect(() => verifySynthesisThematicInputMetadata({ ...entry, outputText: "not metadata" }, f.scope)).toThrow();
  });
  it("changes the chain for each retained dependency, output byte count and request identity", () => {
    const f = fixture(makeSourceSnapshot(1)), original = f.build();
    for (const key of ["choiceSha256", "contextRequestSha256", "historyManifestSha256", "finalCaptureSha256", "finalResultSha256"]) {
      const entries = structuredClone(f.entries), entry = entries[0];
      entry.proofText = JSON.stringify({ ...JSON.parse(entry.proofText), [key]: "0".repeat(64) }); entry.proofSha256 = hash(entry.proofText);
      const plan = createSynthesisThematicInputManifest(f.request, f.scope, f.source, entries);
      expect(plan.manifest.tailSha256).not.toBe(original.manifest.tailSha256);
    }
    const bytes = structuredClone(f.entries); bytes[0].outputBytes++;
    expect(createSynthesisThematicInputManifest(f.request, f.scope, f.source, bytes).manifest.tailSha256).not.toBe(original.manifest.tailSha256);
    const output = structuredClone(f.entries), entry = output[0]; entry.outputSha256 = hash("changed");
    entry.proofText = JSON.stringify({ ...JSON.parse(entry.proofText), outputSha256: entry.outputSha256 }); entry.proofSha256 = hash(entry.proofText);
    expect(createSynthesisThematicInputManifest(f.request, f.scope, f.source, output).manifest.tailSha256).not.toBe(original.manifest.tailSha256);
  });
  it("refuses changed manifest bytes, either digest, and self-hashed wrong receipt identity", () => {
    const f = fixture(makeSourceSnapshot(1)), plan = f.build(), original = f.makeSeal(plan);
    for (const patch of [{ manifestText: original.manifestText + " " }, { manifestSha256: "0".repeat(64) },
      { receiptSha256: "0".repeat(64) }]) {
      expect(() => verifySynthesisThematicInputSeal({ ...original, ...patch }, plan)).toThrow("seal differs");
    }
    const paddedReceipt = " ".repeat(8193) + original.receiptText;
    expect(() => verifySynthesisThematicInputSeal({ ...original, receiptText: paddedReceipt, receiptSha256: hash(paddedReceipt) }, plan)).toThrow("seal differs");
    const alternateManifest = original.manifestText + " ";
    expect(() => verifySynthesisThematicInputSeal({ ...original, manifestText: alternateManifest, manifestSha256: hash(alternateManifest) }, plan)).toThrow("seal differs");
    for (const patch of [{ requestId: randomUUID() }, { manifestSha256: "0".repeat(64) }, { purpose: "approved" }, { extra: true }]) {
      const receiptText = JSON.stringify({ ...JSON.parse(original.receiptText), ...patch });
      expect(() => verifySynthesisThematicInputSeal({ ...original, receiptText, receiptSha256: hash(receiptText) }, plan)).toThrow();
    }
    const other = structuredClone(plan); other.manifest.tailSha256 = "0".repeat(64); other.manifestText = JSON.stringify(other.manifest); other.manifestSha256 = hash(other.manifestText);
    expect(() => verifySynthesisThematicInputSeal(f.makeSeal(other), plan)).toThrow("seal differs");
  });
});
