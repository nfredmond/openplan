import "server-only";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isWorkerExecutedRunMode } from "@/lib/models/run-modes";
import type { ModelRecoveryStatus } from "./recovery-status";

import { inspectRelaunchCustody } from "./relaunch-custody";

const recoverySchema = z.object({
  workspace_id: z.string().uuid(),
  run_id: z.string().uuid(),
  provenance: z.enum(["historical_unassessed", "new_run"]),
  enrolled_at: z.string().datetime({ offset: true }),
  observed_starts: z.number().int().nonnegative().safe(),
  last_start_observed_at: z.string().datetime({ offset: true }).nullable(),
}).strict().refine((row) => (row.observed_starts === 0) === (row.last_start_observed_at === null));

/** Call only after workspace/model authorization. This reader grants no execution lease. */
export async function loadModelRecoveryStatuses(
  workspaceId: string,
  runs: Array<{ id: string; engine_key?: string }>,
): Promise<Map<string, ModelRecoveryStatus>> {
  const result = new Map<string, ModelRecoveryStatus>();
  for (const run of runs) {
    if (!isWorkerExecutedRunMode(run.engine_key ?? "")) continue;
    result.set(run.id, { state: "unavailable" });
    try {
      const { data, error } = await createServiceRoleClient().rpc("inspect_model_recovery_status", {
        p_workspace: workspaceId,
        p_run: run.id,
      });
      if (error) continue;
      const parsed = recoverySchema.safeParse(data);
      if (!parsed.success || parsed.data.workspace_id !== workspaceId || parsed.data.run_id !== run.id) continue;
      result.set(run.id, {
        state: parsed.data.provenance,
        relaunchCustody: await inspectRelaunchCustody(workspaceId, run.id),
        enrolledAt: parsed.data.enrolled_at,
        observedStarts: parsed.data.observed_starts,
        lastStartObservedAt: parsed.data.last_start_observed_at,
      });
    } catch {
      // An unavailable read cannot establish that old work is safe to restart.
    }
  }
  return result;
}
