import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assistantApprovalActionSchema, hashAssistantActionPayload } from "./action-approval-server";
import { HoldReceiptError } from "./stage-gate-hold-receipt";
import { executableProjectSubmittalAction, readSubmittalReceipt, type ProjectSubmittalAction, type SubmittalReceipt } from "./project-submittal-receipt";

export type ApprovedSubmittalRecoveryEntry = {
  approvalId: string; inputHash: string; approvedAt: string; expiresAt: string;
  action: ProjectSubmittalAction | null; projectName: string | null;
  receipt: SubmittalReceipt | null; issue: string | null;
};
const PAGE_SIZE = 20;
export const SUBMITTAL_RECOVERY_COLUMNS = "id, workspace_id, user_id, input_hash, created_at, expires_at, execution_context";
const approvalRowSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), user_id: z.string().uuid(), input_hash: z.string(),
  created_at: z.string(), expires_at: z.string(), execution_context: z.unknown(),
});

/** Read retained consent and original results; never infer an old project name from today's project row. */
export async function loadSubmittalRecoveryPage(supabase: Pick<SupabaseClient, "from" | "rpc">, userId: string, workspaceId: string, offset: number, approvalId?: string) {
  let query = supabase.from("assistant_action_approvals").select(SUBMITTAL_RECOVERY_COLUMNS)
    .eq("workspace_id", workspaceId).eq("user_id", userId).eq("action_kind", "create_project_record")
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  query = approvalId ? query.eq("id", approvalId) : query.range(offset, offset + PAGE_SIZE - 1);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new HoldReceiptError("Approved submittal records could not be read. Try checking again.", 503);
  const rows = z.array(approvalRowSchema).safeParse(data);
  if (!rows.success || rows.data.some(row => row.workspace_id !== workspaceId || row.user_id !== userId)) {
    throw new HoldReceiptError("Approved submittal records could not be verified.", 503);
  }
  const items = await Promise.all(rows.data.map(async (row): Promise<ApprovedSubmittalRecoveryEntry> => {
    const context = z.object({ version: z.literal(1), action: assistantApprovalActionSchema,
      project: z.object({ id: z.string().uuid(), workspaceId: z.string().uuid(), name: z.string().min(1) }),
    }).safeParse(row.execution_context);
    const base = { approvalId: row.id, inputHash: row.input_hash, approvedAt: row.created_at, expiresAt: row.expires_at };
    if (!context.success || context.data.action.kind !== "create_project_record") {
      return { ...base, action: null, projectName: null, receipt: null, issue: "The exact approved request was not retained for recovery. Check the project and its activity record before approving more work." };
    }
    const action = executableProjectSubmittalAction(context.data.action);
    if (context.data.project.workspaceId !== workspaceId || context.data.project.id !== action.projectId || hashAssistantActionPayload(action) !== row.input_hash) {
      throw new HoldReceiptError("An approved submittal request does not match its retained scope or hash.", 503);
    }
    const recovered = await readSubmittalReceipt({ supabase, approvalId: row.id, inputHash: row.input_hash, userId, action });
    if (recovered.workspaceId !== workspaceId) throw new HoldReceiptError("The original submittal workspace could not be verified.", 503);
    return { ...base, action, projectName: context.data.project.name, receipt: recovered.receipt, issue: null };
  }));
  return { items, nextOffset: !approvalId && items.length === PAGE_SIZE ? offset + PAGE_SIZE : null };
}
