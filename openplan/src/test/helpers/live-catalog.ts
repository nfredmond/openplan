import { execFileSync } from "node:child_process";
import { getLocalSupabaseEnv } from "../local-supabase-env";

/**
 * Reading the Postgres catalog from a live test.
 *
 * PostgREST does not expose `pg_policies`, `pg_class` or `information_schema`,
 * and this repo has no Postgres driver. It also, correctly, has no
 * arbitrary-SQL RPC: `execute_safe_query` was a SECURITY DEFINER function
 * taking a query string and 20260418000058 DROPPED it. Reintroducing one so a
 * test could read the catalog would trade a real security boundary for test
 * convenience.
 *
 * So the catalog is read through `psql` inside the database container the local
 * stack is already running.
 *
 * Lifted out of `migration-schema-drift.test.ts` when
 * `policies-are-enforced-guard.test.ts` became the second caller. The rule in
 * CLAUDE.md is the reason: a shared capability that lives inside one of its two
 * callers gets reimplemented wrongly by the other, and the container-resolution
 * rule below is exactly the kind of detail a second author would get wrong.
 */

/**
 * Locate the running database container by the PORT `supabase status` reports,
 * NEVER by name. This machine has more than one Supabase stack up at a time and
 * matching on a name prefix picks whichever Docker lists first — which is how a
 * test ends up confidently reporting on the wrong database.
 */
export function resolveLocalDbContainer(): string {
  const port = new URL(getLocalSupabaseEnv().DB_URL).port;
  const listing = execFileSync("docker", ["ps", "--format", "{{.Names}}|{{.Ports}}"], {
    encoding: "utf8",
  });

  const match = listing
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("|"))
    .find(([name, ports]) => name.startsWith("supabase_db_") && ports.includes(`:${port}->5432`));

  if (!match) {
    throw new Error(
      `No supabase_db_* container publishes port ${port}. Run \`npm exec -- supabase start\` first.`
    );
  }

  return match[0];
}

/**
 * Run a statement that is expected to CHANGE something, and fail loudly if it
 * did not.
 *
 * WHY THIS IS SEPARATE FROM `queryCatalog`. A read that returns nothing is a
 * legitimate answer, so the reader above tolerates it. A seed that inserts
 * nothing is a vacuous fixture: the probe that follows would then prove
 * isolation of a row that does not exist, which is the exact shape of test this
 * repository keeps discovering years later. `ON_ERROR_STOP=1` makes psql exit
 * non-zero on an SQL error — without it psql prints the error, exits 0, and
 * `execFileSync` reports success.
 *
 * Only for test fixtures against the LOCAL stack. There is no production path
 * through a docker exec.
 */
export function executeSql(container: string, statement: string): void {
  execFileSync(
    "docker",
    ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" }
  );
}

/** One row per line, `-tA` so there is no padding or header to strip. */
export function queryCatalog(container: string, query: string): string[] {
  const output = execFileSync(
    "docker",
    ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc", query],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0);
}
