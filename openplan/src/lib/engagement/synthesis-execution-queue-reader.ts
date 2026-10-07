import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisExecutionQueueReceipt } from "./synthesis-execution-queue-records";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid();
const rowSchema = z.object({ id, request_id: id, authorization_id: id,
  stage: z.enum(["segment", "context", "thematic"]), command_text: z.string().max(4096),
  command_sha256: z.string().regex(/^[a-f0-9]{64}$/), created_at: z.iso.datetime({ offset: true }),
}).strict();
const projection = "id,request_id,authorization_id,stage,command_text,command_sha256,created_at";

/** Read one bounded page of explicit scheduling commands, never old allowances.
 * UUID ordering avoids timestamp precision loss. The coordinator must wrap after
 * an empty page so later inserts behind the cursor are included in the next pass.
 * Verified custody is not current dispatch permission or a worker claim.
 */
export async function readSynthesisExecutionQueuePage(service: Pick<SupabaseClient, "from">,
  after: string | null, signal: AbortSignal) {
  signal.throwIfAborted();
  const cursor = after === null ? null : id.parse(after).toLowerCase();
  let query = service.from("engagement_synthesis_execution_queue").select(projection)
    .order("id", { ascending: true }).limit(32);
  if (cursor !== null) query = query.gt("id", cursor);
  const bounded = synthesisWorkerRequestSignal(signal);
  const response = await query.abortSignal(bounded);
  bounded.throwIfAborted();
  if (response.error) throw new Error("Synthesis execution queue unavailable");
  const rows = z.array(rowSchema).max(32).parse(response.data);
  const entries = [];
  let previous = cursor;
  for (const row of rows) {
    if (previous !== null && row.id.toLowerCase() <= previous) throw new Error("Synthesis queue order differs");
    const verified = await verifySynthesisExecutionQueueReceipt({ schemaVersion: 1, queueId: row.id,
      commandText: row.command_text, commandSha256: row.command_sha256, createdAt: row.created_at }, row.command_text);
    if (verified.command.requestId !== row.request_id || verified.command.authorizationId !== row.authorization_id ||
      verified.command.stage !== row.stage) throw new Error("Synthesis queue identity differs");
    entries.push(verified);
    previous = row.id.toLowerCase();
  }
  bounded.throwIfAborted();
  return { entries, nextCursor: rows.length ? previous : null };
}
