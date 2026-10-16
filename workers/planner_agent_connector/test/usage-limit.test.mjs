import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { startCodexSession, NativeProviderError } from "../codex-session.mjs";
import { codexTurnFailure } from "../codex-provider.mjs";
import { codexUsageLimitTracker } from "../codex-usage-limit.mjs";
import { connectorCycle, privateConnectorDirectory, writeConnectorJournal } from "../connector-worker.mjs";
import { ConnectorError } from "../connector-client.mjs";
import { usageLimitReceipt, validUsageLimitDelivery } from "../usage-limit-receipt.mjs";
// Every supported Node entry point owns and cleans a mode-0700 temporary parent.
const base = await mkdtemp(join(process.env.OPENPLAN_USAGE_TEST_TMP ?? tmpdir(), "openplan-usage-limit-"));
after(async () => { await rm(base, { recursive: true, force: true }); });
await privateConnectorDirectory(base);
const uid = n => `${n}`.repeat(8)+"-1111-4111-8111-111111111111";
const setup = { version: 1, appUrl: "http://127.0.0.1:3219", connectionId: uid(1), workspaceId: uid(2), projectId: uid(3), expectedAuthMode: "chatgpt", token: `op_pc_${uid(1)}.${"s".repeat(43)}` };
const packet = { version: 1, workspaceId: uid(2), project: { id: uid(3), name: "SYNTHETIC" }, source: { id: `project:${uid(3)}`, label: "SYNTHETIC", href: `/projects/${uid(3)}` } };
const packetCanonical = JSON.stringify(packet);
const job = { id: uid(4), requestId: uid(5), userId: uid(6), attemptId: uid(7), workspaceId: uid(2), projectId: uid(3),
  authMode: "chatgpt", model: "synthetic", question: "Stored facts?", packetCanonical, packetHash: createHash("sha256").update(packetCanonical).digest("hex"),
  prompt: JSON.stringify({ question: "Stored facts?", selectedProjectRecord: packet }), instructions: "Synthetic project", outputSchema: { type: "object" }, leaseExpiresAt: "2099-01-01T00:00:00Z" };
const detail = { code: "usageLimitExceeded", resetAtUnixSeconds: 1800000600, resetSource: "account_rate_limits", nativeThreadId: "synthetic-thread", nativeTurnId: "synthetic-turn" };

test("structured frames keep generic resets unknown and discard unbound windows and prose", async () => {
  for (const code of ["usageLimitExceeded", "rateLimitExceeded", "sessionBudgetExceeded", "other"]) {
    const session = startCodexSession({ command: process.execPath, args: [fileURLToPath(new URL("./usage-limit-frames.mjs", import.meta.url)), code], options: { stdio: ["pipe", "pipe", "pipe"], env: {} } }, { timeoutMs: 2000 });
    try {
      await session.request("account/rateLimits/read", {});
      await session.request("turn/start", {});
      const final = await session.waitFor("turn/completed", value => value.threadId === "synthetic-thread" && value.turn.id === "synthetic-turn");
      const error = codexTurnFailure(final, session);
      assert.equal(error.code, code === "other" ? "native_turn_failed" : "native_usage_limit");
      if (code !== "other") assert.equal(error.usageLimit.resetAtUnixSeconds, null, "Unbound bucket reset reached the failure");
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE|1900000000/, "Raw metadata escaped");
    } finally { await session.close(); }
  }
});

test("qualified window observations preserve sparse values and bounds without binding a failure reset", () => {
  const tracker = codexUsageLimitTracker();
  assert.equal(tracker.signal("usageLimitExceeded").resetAtUnixSeconds, null);
  for (const bad of [undefined, null, -1, 1.5, "1800000000", 253402300800]) {
    tracker.merge({ primary: { usedPercent: 100, resetsAt: bad } });
    assert.equal(tracker.defaultWindowObservations().primary.resetsAt, null, `Invalid observation reset ${bad}`);
  }
  tracker.merge({ primary: { usedPercent: 100, resetsAt: 1800000000 } });
  tracker.merge({ primary: null });
  assert.equal(tracker.defaultWindowObservations().primary?.resetsAt, 1800000000, "Sparse update cleared a qualified observation");
  const observation = tracker.defaultWindowObservations();
  observation.primary.resetsAt = 42;
  assert.equal(tracker.defaultWindowObservations().primary.resetsAt, 1800000000, "Observed copy changed session state");
  assert.equal(tracker.signal("usageLimitExceeded").resetAtUnixSeconds, null, "Even a sole default observation lacks causal binding");
  tracker.merge({ primary: { usedPercent: 100 } });
  assert.equal(tracker.defaultWindowObservations().primary.resetsAt, null, "Old observation reset survived a newly reported unknown window");
  tracker.merge({ limitId: "other-model", primary: { usedPercent: 100, resetsAt: 1900000000 } });
  assert.equal(tracker.signal("usageLimitExceeded").resetAtUnixSeconds, null);
  tracker.merge({ primary: { usedPercent: 99, resetsAt: 1800000000 } });
  assert.equal(tracker.signal("usageLimitExceeded").resetAtUnixSeconds, null);
  assert.equal(codexUsageLimitTracker().signal("usageLimitExceeded").resetAtUnixSeconds, null);
  assert.equal(tracker.signal({ usageLimitExceeded: {} }), null);
});

test("known default followed by known or unknown nondefault windows never supplies a causal reset", () => {
  for (const otherReset of [1900000000, null]) {
    const tracker = codexUsageLimitTracker();
    tracker.merge({ limitId: "codex", primary: { usedPercent: 100, resetsAt: 1800000000 } });
    tracker.merge({ limitId: "other-model", normalModelSlug: "synthetic", primary: { usedPercent: 100, resetsAt: otherReset } });
    assert.equal(tracker.defaultWindowObservations().primary.resetsAt, 1800000000, "Nondefault bucket replaced a qualified default observation");
    assert.deepEqual(tracker.signal("usageLimitExceeded"), { code: "usageLimitExceeded", resetAtUnixSeconds: null, resetSource: null },
      "Generic error borrowed an unbound default reset");
  }
});

test("failure journal replays exact scoped bytes after lost acknowledgement without regeneration", async () => {
  const directory = await mkdtemp(join(base, "replay-")); await privateConnectorDirectory(directory);
  let generates = 0, inspections = 0, failDelivery = true;
  const deliveries = [];
  const options = { inspect: async () => { inspections++; return { status: "connected", authMode: "chatgpt" }; },
    generate: async () => { generates++; throw new NativeProviderError("native_usage_limit", detail); },
    request: async (_setup, body) => {
      if (body.operation === "claim") return { status: "connected", turn: job };
      if (body.operation === "status") return { id: job.id, attemptId: job.attemptId, state: "running", leaseExpiresAt: job.leaseExpiresAt };
      deliveries.push(JSON.stringify(body));
      const pending = JSON.parse(await readFile(join(directory, "pending.json")));
      assert.deepEqual(pending.delivery, body, "Delivery preceded durable result");
      if (failDelivery) throw new ConnectorError("synthetic_lost_ack", 503);
      return { id: job.id, attemptId: job.attemptId, state: "failed" };
    } };
  try {
    await assert.rejects(connectorCycle({ setup }, directory, options), /synthetic_lost_ack/);
    const before = JSON.parse(await readFile(join(directory, "pending.json")));
    assert.deepEqual(before.delivery.receipt, usageLimitReceipt(job, setup, detail));
    assert.equal(before.delivery.answer, null);
    assert.equal(before.delivery.failureCode, "native_usage_limit");
    assert.equal(validUsageLimitDelivery(before.delivery, job, setup), true);
    try {
      await writeConnectorJournal(directory, { ...before, delivery: { ...before.delivery,
        receipt: { ...before.delivery.receipt, userId: uid(9) } } });
      await assert.rejects(connectorCycle({ setup }, directory, options), /connector_journal_mismatch/, "Changed scoped journal was delivered");
    } finally { await writeConnectorJournal(directory, before); }
    failDelivery = false;
    assert.equal((await connectorCycle({ setup }, directory, options)).state, "failed");
    assert.deepEqual(deliveries, [deliveries[0], deliveries[0]]);
    assert.equal(generates, 1); assert.equal(inspections, 1);
    for (const field of ["userId", "requestId", "workspaceId", "projectId", "connectionId", "turnId", "attemptId", "packetHash", "model", "authMode"]) {
      assert.equal(validUsageLimitDelivery({ ...before.delivery, receipt: { ...before.delivery.receipt, [field]: "different" } }, job, setup), false, field);
    }
    assert.equal(validUsageLimitDelivery({ ...before.delivery, receipt: { ...before.delivery.receipt, prose: "private" } }, job, setup), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cancelled generation cannot deliver a limited receipt", async () => {
  const directory = await mkdtemp(join(base, "cancel-")); await privateConnectorDirectory(directory);
  const controller = new AbortController();
  let saved;
  try {
    await connectorCycle({ setup }, directory, { signal: controller.signal,
      inspect: async () => ({ status: "connected", authMode: "chatgpt" }),
      generate: async () => { controller.abort(); throw new NativeProviderError("native_usage_limit", detail); },
      request: async (_setup, body) => {
        if (body.operation === "claim") return { status: "connected", turn: job };
        if (body.operation === "status") return { id: job.id, attemptId: job.attemptId, state: "running", leaseExpiresAt: job.leaseExpiresAt };
        saved = body;
        return { id: job.id, attemptId: job.attemptId, state: "cancelled" };
      } });
    assert.equal(saved.receipt, null);
    assert.equal(saved.failureCode, "native_connector_interrupted");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
