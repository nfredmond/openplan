import { describe, expect, it } from "vitest";
import { readAttemptInstruments } from "@/lib/models/attempt-instrument-read";
import { attemptInstrumentFixture } from "./fixtures/attempt-instruments";

function fixture(failure = false) {
  const records = Array.from({ length: 7 }, (_, i) => attemptInstrumentFixture("run-1", "workspace-1", i));
  const calls: { projection: string; filters: [string, unknown][]; orders: string[]; from: number }[] = [];
  const client = { from(table: string) {
    expect(table).toBe("model_attempt_instrument_custody");
    const call = { projection: "", filters: [] as [string, unknown][], orders: [] as string[], from: 0 };
    calls.push(call);
    const query = {
      select(columns: string) { call.projection = columns; return query; },
      in(column: string, values: string[]) { call.filters.push([column, values]); return query; },
      eq(column: string, value: string) { call.filters.push([column, value]); return query; },
      order(column: string) { call.orders.push(column); return query; },
      range(from: number) { call.from = from; return query; },
      then(resolve: (result: unknown) => unknown) {
        if (failure && call.from > 0) return Promise.resolve(resolve({ data: null, error: { message: "page outage" } }));
        const data = records.slice(call.from, call.from + 2).map(row => Object.fromEntries(call.projection.split(", ").map(key => [key, row[key as keyof typeof row]])));
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return query;
  } };
  return { client, calls, records };
}

describe("attempt instrument complete reads", () => {
  it("retains every method and attempt under a two-row cap with exact scope and identity", async () => {
    const { client, calls, records } = fixture();
    expect(await readAttemptInstruments(client, ["run-1"], "workspace-1")).toEqual({ records, readFailed: false });
    expect(calls.map(call => call.from)).toEqual([0, 2, 4, 6, 7]);
    for (const call of calls) {
      expect(call.orders).toEqual(["created_at", "id"]);
      expect(call.filters).toEqual([["model_run_id", ["run-1"]], ["workspace_id", "workspace-1"]]);
      expect(call.projection.split(", ").sort()).toEqual(Object.keys(records[0]).sort());
    }
  });
  it("discards the prefix on a later-page error", async () => {
    expect(await readAttemptInstruments(fixture(true).client, ["run-1"])).toEqual({ records: [], readFailed: true });
  });
  it("distinguishes unavailable clients from a successful empty scope", async () => {
    expect(await readAttemptInstruments({}, ["run-1"])).toEqual({ records: [], readFailed: true });
    expect(await readAttemptInstruments({}, [])).toEqual({ records: [], readFailed: false });
  });
});
