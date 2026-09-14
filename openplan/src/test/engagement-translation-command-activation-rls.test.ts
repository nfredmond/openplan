import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

it.skipIf(!LIVE_RLS)("staff translations use installed commands while direct writes stay denied", () => {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const fixture = readFileSync("src/test/fixtures/engagement/translation-command-activation.sql", "utf8");
  const output = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';
${fixture}
ROLLBACK;`, timeout: 45_000,
  });
  expect(output.trim()).toBe("translation-command-activation-verified");
}, 60_000);
