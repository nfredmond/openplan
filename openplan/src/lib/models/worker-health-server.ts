import type { ModelingWorkerDeclaration } from "@/lib/config/deployment-health";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  reduceModelingWorkerHealth,
  type ModelingWorkerHealth,
  type ModelingWorkerHeartbeatRow,
} from "./worker-health";

export async function loadModelingWorkerHealth(
  declaration: ModelingWorkerDeclaration,
  now = Date.now()
): Promise<ModelingWorkerHealth> {
  try {
    const { data, error } = await createServiceRoleClient()
      .from("modeling_worker_heartbeats")
      .select("worker_kind,instance_id,supported_stages,runtime_mode,worker_version,current_work,started_at,last_successful_heartbeat_at");
    if (error) {
      return reduceModelingWorkerHealth({ rows: [], now, declaration, schemaAvailable: false });
    }
    return reduceModelingWorkerHealth({
      rows: (data ?? []) as ModelingWorkerHeartbeatRow[],
      now,
      declaration,
    });
  } catch {
    return reduceModelingWorkerHealth({ rows: [], now, declaration, schemaAvailable: false });
  }
}
