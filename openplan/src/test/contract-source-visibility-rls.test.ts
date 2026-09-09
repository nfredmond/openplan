import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

describe.skipIf(!LIVE_RLS)("contract source visibility across commits", () => {
  it("refuses late mutable and immutable sources while preserving fresh reports and exact retries", () => {
    const result = JSON.parse(execFileSync("python3", ["scripts/verification/m11-source-visibility.py", "--container", resolveLocalDbContainer()], { encoding: "utf8", timeout: 120_000 }));
    expect(result.cases.map((item: { conflict: boolean }) => item.conflict)).toEqual([false, true, true]);
    expect(result.privateReceipts).toBe(true);
  }, 130_000);
});
