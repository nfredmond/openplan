import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { verifySynthesisGenerationInput } from "./synthesis-generation-input";
import type { SynthesisSourceScope } from "./synthesis-sources-server";

type RecordKind = "context" | "definition" | "session" | "item" | "answer";
type Reference = { id: string; retained: boolean };
export type SynthesisGenerationRecord = {
  id: string; kind: RecordKind; text: string; sha256: string; utf8Bytes: number; references: Reference[];
};
export type SynthesisGenerationRecords = {
  schemaVersion: 1; purpose: "private_synthesis_semantic_records"; interpretation: "not_assessed";
  source: SynthesisSourceScope & { sha256: string }; inputManifestSha256: string;
  contributionIds: string[]; records: SynthesisGenerationRecord[]; manifestSha256: string;
};
export type SynthesisGenerationField = { pointer: string } & (
  | { kind: "object" | "array"; childCount: number }
  | { kind: "string" | "number" | "boolean" | "null"; text: string }
);
export type SynthesisGenerationFields = {
  schemaVersion: 1; recordsManifestSha256: string;
  records: Array<{ recordId: string; recordSha256: string; fields: SynthesisGenerationField[]; fieldsSha256: string }>;
};
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// Node 24 supplies the original numeric token to the JSON reviver. Keep it in
// an internal class so a participant's {token: ...} object cannot impersonate it.
class RetainedNumber {
  constructor(readonly token: string) {}
}
function parseRetainedJSON(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== "number") return value;
    const token = context?.source;
    if (typeof token !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
      throw new Error("Original synthesis numeric token is unavailable");
    }
    return new RetainedNumber(token);
  });
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof RetainedNumber) {
    throw new Error("Retained synthesis object is unavailable");
  }
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Retained synthesis collection is unavailable");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Retained synthesis text is unavailable");
  return value;
}

// Serialize the complete logical record. String values retain their meaning;
// numeric tokens retain their original spelling instead of a rounded JS value.
// The input protocol separately preserves the original whole-document bytes.
function recordText(value: unknown): string {
  if (value instanceof RetainedNumber) return value.token;
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(recordText).join(",")}]`;
  return `{${Object.entries(object(value)).map(([key, child]) => `${JSON.stringify(key)}:${recordText(child)}`).join(",")}}`;
}

/** Build whole records only after the complete original input and its authority agree. */
export function createSynthesisGenerationRecords(input: unknown, saved: unknown, scope: SynthesisSourceScope): SynthesisGenerationRecords {
  const verified = verifySynthesisGenerationInput(input, saved, scope);
  const snapshot = object(parseRetainedJSON(verified.snapshotText));
  const contextId = `context:${scope.requestId}`;
  const collections = new Set(["items", "answers", "sessions", "definitions"]);
  const records: SynthesisGenerationRecord[] = [];
  function retain(id: string, kind: RecordKind, text: string, references: string[]) {
    records.push({ id, kind, text, sha256: sha256(text), utf8Bytes: Buffer.byteLength(text, "utf8"),
      references: [...new Set(references)].map(id => ({ id, retained: false })) });
  }
  retain(contextId, "context", recordText(Object.fromEntries(Object.entries(snapshot).filter(([key]) => !collections.has(key)))), []);
  for (const raw of array(snapshot.definitions)) {
    const row = object(raw);
    retain(`definition:${string(row.id)}`, "definition", string(row.definitionText), [contextId]);
  }
  for (const [collection, kind] of [["sessions", "session"], ["items", "item"], ["answers", "answer"]] as const) {
    for (const raw of array(snapshot[collection])) {
      const row = object(raw);
      const references = [contextId];
      if (row.configuration_version_id !== null && row.configuration_version_id !== undefined) {
        references.push(`definition:${string(row.configuration_version_id)}`);
      }
      if (kind === "item" && row.parent_item_id !== null) references.push(`item:${string(row.parent_item_id)}`);
      if (kind === "answer") references.push(`session:${string(row.session_id)}`);
      retain(`${kind}:${string(row.id)}`, kind, recordText(raw), references);
    }
  }
  const retainedIds = new Set(records.map(record => record.id));
  for (const record of records) for (const reference of record.references) reference.retained = retainedIds.has(reference.id);
  const value = {
    schemaVersion: 1 as const, purpose: "private_synthesis_semantic_records" as const, interpretation: "not_assessed" as const,
    source: { ...scope, sha256: verified.manifest.source.sha256 }, inputManifestSha256: verified.manifestSha256,
    contributionIds: verified.manifest.coverage.sourceIds, records,
  };
  // Bind references and ordered membership as well as each complete record.
  const manifest = { ...value, records: records.map(({ text: _text, ...descriptor }) => descriptor) };
  return { ...value, manifestSha256: sha256(JSON.stringify(manifest)) };
}

/** Self-hashed generated records cannot replace the authoritative retained input. */
export function verifySynthesisGenerationRecords(raw: unknown, input: unknown, saved: unknown, scope: SynthesisSourceScope) {
  const expected = createSynthesisGenerationRecords(input, saved, scope);
  if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis records differ from the retained input");
  return expected;
}

/** Encode complete typed fields with original numeric tokens. This does not establish source authority. */
export function synthesisGenerationJSONFields(text: string): SynthesisGenerationField[] {
  const fields: SynthesisGenerationField[] = [];
  function visit(pointer: string, value: unknown) {
    if (value instanceof RetainedNumber) fields.push({ pointer, kind: "number", text: value.token });
    else if (value === null) fields.push({ pointer, kind: "null", text: "null" });
    else if (typeof value === "string") fields.push({ pointer, kind: "string", text: value });
    else if (typeof value === "boolean") fields.push({ pointer, kind: "boolean", text: value ? "true" : "false" });
    else if (Array.isArray(value)) {
      fields.push({ pointer, kind: "array", childCount: value.length });
      value.forEach((child, index) => visit(`${pointer}/${index}`, child));
    } else {
      const entries = Object.entries(object(value));
      fields.push({ pointer, kind: "object", childCount: entries.length });
      for (const [key, child] of entries) visit(`${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, child);
    }
  }
  visit("", parseRetainedJSON(text));
  return fields;
}

/** Reconstruct authority before exposing a saved record's typed fields. */
export function createSynthesisGenerationFields(rawRecords: unknown, input: unknown, saved: unknown, scope: SynthesisSourceScope): SynthesisGenerationFields {
  const verified = verifySynthesisGenerationRecords(rawRecords, input, saved, scope);
  const records = verified.records.map(record => {
    const fields = synthesisGenerationJSONFields(record.text);
    const value = { recordId: record.id, recordSha256: record.sha256, fields };
    return { ...value, fieldsSha256: sha256(JSON.stringify(value)) };
  });
  return { schemaVersion: 1, recordsManifestSha256: verified.manifestSha256, records };
}

/** A field inventory must still account for the entire authoritative record set. */
export function verifySynthesisGenerationFields(raw: unknown, rawRecords: unknown, input: unknown, saved: unknown, scope: SynthesisSourceScope) {
  const expected = createSynthesisGenerationFields(rawRecords, input, saved, scope);
  if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis fields differ from the retained records");
  return expected;
}
