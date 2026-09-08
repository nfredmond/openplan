/**
 * Optional live isolation proof for an explicitly selected test stack.
 *
 * Since September 7, 2026, finding a running database does not authorize writes.
 * OPENPLAN_RLS_GATE=1 opts into fixture-writing tests after the operator selects
 * an isolated stack. Ordinary qa:gate stays local and does not write DB fixtures.
 * The separate RLS Isolation workflow continues to run the proof in CI.
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Split from the running so both branches can be tested without stopping the
 * local Supabase stack — the skip path is the one that must not rot, and it is
 * the one you cannot reach on a working machine.
 *
 * `supabase status -o env` prints `DB_URL="postgresql://…"` when a stack is up.
 * A missing binary, a stopped stack, or a truncated answer all mean the same
 * thing to this gate: there is nothing to prove against.
 */
export function decideRlsGate({ statusOk, statusOutput }) {
  if (!statusOk) {
    return { action: "skip", reason: "`supabase status` did not answer — no local stack is running." };
  }
  if (!/^DB_URL="?postgres/m.test(statusOutput ?? "")) {
    return { action: "skip", reason: "`supabase status` answered without a DB_URL — the stack is not fully up." };
  }
  return { action: "run", reason: "a local Supabase stack is up." };
}

const SKIP_BANNER = [
  "",
  "  ────────────────────────────────────────────────────────────────",
  "  LIVE RLS PROOF SKIPPED — this gate did NOT check tenant isolation",
  "  ────────────────────────────────────────────────────────────────",
  "",
  "  What went unproven: that Postgres refuses one workspace's rows to",
  "  another workspace's members, and that every workspace-scoped table",
  "  in the schema is covered by a probe.",
  "",
  "  To prove it: select an isolated test database, then npm run test:rls-live",
  "",
].join("\n");

/** @param {{ env?: Record<string, string | undefined>, run?: typeof spawnSync }} options */
export function main({ env = process.env, run = spawnSync } = {}) {
  // A running local stack can be the operator's demo, not a disposable test DB.
  if (env.OPENPLAN_RLS_GATE !== "1") {
    process.stdout.write(`${SKIP_BANNER}\n  Live tests write fixtures. Select an isolated test stack, then use\n  OPENPLAN_RLS_GATE=1 npm run qa:gate, or run npm run test:rls-live explicitly.\n\n`);
    return 0;
  }
  const status = run("npm", ["exec", "--", "supabase", "status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  const decision = decideRlsGate({
    statusOk: status.status === 0,
    statusOutput: status.stdout,
  });

  if (decision.action === "skip") {
    process.stdout.write(`${SKIP_BANNER}\n  Reason: ${decision.reason}\n\n`);
    return 0;
  }

  const proof = run("npm", ["run", "test:rls-live"], { stdio: "inherit" });
  return proof.status ?? 1;
}

// Only run when invoked as a command, so importing the decision above for a
// test does not start a Supabase stack.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
