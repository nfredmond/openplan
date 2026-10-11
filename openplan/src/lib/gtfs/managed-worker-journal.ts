import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { open as openFile, lstat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { acquireConnectorLock, privateConnectorDirectory, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";

const id = z.string().uuid().transform(value => value.toLowerCase());
const identitySchema = z.object({ schemaVersion: z.literal(1), target: z.string(), installationId: id, versionId: id, token: id }).strict();
const payloadSchema = z.object({ operation: z.enum(["stage", "prepare_archive", "confirm_archive", "prepare_output", "batch", "tracts", "complete", "fail", "adopt"]),
  arguments: z.record(z.string(), z.json()) }).strict();
const commandSchema = z.object({ identity: identitySchema, slot: z.string(), commandId: id, payload: payloadSchema,
  resolved: z.boolean(), receipt: z.json() }).strict();
type Identity = z.infer<typeof identitySchema>;
export type GtfsJournalPayload = z.infer<typeof payloadSchema>;
type StoredCommand = z.infer<typeof commandSchema>;
export type GtfsJournalOptions = {
  directory: string; target: string; installationId: string; versionId: string;
  maxCommandBytes: number; signal: AbortSignal;
};
export type GtfsCommandDelivery<T> = {
  send: (commandId: string, payload: GtfsJournalPayload, signal: AbortSignal) => Promise<unknown>;
  verify: (receipt: unknown, commandId: string) => T;
};
export type GtfsAttemptJournal = {
  identity: Readonly<Identity>; signal: AbortSignal;
  inspect: (slot: string) => Promise<Pick<StoredCommand, "commandId" | "payload" | "resolved"> | null>;
  deliver: <T>(slot: string, payload: GtfsJournalPayload, delivery: GtfsCommandDelivery<T>) => Promise<{ commandId: string; receipt: T; retained: boolean }>;
};

function requireMatch(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

function checkedSlot(rawSlot: string) {
  return z.string().regex(/^[a-z][a-z0-9_-]{0,100}$/).parse(rawSlot);
}

function checkedCommand(raw: unknown, identity: Identity, slot: string) {
  const command = commandSchema.parse(raw);
  requireMatch(isDeepStrictEqual(command.identity, identity) && command.slot === slot,
    "GTFS journal command scope differs");
  requireMatch(command.resolved || command.receipt === null, "GTFS journal unresolved receipt is invalid");
  return command;
}

function targetIdentity(raw: string) {
  const url = new URL(raw);
  requireMatch(["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
    "GTFS journal target is invalid");
  return url.href.replace(/\/$/, "");
}

async function readExisting(path: string, maxBytes: number): Promise<unknown | undefined> {
  try { return await readPrivateJson(path, maxBytes); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** One directory owns one attempt, including its token before the first claim.
 * A retained receipt is history, never proof of current lease ownership. The
 * caller constructs its service for this target and installation and verifies
 * each receipt with the typed worker service rules. No secret belongs in payloads.
 */
export async function withGtfsAttemptJournal<T>(options: GtfsJournalOptions,
  run: (journal: GtfsAttemptJournal) => Promise<T>): Promise<T> {
  const { directory: rootDirectory, signal: callerSignal } = options;
  const scope = { target: targetIdentity(options.target), installationId: id.parse(options.installationId), versionId: id.parse(options.versionId) };
  const maxBytes = z.number().int().min(1024).max(2_147_483_647).parse(options.maxCommandBytes);
  callerSignal.throwIfAborted();
  const lock = await acquireConnectorLock(rootDirectory);
  const ending = new AbortController();
  const signal = AbortSignal.any([callerSignal, lock.signal, ending.signal]);
  let open = true;
  const active = new Set<Promise<unknown>>();
  const busy = new Set<string>();
  const check = () => {
    requireMatch(open, "GTFS journal session is closed");
    signal.throwIfAborted();
  };
  async function save(directory: string, value: unknown) {
    check();
    requireMatch(Buffer.byteLength(JSON.stringify(value)) <= maxBytes, "GTFS journal record exceeds configured bound");
    await writeConnectorJournal(directory, value);
    check();
  }
  try {
    check();
    const raw = await readExisting(join(rootDirectory, "pending.json"), maxBytes);
    let identity: Identity;
    if (raw === undefined) {
      identity = { schemaVersion: 1, ...scope, token: randomUUID() };
      await save(rootDirectory, identity);
    } else {
      identity = identitySchema.parse(raw);
      requireMatch(identity.target === scope.target && identity.installationId === scope.installationId && identity.versionId === scope.versionId,
        "GTFS journal attempt scope differs");
    }
    Object.freeze(identity);
    const inspect: GtfsAttemptJournal["inspect"] = rawSlot => {
      check();
      const slot = checkedSlot(rawSlot);
      requireMatch(!busy.has(slot), "GTFS journal inspection is busy");
      busy.add(slot);
      const reading = (async () => {
        const directory = join(rootDirectory, `command-${slot}`);
        let info;
        try { info = await lstat(directory); }
        catch (error) {
          check();
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
          throw error;
        }
        requireMatch(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0,
          "GTFS journal inspection directory is not private");
        const raw = await readExisting(join(directory, "pending.json"), maxBytes);
        check();
        if (raw === undefined) return null;
        const command = checkedCommand(raw, identity, slot);
        return structuredClone({ commandId: command.commandId, payload: command.payload, resolved: command.resolved });
      })();
      active.add(reading);
      void reading.finally(() => { busy.delete(slot); active.delete(reading); }).catch(() => {});
      return reading;
    };
    const deliver: GtfsAttemptJournal["deliver"] = (rawSlot, rawPayload, delivery) => {
      // Capture values before asynchronous file reads so caller edits cannot
      // change either the retained request or the eventual submitted arguments.
      check();
      const slot = checkedSlot(rawSlot);
      const payload = payloadSchema.parse(rawPayload);
      requireMatch(!busy.has(slot), "GTFS journal command is already running");
      busy.add(slot);
      const work = (async () => {
        const directory = join(rootDirectory, `command-${slot}`);
        await privateConnectorDirectory(directory);
        const parent = await openFile(rootDirectory, "r");
        try { await parent.sync(); } finally { await parent.close(); }
        const rawCommand = await readExisting(join(directory, "pending.json"), maxBytes);
        check();
        let command: StoredCommand;
        if (rawCommand === undefined) {
          command = { identity, slot, commandId: randomUUID(), payload, resolved: false, receipt: null };
          await save(directory, command);
        } else {
          command = checkedCommand(rawCommand, identity, slot);
          requireMatch(isDeepStrictEqual(command.payload, payload), "GTFS journal command payload changed");
        }
        check();
        if (command.resolved) {
          return { commandId: command.commandId, receipt: delivery.verify(structuredClone(command.receipt), command.commandId), retained: true };
        }
        const response = await delivery.send(command.commandId, structuredClone(command.payload), signal);
        check();
        // Preserve the exact JSON response. A verifier may return a transformed
        // view but cannot rewrite the retained server evidence.
        const receipt = z.json().parse(response);
        const verified = delivery.verify(structuredClone(receipt), command.commandId);
        await save(directory, { ...command, resolved: true, receipt });
        return { commandId: command.commandId, receipt: verified, retained: false };
      })();
      active.add(work);
      void work.finally(() => { busy.delete(slot); active.delete(work); }).catch(() => {});
      return work;
    };
    const result = await run({ identity, signal, deliver, inspect });
    requireMatch(active.size === 0, "GTFS journal callback must await deliveries");
    return result;
  } finally {
    // A callback cannot release its process lock while a delivery is still
    // settling. Reject later work and drain already-started commands first.
    open = false;
    ending.abort();
    await Promise.allSettled([...active]);
    await lock.release();
  }
}
