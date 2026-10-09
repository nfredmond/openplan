/** Native proof caller. Credentials arrive through stdin and are never written or printed. */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readAttemptInstruments, type AttemptInstrument } from "../../src/lib/models/attempt-instrument-read";
import { withCitedModelRunClaimTiers } from "../../src/lib/reports/run-citations";

type Input = {
  url: string; memberToken: string; outsiderToken: string; anonToken: string;
  workspaceId: string; records: AttemptInstrument[];
  runs: { id: string; run_title: string; engine_key: string; status: string }[];
  mode: "normal" | "harmless" | "page-loss" | "withdrawn";
};

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input: Input = JSON.parse(raw);
  const base = new URL(input.url);
  assert.equal(base.hostname, "127.0.0.1");
  const observedPages: number[] = [];
  function client(token: string, losePage = false) {
    return createClient(input.url, token, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (request, options) => {
        const url = new URL(String(request));
        assert.equal(url.origin, base.origin);
        assert.ok(url.pathname.startsWith("/rest/v1/"));
        // The isolated service is native PostgREST without the usual gateway prefix.
        url.pathname = url.pathname.replace(/^\/rest\/v1/, "");
        if (url.pathname === "/model_attempt_instrument_custody") {
          const offset = Number(url.searchParams.get("offset") ?? "0");
          observedPages.push(offset);
          if (losePage && offset > 0) return new Response('{"message":"injected later-page outage"}', { status: 503 });
        }
        return fetch(url, options);
      } },
    });
  }
  const runIds = input.runs.map(run => run.id);
  const member = client(input.memberToken, input.mode === "page-loss");
  const result = await readAttemptInstruments(member, runIds, input.workspaceId);
  if (input.mode === "withdrawn") {
    assert.deepEqual(result, { records: [], readFailed: false }, "removed membership still reads custody");
  } else if (input.mode === "page-loss") {
    assert.deepEqual(result, { records: [], readFailed: true }, "partial read presented as complete");
    const cited = await withCitedModelRunClaimTiers(member, input.runs);
    assert.ok(cited.every(run => run.attemptInstrumentCustodyReadFailed && run.attemptInstrumentCustody.length === 0), "report accepted incomplete evidence");
  } else {
    assert.equal(result.readFailed, false);
    assert.deepEqual(result.records, input.records, "member custody differs");
    assert.ok(observedPages.length > 2 && observedPages[1] === 2, "native two-row cap not exercised");
    const cited = await withCitedModelRunClaimTiers(member, input.runs);
    for (const run of cited) {
      assert.equal(run.attemptInstrumentCustodyReadFailed, false);
      assert.deepEqual(run.attemptInstrumentCustody, input.records.filter(row => row.model_run_id === run.id), "report custody differs");
    }
    const outsider = await readAttemptInstruments(client(input.outsiderToken), runIds, input.workspaceId);
    assert.deepEqual(outsider, { records: [], readFailed: false }, "other workspace read custody");
    const anonymous = await readAttemptInstruments(client(input.anonToken), runIds, input.workspaceId);
    assert.deepEqual(anonymous, { records: [], readFailed: true }, "anonymous custody read not refused");
  }
  console.log(JSON.stringify({ mode: input.mode, passed: true, nativePageOffsets: observedPages, expectedRecords: input.records.length }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "native read proof failed"); process.exitCode = 1; });
