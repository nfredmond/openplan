// Synthetic frames matching the historical protocol. No provider is contacted.
import { createInterface } from "node:readline";
const code = process.argv[2] ?? "usageLimitExceeded";
const bucketMode = process.argv[3] ?? "default";
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let limitsRead = false;
createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "account/rateLimits/read") {
    limitsRead = true;
    const defaultBucket = { limitId: "codex", primary: { usedPercent: 100, resetsAt: 1800000000 },
      secondary: { usedPercent: 100, resetsAt: 1800000600 }, planType: "PRIVATE_PLAN" };
    const otherBucket = { limitId: "other-model", normalModelSlug: "synthetic", primary: { usedPercent: 100,
      resetsAt: bucketMode.endsWith("unknown") ? null : 1900000000 } };
    send({ id: request.id, result: { accountId: "PRIVATE_ACCOUNT", rateLimits: defaultBucket,
      ...(bucketMode.startsWith("initial-multi") ? { rateLimitsByLimitId: { codex: defaultBucket, "other-model": otherBucket } } : {}) } });
    if (bucketMode.startsWith("later-other")) send({ method: "account/rateLimits/updated", params: { rateLimits: otherBucket } });
    // Sparse unavailable fields preserve the initial attempt snapshot.
    send({ method: "account/rateLimits/updated", params: { rateLimits: { primary: null, secondary: null } } });
  } else if (request.method === "account/read") send({ id: request.id, result: { account: { type: "chatgpt", planType: "PRIVATE_PLAN" } } });
  else if (request.method === "thread/start") send({ id: request.id, result: { model: "synthetic", thread: { id: "synthetic-thread" } } });
  else if (request.method === "initialized") return;
  else if (request.method === "turn/start") {
    if (!limitsRead) return send({ id: request.id, error: { code: -32000, message: "Fixture requires the attempt snapshot before generation" } });
    send({ method: "turn/completed", params: { threadId: "synthetic-thread", turn: {
      id: "synthetic-turn", status: "failed", error: { codexErrorInfo: code, message: "PRIVATE_PROSE_RESET_1900000000" } } } });
    // A later notification must not rewrite the final receipt.
    send({ method: "account/rateLimits/updated", params: { rateLimits: { primary: { usedPercent: 100, resetsAt: 1900000000 } } } });
    send({ id: request.id, result: { turn: { id: "synthetic-turn" } } });
  } else send({ id: request.id, result: {} });
});
