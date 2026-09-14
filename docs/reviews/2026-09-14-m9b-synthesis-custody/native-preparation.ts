import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { verifySynthesisSource } from "../../../openplan/src/lib/engagement/synthesis-sources-server";
import { prepareSynthesisSource } from "../../../openplan/src/lib/engagement/synthesis-preparation";

const path = "/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/synthesis-native-source.json";
const raw = readFileSync(path, "utf8");
const source = JSON.parse(raw);
assert.equal(createHash("sha256").update(raw).digest("hex"), "cd2c88f1607eae6b3f42a8ca3064aa6aa5984e3b600cec19e300eb2830c3239d");
const verified = verifySynthesisSource(source, source);
const prepared = prepareSynthesisSource(verified.snapshot, verified.snapshotSha256);
assert.equal(prepared.counts.contributions, 303);
assert.equal(prepared.counts.answers, 2);
const allMembers = prepared.categoryGroups.flatMap(group => group.sourceIds);
assert.equal(allMembers.length, 303);
assert.equal(new Set(allMembers).size, 303);
assert.deepEqual([...allMembers].sort(), [...verified.snapshot.items.map(item => `item:${item.id}`), ...verified.snapshot.answers.map(answer => `answer:${answer.id}`)].sort());
assert.equal(prepared.questionGroups.reduce((count, group) => count + group.sourceIds.length, 0), 2);
assert.equal(prepared.interpretation, "not_assessed");
writeFileSync(new URL("./native-preparation.json", import.meta.url), JSON.stringify({
  historicalInputSha256: createHash("sha256").update(raw).digest("hex"),
  sourceSha256: verified.snapshotSha256, counts: prepared.counts,
  categoryGroupCount: prepared.categoryGroups.length, questionGroupCount: prepared.questionGroups.length,
  completeDistinctMembership: true,
  limits: "Current preparation consumed the retained prior native RPC output through the actual source verifier. This is a parser/preparation join, not a fresh database test or browser evidence. No staff review, generated interpretation, or export is proved."
}, null, 2) + "\n");
console.log(JSON.stringify(prepared.counts));
