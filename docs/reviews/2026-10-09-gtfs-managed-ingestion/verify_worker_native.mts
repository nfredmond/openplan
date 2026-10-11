import { readFile } from "node:fs/promises";
import { z } from "../../../openplan/node_modules/zod/index.js";
import { verifyGtfsAttempt, verifyGtfsClaim, verifyGtfsStatus } from "../../../openplan/src/lib/gtfs/managed-worker-service.ts";
const entry = z.object({ scope: z.object({ versionId: z.string(), token: z.string(), workspaceId: z.string() }),
  attempt: z.unknown(), claim: z.unknown(), status: z.unknown() });
const values = z.array(entry).parse(JSON.parse(await readFile(process.argv[2], "utf8")));
for (const value of values) {
  verifyGtfsClaim(value.claim, value.scope);
  verifyGtfsAttempt(value.attempt, value.scope);
  verifyGtfsStatus(value.status, value.scope);
}
console.log(JSON.stringify({ verifiedNativeSnapshots: values.length }));
