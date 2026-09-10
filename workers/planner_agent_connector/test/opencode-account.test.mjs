import { test } from "node:test";
import assert from "node:assert/strict";
import { openCodeAccountSummary, openCodeModelCatalog } from "../opencode-account.mjs";

test("projects exact native API mode without credentials or identifying metadata", () => {
  const raw = { openai: { type: "api", key: "SYNTHETIC_SECRET", metadata: { organization: "PRIVATE_ORGANIZATION" } } };
  assert.deepEqual(openCodeAccountSummary(raw), { status: "connected", authMode: "opencode_api", planType: null });
  assert.equal(raw.openai.key, "SYNTHETIC_SECRET");
});

for (const raw of [{}, { OpenAI: { type: "api", key: "SYNTHETIC_SECRET" } },
  Object.create({ openai: { type: "api", key: "SYNTHETIC_SECRET" } }),
  { anthropic: { type: "api", key: "SYNTHETIC_SECRET" } }]) {
  test(`does not infer OpenAI credentials from other names or inherited properties: ${JSON.stringify(raw)}`, () => {
    assert.deepEqual(openCodeAccountSummary(raw), { status: "needs_login", authMode: null, planType: null });
  });
}

for (const type of ["oauth", "wellknown", "unknown", undefined]) test(`refuses unsupported native mode ${type}`, () => {
  assert.deepEqual(openCodeAccountSummary({ openai: { type, key: "SYNTHETIC_SECRET" } }),
    { status: "unsupported_auth_mode", authMode: null, planType: null });
});

for (const [name, raw] of [
  ["null root", null], ["array root", []], ["string root", "private invalid content"],
  ["null account", { openai: null }], ["array account", { openai: [] }],
  ["string account", { openai: "private invalid content" }],
  ...[undefined, 7, "", "with space", "line\nbreak", "unicode-É", "x".repeat(8193)].map((key, index) =>
    [`invalid key ${index}`, { openai: { type: "api", key } }]),
  ...[null, [], "private metadata", { id: 7 }].map((metadata, index) =>
    [`invalid metadata ${index}`, { openai: { type: "api", key: "SYNTHETIC_SECRET", metadata } }]),
]) test(`refuses unreadable account: ${name}`, () => {
  assert.throws(() => openCodeAccountSummary(raw), { message: "native_account_unreadable" });
});

test("preserves exact native model IDs and does not choose a default", () => {
  assert.deepEqual(openCodeModelCatalog("openai/gpt-6-astra\r\nopenai/gpt-5.4\r\n"), [
    { id: "gpt-6-astra", label: "gpt-6-astra", isDefault: false },
    { id: "gpt-5.4", label: "gpt-5.4", isDefault: false },
  ]);
});

for (const [name, stdout] of [
  ["nonstring", null], ["empty", ""], ["wrong provider", "anthropic/gpt-6-astra"],
  ["missing provider", "gpt-6-astra"], ["duplicate", "openai/gpt-6-astra\nopenai/gpt-6-astra"],
  ["unexpected diagnostic", "WARNING\nopenai/gpt-6-astra"], ["blank record", "openai/a\n\nopenai/b"],
  ["oversized output", Array.from({length:900}, (_, i) => `openai/${`m${i}`.padEnd(140, "x")}`).join("\n")],
  ["too many models", Array.from({length:1001}, (_, i) => `openai/m${i}`).join("\n")],
  ["long model ID", `openai/${"x".repeat(141)}`], ["path model ID", "openai/../../other"],
]) test(`refuses malformed native catalog: ${name}`, () => {
  assert.throws(() => openCodeModelCatalog(stdout), { message: "native_models_unreadable" });
});
