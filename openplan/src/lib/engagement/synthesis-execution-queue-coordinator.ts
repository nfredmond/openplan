import { ProviderApiTransportError } from "@/lib/assistant/provider-api-transport";
import { join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { synthesisExecutionQueueReceiptSchema, verifySynthesisExecutionQueueReceipt } from "./synthesis-execution-queue-records";
import { readSynthesisExecutionQueuePage } from "./synthesis-execution-queue-reader";
import { runQueuedSynthesisSchedule } from "./synthesis-execution-queue-driver";

const schema = z.object({ version: z.literal(1), target: z.string(), root: z.string(),
  after: z.string().uuid().nullable(), pending: z.array(synthesisExecutionQueueReceiptSchema).max(32) }).strict();
const JOURNAL_BYTES = 512 * 1024;

/** Process at most one retained page per pass. Save discovery before scheduling,
 * then save progress after each scheduler returns or refuses. Unavailable work
 * is revisited on the next queue traversal using the same authorization journals.
 * Interruption preserves the pending entry; no timeout creates a new identity.
 */
export async function runSynthesisExecutionQueuePass(args: {
  service: Pick<SupabaseClient, "from" | "rpc">; target: string; root: string; directory: string; signal: AbortSignal;
}) {
  const target = providerApiWorkerTarget(args.target), root = resolve(args.root);
  args.signal.throwIfAborted();
  const lock = await acquireConnectorLock(args.directory), signal = AbortSignal.any([args.signal, lock.signal]);
  try {
    async function checked(raw: unknown) {
      const state = schema.parse(raw);
      if (state.target !== target || state.root !== root) throw new Error("Execution coordinator identity differs");
      let previous = "";
      for (const receipt of state.pending) {
        await verifySynthesisExecutionQueueReceipt(receipt, receipt.commandText);
        if (receipt.queueId <= previous) throw new Error("Execution coordinator order differs");
        previous = receipt.queueId;
      }
      if (state.pending.length && previous !== state.after) throw new Error("Execution coordinator cursor differs");
      return state;
    }
    let state: z.infer<typeof schema>;
    try { state = await checked(await readPrivateJson(join(args.directory, "pending.json"), JOURNAL_BYTES)); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      state = { version: 1, target, root, after: null, pending: [] };
    }
    async function save() {
      signal.throwIfAborted(); await checked(state);
      if (Buffer.byteLength(JSON.stringify(state), "utf8") > JOURNAL_BYTES) throw new Error("Execution coordinator journal too large");
      await writeConnectorJournal(args.directory, state); signal.throwIfAborted();
    }
    await save();
    if (!state.pending.length) {
      const page = await readSynthesisExecutionQueuePage(args.service, state.after, signal);
      state.pending = page.entries.map(entry => entry.receipt); state.after = page.nextCursor;
      await save();
    }
    const outcomes: Array<{ queueId: string; state: "schedule_returned" | "unconfirmed"; reason?: "endpoint_policy" }> = [];
    while (state.pending.length) {
      signal.throwIfAborted();
      const receipt = state.pending[0];
      let status: "schedule_returned" | "unconfirmed" = "unconfirmed";
      let reason: "endpoint_policy" | undefined;
      try {
        await runQueuedSynthesisSchedule({ service: args.service, target, root, receipt, commandText: receipt.commandText, signal });
        signal.throwIfAborted(); status = "schedule_returned";
      } catch (error) {
        signal.throwIfAborted();
        // Expose only known operator configuration failures, never arbitrary
        // provider messages, URLs, credentials or participant material.
        if (error instanceof ProviderApiTransportError &&
          ["api_endpoint_denied", "api_endpoint_policy_invalid"].includes(error.code)) reason = "endpoint_policy";
      }
      state.pending.shift();
      await save();
      outcomes.push({ queueId: receipt.queueId, state: status, ...(reason ? { reason } : {}) });
    }
    return { outcomes, queueWrapped: state.after === null };
  } finally { await lock.release(); }
}
