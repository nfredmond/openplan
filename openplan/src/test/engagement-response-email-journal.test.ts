// @vitest-environment node
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createResponseEmailJournal } from "@/lib/notifications/response-email-journal";
import type { ResponseEmailOutcome } from "@/lib/notifications/response-email-outcome";

const outcome: ResponseEmailOutcome = { outboxId: "10000000-0000-4000-8000-000000000001",
  attemptToken: "20000000-0000-4000-8000-000000000001", state: "accepted", transport: "synthetic", error: null };
const filename = `${outcome.outboxId}-${outcome.attemptToken}`;

describe("response email outcome journal", () => {
  it("recovers an exact retained result in a new journal instance and archives only an acknowledged outcome", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openplan-email-journal-"));
    const original = await createResponseEmailJournal(directory);
    await original.retain(outcome);
    expect(JSON.parse(await readFile(join(directory, `${filename}.pending.json`), "utf8"))).toEqual(outcome);
    expect((await stat(join(directory, `${filename}.pending.json`))).mode & 0o777).toBe(0o600);
    const resumed = await createResponseEmailJournal(directory);
    const unavailable = vi.fn().mockResolvedValue(false);
    expect(await resumed.recover(unavailable)).toEqual({ unreadable: 0, pending: 1 });
    expect(unavailable).toHaveBeenCalledExactlyOnceWith(outcome);
    expect(await readdir(directory)).toEqual([`${filename}.pending.json`]);
    const acknowledged = vi.fn().mockResolvedValue(true);
    expect(await resumed.recover(acknowledged)).toEqual({ unreadable: 0, pending: 0 });
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith(outcome);
    expect(await readdir(directory)).toEqual([`${filename}.recorded.json`]);
    acknowledged.mockClear();
    await resumed.recover(acknowledged);
    expect(acknowledged).not.toHaveBeenCalled();
  });
  it("retains malformed and mismatched files without acknowledging invented results", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openplan-email-journal-"));
    const journal = await createResponseEmailJournal(directory);
    await writeFile(join(directory, "broken.pending.json"), "not-json", { mode: 0o600 });
    await writeFile(join(directory, "wrong-identity.pending.json"), JSON.stringify(outcome), { mode: 0o600 });
    const finish = vi.fn().mockResolvedValue(true);
    expect(await journal.recover(finish)).toEqual({ unreadable: 2, pending: 0 });
    expect(finish).not.toHaveBeenCalled();
    expect((await readdir(directory)).sort()).toEqual(["broken.pending.json", "wrong-identity.pending.json"]);
  });
});
