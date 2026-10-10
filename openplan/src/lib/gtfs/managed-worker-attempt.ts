import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { withGtfsAttemptJournal, type GtfsJournalOptions } from "./managed-worker-journal";
import { deliverGtfsJournalCommand, type GtfsDurableMutation } from "./managed-worker-dispatch";
import { claimGtfsAttempt, readGtfsAttempt, renewGtfsAttempt, type GtfsAttemptSnapshot, type GtfsWorkerService } from "./managed-worker-service";

type TerminalMutation = Extract<GtfsDurableMutation, { operation: "complete" | "fail" }>;
type WorkMutation = Exclude<GtfsDurableMutation, { operation: "complete" | "fail" | "adopt" }>;
export type GtfsOwnedWork = {
  snapshot: GtfsAttemptSnapshot;
  signal: AbortSignal;
  deliver: (slot: string, command: WorkMutation) => ReturnType<typeof deliverGtfsJournalCommand>;
};

/** Retain a claim token, confirm live ownership, and renew outside the parser's
 * process. The work callback reconstructs its original artifacts and returns an
 * explicit terminal command. Exceptions and unknown replies never become an
 * invented failure command. Terminal observations are history, not new work.
 */
export async function runGtfsOwnedAttempt(options: GtfsJournalOptions & {
  service: GtfsWorkerService;
  renewEveryMs?: number;
  work: (owned: GtfsOwnedWork) => Promise<TerminalMutation>;
}) {
  // Native claim/renew calls use their 120-second default; each RPC has a
  // ten-second acknowledgement bound. Keep renewal intervals below one minute.
  const renewEveryMs = z.number().int().min(1).max(60_000).parse(options.renewEveryMs ?? 30_000);
  const service = options.service, work = options.work;
  const lost = new AbortController();
  const signal = AbortSignal.any([options.signal, lost.signal]);
  return withGtfsAttemptJournal({ ...options, signal }, async journal => {
    const scope = { versionId: journal.identity.versionId, token: journal.identity.token };
    const claim = await claimGtfsAttempt(service, scope, signal);
    if (!claim) return { state: "unavailable" as const };
    const snapshot = await readGtfsAttempt(service, scope, signal);
    if (!isDeepStrictEqual(snapshot.claim, claim.claim)) throw new Error("GTFS live claim receipt changed");
    if (["ready", "failed", "cancelled"].includes(snapshot.state)) {
      return { state: "observed_terminal" as const, snapshot };
    }
    if (!claim.active || !snapshot.active) return { state: "not_active" as const, snapshot };
    const context = { workspaceId: snapshot.workspaceId, feedId: snapshot.feedId, actorId: snapshot.actorId };
    const renew = async () => {
      try {
        if (!await renewGtfsAttempt(service, scope, signal)) throw new Error("GTFS attempt ownership is unconfirmed");
      } catch (error) {
        lost.abort(error);
        throw error;
      }
    };
    // A recovered claim can be close to expiry. Do not begin work on the age
    // or active flag of its saved claim; extend it through the live service.
    await renew();
    signal.throwIfAborted();
    const stopTimer = new AbortController();
    const timerSignal = AbortSignal.any([signal, stopTimer.signal]);
    let processing = true;
    const pendingWrites = new Set<Promise<unknown>>();
    const heartbeat = (async () => {
      while (!timerSignal.aborted) {
        try { await delay(renewEveryMs, undefined, { signal: timerSignal }); }
        catch { break; }
        if (timerSignal.aborted) break;
        try { await renew(); }
        catch { break; }
      }
    })();
    try {
      const terminal = structuredClone(await work({ snapshot: structuredClone(snapshot), signal,
        deliver: async (slot, command) => {
          signal.throwIfAborted();
          if (!processing) throw new Error("GTFS work phase is closed");
          if (slot === "terminal" || ["complete", "fail", "adopt"].includes(command.operation)) {
            throw new Error("GTFS work cannot bypass terminal coordination");
          }
          const pending = deliverGtfsJournalCommand(journal, service, context, slot, command);
          pendingWrites.add(pending);
          void pending.finally(() => pendingWrites.delete(pending)).catch(() => {});
          return pending;
        },
      }));
      processing = false;
      if (pendingWrites.size !== 0) throw new Error("GTFS work has unsettled commands");
      stopTimer.abort();
      // Join any renewal already in flight before it can race a terminal write.
      await heartbeat;
      signal.throwIfAborted();
      if (!terminal || !["complete", "fail"].includes(terminal.operation)) throw new Error("GTFS terminal outcome is invalid");
      await renew();
      const result = await deliverGtfsJournalCommand(journal, service, context, "terminal", terminal);
      return { state: "finished" as const, operation: terminal.operation, result };
    } finally {
      processing = false;
      stopTimer.abort();
      lost.abort();
      await heartbeat;
    }
  });
}
