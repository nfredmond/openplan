import { test } from "node:test";
import assert from "node:assert/strict";
import { runClaudeProjectTurn } from "../claude-provider.mjs";

const request = { model: "claude-sonnet-4-6", expectedAuthMode: "claude_subscription", instructions: "Selected project only", prompt: "Read the selected record", outputSchema: { type: "object" } };

// No native paths are provided. Every malformed request must stop at the
// request boundary, before looking for a binary, credentials or a provider.
for (const [name, changed, code] of [
  ["missing model", { model: undefined }, "native_request_invalid"],
  ["model alias", { model: "sonnet" }, "native_request_invalid"],
  ["unexpected billing mode", { expectedAuthMode: "apiKey" }, "native_request_invalid"],
  ["empty question", { prompt: " " }, "native_input_too_large"],
  ["oversized question bytes", { prompt: "é".repeat(50_001) }, "native_input_too_large"],
  ["oversized instruction bytes", { instructions: "é".repeat(10_001) }, "native_input_too_large"],
  ["missing output schema", { outputSchema: null }, "native_output_schema_invalid"],
  ["array output schema", { outputSchema: [] }, "native_output_schema_invalid"],
  ["oversized output schema", { outputSchema: { description: "x".repeat(32_001) } }, "native_output_schema_invalid"],
]) test(`refuses ${name} before native execution`, async () => {
  await assert.rejects(runClaudeProjectTurn({ ...request, ...changed }), { code });
});
