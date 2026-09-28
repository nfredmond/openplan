import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { requireContractVerificationStack } from "./contract-verification-stack";

export function assertSynthesisProbeDatabase(database: string) {
  if (!/^openplan_synthesis_probe_[a-f0-9]{32}$/.test(database)) throw new Error("Expected an owned synthesis probe database");
}

/** Committed race fixtures use a separate schema copy, never the source database's tables. */
export async function withSynthesisProbeDatabase<T>(container: string, run: (database: string) => Promise<T>): Promise<T> {
  requireContractVerificationStack(container);
  const database = `openplan_synthesis_probe_${randomUUID().replaceAll("-", "")}`;
  assertSynthesisProbeDatabase(database);
  const marker = `synthesis-probe-owner:${randomUUID()}`;
  const admin = (sql: string) => execFileSync("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
  const archive = execFileSync("docker", ["exec", container, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema-only", "--format=custom"], { maxBuffer: 128 * 1024 * 1024 });
  execFileSync("docker", ["exec", container, "createdb", "-U", "supabase_admin", "-T", "template0", "--owner", "postgres", database]);
  // A failure before this marker is retained must not authorize cleanup of an unmarked database.
  admin(`COMMENT ON DATABASE ${database} IS '${marker}'`);
  try {
    execFileSync("docker", ["exec", "-i", container, "pg_restore", "-U", "supabase_admin", "-d", database, "--schema-only", "--exit-on-error", "--single-transaction"], { input: archive, maxBuffer: 128 * 1024 * 1024 });
    return await run(database);
  } finally {
    assertSynthesisProbeDatabase(database);
    const actual = admin(`SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${database}'`);
    if (actual !== marker) throw new Error(`Refusing cleanup without the original ownership marker: ${database}`);
    // No force option: unexpected remaining connections refuse cleanup instead of terminating another session.
    execFileSync("docker", ["exec", container, "dropdb", "-U", "supabase_admin", database]);
  }
}
