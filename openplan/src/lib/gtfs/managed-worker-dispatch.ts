import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { GtfsAttemptJournal, GtfsJournalPayload } from "./managed-worker-journal";
import { stageGtfsAttemptCommand, prepareGtfsArchiveCommand, confirmGtfsArchiveCommand,
  prepareGtfsOutputCommand, writeGtfsBatchCommand, computeGtfsTractsCommand,
  completeGtfsAttemptCommand, failGtfsAttemptCommand, adoptGtfsAttemptCommand,
  sendGtfsPreparedCommand, type GtfsWorkerService } from "./managed-worker-service";

type WithoutId<T> = Omit<T, "id">;
export type GtfsDurableMutation =
  | { operation: "stage"; input: Parameters<typeof stageGtfsAttemptCommand>[1] }
  | { operation: "prepare_archive"; input: Parameters<typeof prepareGtfsArchiveCommand>[1] }
  | { operation: "confirm_archive"; input: Parameters<typeof confirmGtfsArchiveCommand>[1] }
  | { operation: "prepare_output"; input: Parameters<typeof prepareGtfsOutputCommand>[1] }
  | { operation: "batch"; input: WithoutId<Parameters<typeof writeGtfsBatchCommand>[1]> }
  | { operation: "tracts"; input: WithoutId<Parameters<typeof computeGtfsTractsCommand>[1]> }
  | { operation: "complete"; input: WithoutId<Parameters<typeof completeGtfsAttemptCommand>[1]> }
  | { operation: "fail"; input: WithoutId<Parameters<typeof failGtfsAttemptCommand>[1]> }
  | { operation: "adopt"; input: WithoutId<Parameters<typeof adoptGtfsAttemptCommand>[1]> };
const id = z.string().uuid().transform(value => value.toLowerCase());
const contextSchema = z.object({ workspaceId: id, feedId: id, actorId: id }).strict();
export type GtfsWorkerContext = z.infer<typeof contextSchema>;

/** Deliver only the journal's exact command and attempt. A retained result is
 * rechecked by the same prepared verifier used for a fresh response. It grants
 * no live ownership; claim/read/renewal stay outside this completion cache.
 */
export async function deliverGtfsJournalCommand(journal: GtfsAttemptJournal, service: GtfsWorkerService,
  rawContext: GtfsWorkerContext, slot: string, rawMutation: GtfsDurableMutation) {
  const context = contextSchema.parse(rawContext), mutation = structuredClone(rawMutation);
  const scope = { ...context, versionId: id.parse(journal.identity.versionId), token: id.parse(journal.identity.token) };
  const prepare = (commandId: string) => {
    switch (mutation.operation) {
      case "stage": return stageGtfsAttemptCommand(scope, mutation.input);
      case "prepare_archive": return prepareGtfsArchiveCommand(scope, mutation.input);
      case "confirm_archive": return confirmGtfsArchiveCommand(scope, mutation.input);
      case "prepare_output": return prepareGtfsOutputCommand(scope, mutation.input);
      case "batch": return writeGtfsBatchCommand(scope, { ...mutation.input, id: commandId });
      case "tracts": return computeGtfsTractsCommand(scope, { ...mutation.input, id: commandId });
      case "complete": return completeGtfsAttemptCommand(scope, { ...mutation.input, id: commandId });
      case "fail": return failGtfsAttemptCommand(scope, { ...mutation.input, id: commandId });
      case "adopt": return adoptGtfsAttemptCommand(scope, { ...mutation.input, id: commandId });
      default: throw new Error("GTFS journal operation is unsupported");
    }
  };
  // Validate all request fields before allocating a durable command. The actual
  // identifier comes from the journal; no placeholder crosses the transport.
  prepare("00000000-0000-4000-8000-000000000000");
  const payload: GtfsJournalPayload = { operation: mutation.operation,
    arguments: z.record(z.string(), z.json()).parse({ context, input: mutation.input }) };
  return journal.deliver(slot, payload, {
    send: async (commandId, retained, signal) => {
      if (!isDeepStrictEqual(retained, payload)) throw new Error("GTFS journal dispatch payload differs");
      return sendGtfsPreparedCommand(service, prepare(commandId), signal);
    },
    verify: (raw, commandId) => prepare(commandId).verify(raw),
  });
}
