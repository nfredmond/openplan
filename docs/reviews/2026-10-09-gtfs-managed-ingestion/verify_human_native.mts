import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { cancelGtfsRequest } from "../../../openplan/src/lib/gtfs/managed-request-cancellation.ts";
import { executeGtfsHumanCommand } from "../../../openplan/src/lib/gtfs/managed-human-command.ts";
const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const [directory, mode] = process.argv.slice(2), target = process.env.OPENPLAN_PROOF_HTTP_URL!;
const identity = JSON.parse(await readFile(join(directory, "identity.json"), "utf8"));
const calls: string[] = [];
const transport: typeof fetch = async (input, init) => {
 const url = new URL(String(input)); assert.equal(url.origin, new URL(target).origin); assert.ok(url.pathname.startsWith("/rest/v1/rpc/")); assert.ok(init?.signal);
 calls.push(url.pathname.split("/").at(-1)!); url.pathname = url.pathname.slice("/rest/v1".length);
 const response = await fetch(url, init);
 if (mode === "interrupt" && response.ok) {
  const receipt = await response.clone().json(); await writeFile(join(directory, "interrupted.json"), JSON.stringify({ receipt, calls }), { mode: 0o600 });
  await new Promise(() => {});
 }
 return response;
};
const service = createClient(target, process.env.OPENPLAN_PROOF_HTTP_TOKEN!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
const options = { ...identity, directory: join(directory, "command"), target, service, signal: new AbortController().signal };
const dispatch = () => identity.kind === "cancel_request" ? cancelGtfsRequest(options) : executeGtfsHumanCommand(options);
const original = mode === "interrupt" ? null : JSON.parse(await readFile(join(directory, "interrupted.json"), "utf8")).receipt;
if (mode === "denied") {
 const before = await readFile(join(options.directory, "pending.json"), "utf8");
 await assert.rejects(dispatch, /acknowledgement is unavailable/); assert.equal(await readFile(join(options.directory, "pending.json"), "utf8"), before);
 console.log(JSON.stringify({ denied: true, calls }));
} else {
 const receipt = await dispatch(); assert.deepEqual(receipt, original); assert.equal(calls.length, 1);
 assert.deepEqual(JSON.parse(await readFile(join(options.directory, "pending.json"), "utf8")).receipt, original);
 console.log(JSON.stringify({ receipt, calls, maxRssKiB: process.resourceUsage().maxRSS }));
}
