import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AWARD_CLOSURE_HISTORY_LIMIT,
  AWARD_CLOSURE_RECEIPT_SELECT,
  readAwardClosureHistory,
} from "./award-closure-history";

/** Caller-authenticated only. Invoke after current project/member access validation. */
export async function loadAwardClosureHistory(client: SupabaseClient, scope: { awardId: string; workspaceId: string }) {
  const result = await client.from("funding_award_closure_receipts")
    .select(AWARD_CLOSURE_RECEIPT_SELECT, { count: "exact" })
    .eq("workspace_id", scope.workspaceId)
    .eq("award_id", scope.awardId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(AWARD_CLOSURE_HISTORY_LIMIT);
  if (result.error) return { history: null, error: result.error };
  if (!Array.isArray(result.data) || !Number.isSafeInteger(result.count) || result.count !== result.data.length || result.data.length > AWARD_CLOSURE_HISTORY_LIMIT) {
    return { history: null, error: null };
  }
  const history = readAwardClosureHistory({
    state: "available", ...scope, limit: AWARD_CLOSURE_HISTORY_LIMIT, receipts: result.data,
  }, scope.awardId);
  return { history, error: null };
}
