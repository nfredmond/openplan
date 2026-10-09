import assert from "node:assert/strict";
import { createRequire } from "node:module";
const app = process.cwd();
const require = createRequire(app + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("../../../openplan/node_modules/@supabase/supabase-js");
const { reapAbandonedGtfsIngests } = await import(app + "/src/lib/gtfs/persist.ts");
const url = process.env.OPENPLAN_PROOF_HTTP_URL!;
const token = process.env.OPENPLAN_PROOF_HTTP_TOKEN!;
const schema = process.env.OPENPLAN_PROOF_HTTP_SCHEMA!;
let storageAttempts = 0;
const client = createClient(url, token, {
  db: { schema }, auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const target = new URL(String(input));
    if (target.pathname.startsWith("/storage/")) {
      storageAttempts++;
      // Only this boundary is simulated; database requests use the owned gateway.
      if (storageAttempts > 1) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify({ statusCode: "503", error: "unavailable", message: "injected Storage interruption" }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    target.pathname = target.pathname.replace(/^\/rest\/v1/, "");
    return fetch(target, init);
  } },
});
await assert.rejects(reapAbandonedGtfsIngests(client), /injected Storage interruption/);
assert.equal(storageAttempts, 1);
const second = await reapAbandonedGtfsIngests(client);
assert.equal(second.scanned, 0);
assert.equal(second.reaped.length, 0);
assert.equal(storageAttempts, 2);
const third = await reapAbandonedGtfsIngests(client);
assert.equal(third.scanned, 0);
assert.equal(storageAttempts, 2);
console.log(JSON.stringify({ second, third, storageAttempts, finding: "pending removal survives database closure and retries after Storage interruption", scope: "native TypeScript and PostgREST database path; simulated Storage failure and successful removal" }, null, 2));
