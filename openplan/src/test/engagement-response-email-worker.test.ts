import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { finishResponseEmail, processResponseEmail } from "@/lib/notifications/engagement";
import type { ResponseEmailOutcome } from "@/lib/notifications/response-email-outcome";

const outboxId = "10000000-0000-4000-8000-000000000001";
const message = { to: "recipient@example.invalid", subject: "Reviewed update", text: "Retained answer\nUnsubscribe: http://localhost:3256/opt-out" };
const messageText = JSON.stringify(message, null, 1);
const checksum = createHash("sha256").update(messageText).digest("hex");
function setup(options: { preparationError?: boolean; claimError?: boolean; claim?: Record<string, unknown> | null; finishError?: boolean } = {}) {
  const events: string[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    events.push(name);
    if (name === "prepare_engagement_response_broadcast") return { data: null, error: options.preparationError ? { message: "unavailable" } : null };
    if (name === "claim_engagement_response_email") return { error: options.claimError ? { message: "unavailable" } : null,
      data: options.claim === null ? null : { outboxId, state: "attempting", attemptToken: args.p_attempt,
        messageText, contentSha256: checksum, ...options.claim } };
    if (name === "finish_engagement_response_email") return { data: !options.finishError, error: options.finishError ? { message: "acknowledgement lost" } : null };
    throw new Error("Unexpected RPC");
  });
  const transport = vi.fn(async () => { events.push("transport"); return { delivered: true, transport: "synthetic" }; });
  const journal = {
    retain: vi.fn(async (_outcome: ResponseEmailOutcome) => { events.push("journal-retained"); }),
    recorded: vi.fn(async (_outcome: ResponseEmailOutcome) => { events.push("journal-recorded"); }),
  };
  return { rpc, transport, journal, events };
}

describe("retained response email worker", () => {
  it("requires the retained claim and exact checksum before transport, then journals before acknowledgement", async () => {
    const test = setup();
    expect(await processResponseEmail({ rpc: test.rpc } as never, "http://localhost:3256", test.journal, test.transport)).toBe("progress");
    expect(test.events).toEqual(["prepare_engagement_response_broadcast", "claim_engagement_response_email", "transport",
      "journal-retained", "finish_engagement_response_email", "journal-recorded"]);
    expect(test.transport).toHaveBeenCalledExactlyOnceWith(message);
    expect(test.journal.retain).toHaveBeenCalledWith(expect.objectContaining({ outboxId, state: "accepted", transport: "synthetic", error: null }));
  });
  it.each([
    { preparationError: true }, { claimError: true }, { claim: { attemptToken: outboxId } },
    { claim: { contentSha256: "a".repeat(64) } }, { claim: { state: "missing" } },
    { claim: { messageText: "not-json", contentSha256: createHash("sha256").update("not-json").digest("hex") } },
  ])("does not contact transport when preparation or a retained claim cannot be verified", async options => {
    const test = setup(options);
    expect(await processResponseEmail({ rpc: test.rpc } as never, "http://localhost:3256", test.journal, test.transport)).toBe("unavailable");
    expect(test.transport).not.toHaveBeenCalled();
    expect(test.journal.retain).not.toHaveBeenCalled();
  });
  it("keeps an empty queue and a cancelled message distinct from failure", async () => {
    for (const [claim, expected] of [[null, "idle"], [{ state: "cancelled" }, "progress"]] as const) {
      const test = setup({ claim });
      expect(await processResponseEmail({ rpc: test.rpc } as never, "http://localhost:3256", test.journal, test.transport)).toBe(expected);
      expect(test.transport).not.toHaveBeenCalled();
    }
  });
  it("retries only the outcome after acknowledgement fails, without sending again", async () => {
    const test = setup({ finishError: true });
    expect(await processResponseEmail({ rpc: test.rpc } as never, "http://localhost:3256", test.journal, test.transport)).toBe("unavailable");
    expect(test.journal.recorded).not.toHaveBeenCalled();
    const outcome = test.journal.retain.mock.calls[0][0];
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await finishResponseEmail({ rpc } as never, outcome)).toBe(true);
    expect(await finishResponseEmail({ rpc } as never, outcome)).toBe(true);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(test.transport).toHaveBeenCalledTimes(1);
  });
  it("records no configured provider as skipped and an ambiguous provider error as uncertain", async () => {
    for (const [result, state] of [
      [{ delivered: false, transport: "none", reason: "not_configured" }, "skipped"],
      [{ delivered: false, transport: "synthetic", error: "HTTP result unavailable" }, "uncertain"],
    ] as const) {
      const test = setup();
      const transport = vi.fn().mockResolvedValue(result);
      expect(await processResponseEmail({ rpc: test.rpc } as never, "http://localhost:3256", test.journal, transport)).toBe("progress");
      expect(test.journal.retain.mock.calls[0][0].state).toBe(state);
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it("does not replace a failed journal write with a successful acknowledgement", async () => {
    const test = setup();
    test.journal.retain.mockRejectedValueOnce(new Error("local disk unavailable"));
    expect(await processResponseEmail({ rpc: test.rpc } as never, "http://localhost:3256", test.journal, test.transport)).toBe("unavailable");
    expect(test.rpc.mock.calls.some(([name]) => name === "finish_engagement_response_email")).toBe(false);
    expect(test.journal.recorded).not.toHaveBeenCalled();
  });
  it("refuses a caller URL with path or credentials before reading sensitive messages", async () => {
    for (const origin of ["http://localhost:3256/path", "http://person:secret@localhost:3256", "file:///tmp/mail"]) {
      const test = setup();
      expect(await processResponseEmail({ rpc: test.rpc } as never, origin, test.journal, test.transport)).toBe("unavailable");
      expect(test.rpc).not.toHaveBeenCalled();
      expect(test.transport).not.toHaveBeenCalled();
    }
  });
});
