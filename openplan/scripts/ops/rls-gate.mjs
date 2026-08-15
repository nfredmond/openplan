/**
 * THE LIVE RLS PROOF, AS PART OF THE PRE-SHIP GATE.
 *
 * WHERE THIS CAME FROM. On 2026-08-15 the `RLS Isolation` workflow was found
 * red on every push for three and a half days — 48 consecutive runs — while
 * `npm run qa:gate` was green every single time. Both facts were true: the
 * census that failed lives in `test:rls-live`, and `qa:gate` never ran it. Two
 * feature lanes shipped five workspace-scoped tables in that window
 * (`safety_crash_parties`, and the four `workspace_gis_*` tables) and the guard
 * that noticed had no way to reach anybody.
 *
 * A guard whose only reader is a web page somebody remembers to open is a
 * convention. This makes it part of the command that decides whether work is
 * shippable.
 *
 * WHY IT SKIPS RATHER THAN FAILS WITHOUT A STACK. `ci.yml` runs `qa:gate` on a
 * runner with no Supabase, and the live proof has its own workflow there that
 * starts one. A hard failure here would break that job for a reason that has
 * nothing to do with the code under test. The skip is LOUD and names what went
 * unproven, because a quiet skip is how this hole opened in the first place.
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
  "  To prove it:  npm exec -- supabase start && npm run test:rls-live",
  "",
].join("\n");

function main() {
  const status = spawnSync("npm", ["exec", "--", "supabase", "status", "-o", "env"], {
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

  const proof = spawnSync("npm", ["run", "test:rls-live"], { stdio: "inherit" });
  return proof.status ?? 1;
}

// Only run when invoked as a command, so importing the decision above for a
// test does not start a Supabase stack.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
