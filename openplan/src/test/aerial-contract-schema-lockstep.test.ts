import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CONTRACT_SCHEMA_VERSIONS,
  PROCESSING_PRESET_IDS,
  PROCESSING_ARTIFACT_KINDS,
} from "@/lib/aerial/processing-contract";

/**
 * The processing contract lives twice: as the canonical JSON Schema at the
 * repo root (schemas/aerial_processing_contract.schema.json, committed
 * identically to the external worker's repo) and as the zod mirror in
 * src/lib/aerial/processing-contract.ts. Until this test existed, the only
 * thing checking they agreed was the odm_worker's plain-script Python suite —
 * which `npm run qa:gate` never runs, so the app could drift from the schema
 * with every gate green (review note N2, 2026-08-11). This reads the actual
 * schema file, so a vocabulary change on either side fails the vitest suite.
 */

const SCHEMA_PATH = path.join(
  process.cwd(),
  "..",
  "schemas",
  "aerial_processing_contract.schema.json"
);

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function schemaEnumAt(schema: JsonValue, defName: string, propertyPath: string[]): string[] {
  let node: JsonValue = (schema as Record<string, JsonValue>)["$defs"];
  node = (node as Record<string, JsonValue>)[defName];
  for (const step of propertyPath) {
    node = (node as Record<string, JsonValue>)[step];
  }
  const values = (node as Record<string, JsonValue>)["enum"];
  expect(Array.isArray(values)).toBe(true);
  return values as string[];
}

describe("the zod contract mirror stays in lockstep with the schema file", () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")) as JsonValue;

  it("agrees on the schema versions, in the request and the callback alike", () => {
    const requestVersions = schemaEnumAt(schema, "ProcessingRequest", [
      "properties",
      "schemaVersion",
    ]);
    const callbackVersions = schemaEnumAt(schema, "ProcessingCallback", [
      "properties",
      "schemaVersion",
    ]);
    expect([...CONTRACT_SCHEMA_VERSIONS].sort()).toEqual([...requestVersions].sort());
    expect([...CONTRACT_SCHEMA_VERSIONS].sort()).toEqual([...callbackVersions].sort());
  });

  it("agrees on the preset vocabulary", () => {
    const presets = schemaEnumAt(schema, "ProcessingRequest", ["properties", "presetId"]);
    expect([...PROCESSING_PRESET_IDS].sort()).toEqual([...presets].sort());
  });

  it("agrees on the artifact kinds", () => {
    const kinds = schemaEnumAt(schema, "ProcessingCallback", [
      "properties",
      "artifacts",
      "items",
      "properties",
      "kind",
    ]);
    expect([...PROCESSING_ARTIFACT_KINDS].sort()).toEqual([...kinds].sort());
  });
});
