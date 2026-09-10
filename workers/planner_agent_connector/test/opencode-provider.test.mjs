import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectOpenCodeConnection, runOpenCodeProjectTurn } from "../opencode-provider.mjs";

const options = { binaryPath: "/nonexistent/openplan-provider-binary", providerHome: "/nonexistent/openplan-profile",
  scratchPath: "/nonexistent/openplan-scratch", model: "gpt-6-astra", expectedAuthMode: "opencode_api",
  prompt: "SYNTHETIC project packet", instructions: "Use only the packet.", outputSchema: { type: "object" } };

for (const [name, changed, code] of [
  ["missing model", { model: undefined }, "native_request_invalid"],
  ["invalid model", { model: "openai/invalid" }, "native_request_invalid"],
  ["wrong backend mode", { expectedAuthMode: "apiKey" }, "native_request_invalid"],
  ["nonstring prompt", { prompt: null }, "native_input_too_large"],
  ["empty prompt", { prompt: " " }, "native_input_too_large"],
  ["large prompt", { prompt: "x".repeat(100001) }, "native_input_too_large"],
  ["nonstring instructions", { instructions: null }, "native_input_too_large"],
  ["empty instructions", { instructions: " " }, "native_input_too_large"],
  ["large instructions", { instructions: "x".repeat(20001) }, "native_input_too_large"],
  ["missing schema", { outputSchema: undefined }, "native_output_schema_invalid"],
  ["array schema", { outputSchema: [] }, "native_output_schema_invalid"],
  ["string schema", { outputSchema: "private-invalid" }, "native_output_schema_invalid"],
  ["large schema", { outputSchema: { description: "x".repeat(32001) } }, "native_output_schema_invalid"],
]) test(`refuses ${name} before native launch`, async () => {
  await assert.rejects(runOpenCodeProjectTurn({ ...options, ...changed }), { message: code });
});

test("refuses cyclic schemas with a fixed error", async () => {
  const schema = {}; schema.self = schema;
  await assert.rejects(runOpenCodeProjectTurn({ ...options, outputSchema: schema }), { message: "native_output_schema_invalid" });
});

test("cancelled inspection does not read or launch the native profile", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectOpenCodeConnection({ ...options, signal: controller.signal }), { message: "native_cancelled" });
});

test("already-cancelled generation refuses before opening the relay or profile", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runOpenCodeProjectTurn({ ...options, signal: controller.signal }), { message: "native_cancelled" });
});
