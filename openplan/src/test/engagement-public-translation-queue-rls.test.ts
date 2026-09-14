import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

// Installed anonymous authority, private mapping and successor custody use real
// database roles. All synthetic fixtures roll back; no worker sees these rows.
it.skipIf(!LIVE_RLS)("public translation queue retains anonymous scope, private custody and explicit retries", () => {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const fixture = readFileSync("src/test/fixtures/engagement/public-translation-queue.sql", "utf8");
  const output = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n${fixture}\nSELECT 'public-translation-queue-verified';\nROLLBACK;`, timeout: 45_000,
  });
  expect(output.trim()).toBe("public-translation-queue-verified");
}, 60_000);
