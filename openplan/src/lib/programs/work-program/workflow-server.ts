import "server-only";
import { createServiceRoleClient, type createClient } from "@/lib/supabase/server";
import { loadWorkspaceRoster, type RosterServiceClient } from "@/lib/workspaces/roster";
import { emptyWorkflow, type WorkflowData, type WorkflowEvent, type WorkflowAssignment } from "./workflow";

export async function loadWorkProgramWorkflow(supabase: Awaited<ReturnType<typeof createClient>>, programId: string, workspaceId: string, userId: string): Promise<WorkflowData> {
  const state = await supabase.from("program_work_program_workflow").select("sequence, effective_revision_id, submission_revision_id, submission_id, status").eq("program_id", programId).maybeSingle();
  if (state.error) throw new Error("Review state unavailable");
  const captured = state.data ?? emptyWorkflow;
  const events: WorkflowEvent[] = [], assignments: WorkflowAssignment[] = [], members: WorkflowData["members"] = [];
  for (let offset = 0; ; offset += 100) {
    const rows = await supabase.from("program_work_program_events").select("id, sequence, revision_id, revision_hash, kind, actor_id, created_at, payload, evidence").eq("program_id", programId).lte("sequence", captured.sequence).order("sequence").range(offset, offset + 99);
    if (rows.error) throw new Error("Review history unavailable");
    events.push(...(rows.data ?? []) as WorkflowEvent[]);
    if ((rows.data?.length ?? 0) < 100) break;
  }
  if (captured.submission_id) {
    const rows = await supabase.from("program_work_program_reviews").select("id, revision_id, submission_id, assignee_user_id, due_on, status").eq("submission_id", captured.submission_id);
    if (rows.error) throw new Error("Review assignments unavailable");
    assignments.push(...(rows.data ?? []) as WorkflowAssignment[]);
  }
  const roster = await loadWorkspaceRoster(createServiceRoleClient() as unknown as RosterServiceClient, userId, workspaceId);
  if (!roster.ok) throw new Error("Reviewer membership unavailable");
  members.push(...roster.members.filter(row => ["owner", "admin", "member"].includes(row.role)).map(row => ({ id: row.userId, label: row.email ?? row.userId })));
  return { state: captured, events, assignments, members };
}
