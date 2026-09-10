import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assistantApprovalActionSchema, hashAssistantActionPayload } from "./action-approval-server";
import { HoldReceiptError, readHoldReceipt, type HoldReceipt, type StageGateHoldAction } from "./stage-gate-hold-receipt";

export type ApprovedHoldRecoveryEntry = {
  approvalId: string; inputHash: string; approvedAt: string; expiresAt: string;
  action: StageGateHoldAction | null; gateLabel: string; receipt: HoldReceipt | null; issue: string | null;
};
const HOLD_RECOVERY_PAGE_SIZE = 20;
export const HOLD_RECOVERY_COLUMNS = "id, workspace_id, user_id, input_hash, created_at, expires_at, execution_context";
const approvalRowSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), user_id: z.string().uuid(), input_hash: z.string(),
  created_at: z.string(), expires_at: z.string(), execution_context: z.unknown(),
});

/** List one user's retained consent and recoverable results, without executing or renewing any approval. */
export async function loadHoldRecoveryPage(supabase: Pick<SupabaseClient, "from" | "rpc">, userId: string, workspaceId: string, offset: number, approvalId?: string) {
  let query = supabase.from("assistant_action_approvals").select(HOLD_RECOVERY_COLUMNS)
    .eq("workspace_id", workspaceId).eq("user_id", userId).eq("action_kind", "record_stage_gate_hold")
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  query = approvalId ? query.eq("id", approvalId) : query.range(offset, offset + HOLD_RECOVERY_PAGE_SIZE - 1);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new HoldReceiptError("Approved HOLD records could not be read. Try checking again.", 503);
  const rows = z.array(approvalRowSchema).safeParse(data);
  if (!rows.success || rows.data.some(row => row.workspace_id !== workspaceId || row.user_id !== userId)) {
    throw new HoldReceiptError("Approved HOLD records could not be verified.", 503);
  }
  const items = await Promise.all(rows.data.map(async (row): Promise<ApprovedHoldRecoveryEntry> => {
    const context = z.object({ action: assistantApprovalActionSchema, binding: z.object({ gateName: z.string() }) }).safeParse(row.execution_context);
    const base = { approvalId: row.id, inputHash: row.input_hash, approvedAt: row.created_at, expiresAt: row.expires_at };
    if (!context.success || context.data.action.kind !== "record_stage_gate_hold") {
      return { ...base, action: null, gateLabel: "Earlier HOLD approval", receipt: null, issue: "The exact approved request was not retained for recovery. Check the project and its activity record before approving more work." };
    }
    const action = context.data.action;
    if (action.workspaceId !== workspaceId || hashAssistantActionPayload(action) !== row.input_hash) {
      throw new HoldReceiptError("An approved HOLD request does not match its retained hash.", 503);
    }
    const receipt = await readHoldReceipt({ supabase, approvalId: row.id, inputHash: row.input_hash, userId, action });
    return { ...base, action, gateLabel: context.data.binding.gateName, receipt, issue: null };
  }));
  return { items, nextOffset: !approvalId && items.length === HOLD_RECOVERY_PAGE_SIZE ? offset + HOLD_RECOVERY_PAGE_SIZE : null };
}
