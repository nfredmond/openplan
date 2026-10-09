import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ResolvedGtfsLimits } from "./limits";

const receiptSchema = z.object({
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  parsed: z.boolean(),
}).strict();

type StopReason = "cancelled" | "ownership_unconfirmed" | "timed_out" | "child_failed";
type ParseOutcome =
  | { ok: true; receipt: z.infer<typeof receiptSchema> }
  | { ok: false; reason: StopReason };

export type GtfsParseProcessOptions = {
  archive: FileHandle;
  output: FileHandle;
  byteSize: number;
  checksumSha256: string;
  limits: ResolvedGtfsLimits;
  maxOutputBytes: number;
  maxOldSpaceMb: number;
  renewEveryMs: number;
  renewTimeoutMs: number;
  maxRuntimeMs: number;
  terminationGraceMs: number;
  signal: AbortSignal;
  renew: (signal: AbortSignal) => Promise<boolean>;
};

/**
 * Keep lease renewal outside the parser's CPU process. The caller retains both
 * descriptors and any partial output. A receipt is local parsing evidence only;
 * database publication must still check the attempt in the same transaction.
 */
export async function superviseGtfsParse(options: GtfsParseProcessOptions): Promise<ParseOutcome> {
  const durations = [options.renewEveryMs, options.renewTimeoutMs, options.maxRuntimeMs,
    options.terminationGraceMs];
  if (durations.some(value => !Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
    || !Number.isSafeInteger(options.maxOldSpaceMb) || options.maxOldSpaceMb < 64
    || !Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0
    || !Number.isSafeInteger(options.byteSize) || options.byteSize <= 0
    || options.byteSize > options.limits.maxArchiveBytes
    || !/^[0-9a-f]{64}$/.test(options.checksumSha256)) {
    throw new Error("Invalid GTFS parse process limits or archive identity");
  }
  if (options.signal.aborted) return { ok: false, reason: "cancelled" };

  const stopping = new AbortController();
  let reason: StopReason | undefined;
  let killChild: (() => void) | undefined;
  const stop = (why: StopReason) => {
    reason ??= why;
    stopping.abort();
    killChild?.();
  };
  const cancel = () => stop("cancelled");
  options.signal.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(() => stop("timed_out"), options.maxRuntimeMs);
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<boolean> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let childClosed: Promise<number | null> | undefined;
  let childExited = false;

  // Bound even a transport that does not settle after its signal is aborted.
  const renew = () => new Promise<boolean>(resolve => {
    const request = new AbortController();
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopping.signal.removeEventListener("abort", aborted);
      request.abort();
      resolve(confirmed);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(() => finish(false), options.renewTimeoutMs);
    stopping.signal.addEventListener("abort", aborted, { once: true });
    if (stopping.signal.aborted) return finish(false);
    Promise.resolve().then(() => options.renew(request.signal)).then(
      confirmed => finish(confirmed === true), () => finish(false),
    );
  });

  try {
    if (!(await renew())) return { ok: false, reason: reason ?? "ownership_unconfirmed" };
    if (reason) return { ok: false, reason };
    const child = fork(fileURLToPath(new URL("../../../scripts/workers/gtfs-parse-child.mts", import.meta.url)), [], {
      execArgv: ["--import", "tsx", `--max-old-space-size=${options.maxOldSpaceMb}`],
      // The parser receives bytes through descriptors, with no database or
      // provider credentials. Its stderr cannot accidentally dump source rows.
      env: { NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "ignore", "ipc", options.archive.fd, options.output.fd],
    });
    let receipt: z.infer<typeof receiptSchema> | undefined;
    const closed = new Promise<number | null>(resolve => {
      child.once("close", code => { childExited = true; resolve(code); });
      child.once("error", () => stop("child_failed"));
      child.on("message", message => {
        const parsed = receiptSchema.safeParse(message);
        if (receipt || !parsed.success || parsed.data.byteSize > options.maxOutputBytes) {
          stop("child_failed");
        } else receipt = parsed.data;
      });
    });
    childClosed = closed;
    killChild = () => {
      if (childExited || killTimer) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => { if (!childExited) child.kill("SIGKILL"); }, options.terminationGraceMs);
    };
    const scheduleRenewal = () => {
      if (stopping.signal.aborted) return;
      renewalTimer = setTimeout(() => {
        renewal = renew().then(confirmed => {
          if (!confirmed) stop("ownership_unconfirmed");
          else scheduleRenewal();
          return confirmed;
        });
      }, options.renewEveryMs);
    };
    scheduleRenewal();
    child.send({ byteSize: options.byteSize, checksumSha256: options.checksumSha256,
      limits: options.limits, maxOutputBytes: options.maxOutputBytes }, error => {
      if (error) stop("child_failed");
    });
    if (reason) killChild();
    const exitCode = await closed;
    if (reason) return { ok: false, reason };
    if (exitCode !== 0 || !receipt) return { ok: false, reason: "child_failed" };

    // Check the actual retained bytes, not just a child-reported success.
    const stat = await options.output.stat();
    if (!stat.isFile() || stat.size !== receipt.byteSize) return { ok: false, reason: "child_failed" };
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < stat.size;) {
      if (reason) return { ok: false, reason };
      const { bytesRead } = await options.output.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (bytesRead === 0) return { ok: false, reason: "child_failed" };
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (hash.digest("hex") !== receipt.sha256) return { ok: false, reason: "child_failed" };
    clearTimeout(renewalTimer);
    if (renewal) await renewal;
    // A pending renewal may have scheduled another timer before it settled.
    clearTimeout(renewalTimer);
    if (reason || !(await renew())) return { ok: false, reason: reason ?? "ownership_unconfirmed" };
    return { ok: true, receipt };
  } catch {
    stop("child_failed");
    return { ok: false, reason: reason ?? "child_failed" };
  } finally {
    if (childClosed && !childExited) {
      stop(reason ?? "child_failed");
      await childClosed;
    }
    clearTimeout(deadline);
    clearTimeout(renewalTimer);
    clearTimeout(killTimer);
    stopping.abort();
    options.signal.removeEventListener("abort", cancel);
  }
}
