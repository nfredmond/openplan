import 'server-only';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveModelingWorkerDeclaration } from '@/lib/config/deployment-health-facts';
import { loadModelingWorkerHealth } from '@/lib/models/worker-health-server';
import { evaluateWorkerHealthLaunchGate } from '@/lib/models/worker-health';
import { checkMonthlyRunCap, isRunCapExceeded, isRunCapLookupError, RUN_WEIGHTS } from '@/lib/config/run-cap';
import { buildModelRunDispatchPayload, dispatchModelRun, workerRunStageNames, checkModelingQueueDepth, isQueueDepthExceeded, isQueueDepthLookupError } from './run-dispatch';

/** New creation uses normal worker gates without regenerating remote inputs. */
export async function replacementPreflight(engineKey: string, workspaceId: string) {
  if (process.env.OPENPLAN_HOSTED_ARTIFACT_MIRROR === '1') return { message: 'Hosted population snapshot transport is unsupported; it remains a full-v1 obligation.', status: 501 };
  if (!['aequilibrae', 'behavioral_demand'].includes(engineKey)) return { message: 'Unsupported replacement engine', status: 409 };
  const service = createServiceRoleClient();
  // This is the existing optional operator compute policy, unlimited by default.
  // The route recovers exact committed receipts before calling this preflight.
  const cap = await checkMonthlyRunCap(service, { workspaceId, tableName: 'model_runs', weight: RUN_WEIGHTS.MODEL_RUN_LAUNCH });
  if (isRunCapLookupError(cap)) return { message: 'Failed to validate the run limit', status: 500 };
  if (isRunCapExceeded(cap)) return { message: cap.message, status: 429 };
  const health = await loadModelingWorkerHealth(resolveModelingWorkerDeclaration());
  const gate = evaluateWorkerHealthLaunchGate(engineKey, health);
  if (gate.blocked) return { message: gate.reason ?? 'Required worker health is unavailable', status: 503 };
  const depth = await checkModelingQueueDepth(service, { workspaceId });
  if (isQueueDepthLookupError(depth)) return { message: 'Worker queue capacity could not be read', status: 503 };
  if (isQueueDepthExceeded(depth)) return { message: 'The installation worker queue is at capacity', status: 503 };
  return null;
}

export async function dispatchPopulationReplacement(requestId: string, runId: string, engineKey: string) {
  return dispatchModelRun(buildModelRunDispatchPayload({ requestId, runId, engineKey,
    stageNames: [...workerRunStageNames(engineKey)] }));
}
