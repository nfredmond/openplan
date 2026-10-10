import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { reapAbandonedGtfsIngests } from "../../../openplan/src/lib/gtfs/persist.ts";
const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const restUrl = process.env.OPENPLAN_PROOF_HTTP_URL!;
const storageUrl = process.env.OPENPLAN_PROOF_STORAGE_URL!;
let removals = 0;
const service = createClient(restUrl, process.env.OPENPLAN_PROOF_HTTP_TOKEN!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, new URL(restUrl).origin);
    if (url.pathname.startsWith("/storage/v1/")) {
      assert.equal(init?.method, "DELETE");
      removals++;
      const headers = new Headers(init.headers);
      headers.set("Authorization", "Bearer " + process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
      headers.set("apikey", process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
      return fetch(storageUrl + url.pathname.slice("/storage/v1".length), { ...init, headers });
    }
    assert.ok(url.pathname.startsWith("/rest/v1/"));
    url.pathname = url.pathname.slice("/rest/v1".length);
    return fetch(url, init);
  } },
});
const outcome = await reapAbandonedGtfsIngests(service);
console.log(JSON.stringify({ ...outcome, removals }));
