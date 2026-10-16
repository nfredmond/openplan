import { z } from "zod";

export const providerUsageLimitReceiptSchema = z.object({
  schemaVersion: z.literal(2), outcome: z.literal("limited"), provider: z.literal("codex"),
  model: z.string().min(1).max(160), authMode: z.enum(["chatgpt", "apiKey"]),
  userId: z.string().uuid(), requestId: z.string().uuid(), workspaceId: z.string().uuid(), projectId: z.string().uuid(),
  connectionId: z.string().uuid(), turnId: z.string().uuid(), attemptId: z.string().uuid(), packetHash: z.string().regex(/^[a-f0-9]{64}$/),
  nativeThreadId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), nativeTurnId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  signal: z.object({ code: z.enum(["usageLimitExceeded", "rateLimitExceeded", "sessionBudgetExceeded"]),
    resetAtUnixSeconds: z.number().int().min(0).max(253402300799).nullable(),
    resetSource: z.literal("account_rate_limits").nullable() }).strict().refine(signal =>
    signal.resetSource === (signal.resetAtUnixSeconds === null ? null : "account_rate_limits") &&
    (signal.code === "usageLimitExceeded" || signal.resetAtUnixSeconds === null)),
}).strict();

type TurnScope = { id: string; request_id: string; user_id?: string; workspace_id: string; project_id: string;
  connection_id?: string | null; attempt_id?: string | null; provider: string; model_id: string; auth_mode: string;
  packet_hash: string; state: string; failure_code: string | null; result: unknown; provider_receipt?: unknown };

// Validate both the narrow report and its retained attempt. A provider code by
// itself cannot establish a structured report, reset time or restored access.
export function checkedNativeUsageLimit(turn: TurnScope) {
  const parsed = providerUsageLimitReceiptSchema.safeParse(turn.provider_receipt);
  if (!parsed.success) return null;
  const receipt = parsed.data;
  if (turn.state !== "failed" || turn.failure_code !== "native_usage_limit" || turn.result !== null ||
    receipt.provider !== turn.provider || receipt.model !== turn.model_id || receipt.authMode !== turn.auth_mode ||
    receipt.userId !== turn.user_id || receipt.requestId !== turn.request_id || receipt.workspaceId !== turn.workspace_id ||
    receipt.projectId !== turn.project_id || receipt.connectionId !== turn.connection_id || receipt.turnId !== turn.id ||
    receipt.attemptId !== turn.attempt_id || receipt.packetHash !== turn.packet_hash) return null;
  return receipt;
}
