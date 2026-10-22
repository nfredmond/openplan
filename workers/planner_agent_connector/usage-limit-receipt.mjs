import { isDeepStrictEqual } from "node:util";
import { CODEX_LIMIT_CODES, validReset } from "./codex-usage-limit.mjs";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const nativeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);

// This is a connector report, not independent proof of provider authenticity.
export function usageLimitReceipt(job, setup, detail) {
  if ((setup.provider ?? "codex") !== "codex" || !uuid(job.userId) || !uuid(job.requestId) ||
    !detail || !CODEX_LIMIT_CODES.includes(detail.code) || !nativeId(detail.nativeThreadId) || !nativeId(detail.nativeTurnId) ||
    (detail.resetAtUnixSeconds !== null && !validReset(detail.resetAtUnixSeconds)) ||
    detail.resetSource !== (detail.resetAtUnixSeconds === null ? null : "account_rate_limits") ||
    (detail.code !== "usageLimitExceeded" && detail.resetAtUnixSeconds !== null)) return null;
  return { schemaVersion: 2, outcome: "limited", provider: "codex", model: job.model, authMode: job.authMode,
    userId: job.userId, requestId: job.requestId, workspaceId: job.workspaceId, projectId: job.projectId,
    connectionId: setup.connectionId, turnId: job.id, attemptId: job.attemptId, packetHash: job.packetHash,
    signal: { code: detail.code, resetAtUnixSeconds: detail.resetAtUnixSeconds, resetSource: detail.resetSource },
    nativeThreadId: detail.nativeThreadId, nativeTurnId: detail.nativeTurnId };
}

export function validUsageLimitDelivery(delivery, job, setup) {
  const receipt = delivery?.receipt;
  const expected = usageLimitReceipt(job, setup, receipt && { ...receipt.signal,
    nativeThreadId: receipt.nativeThreadId, nativeTurnId: receipt.nativeTurnId });
  return delivery?.answer === null && delivery?.failureCode === "native_usage_limit" && expected !== null && isDeepStrictEqual(receipt, expected);
}
