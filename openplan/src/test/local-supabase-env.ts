import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Connecting the live tests to the local Supabase stack.
 *
 * Lifted out of `rls-isolation.test.ts` and `rls-viewer-denial.test.ts`, which
 * carried byte-identical copies. A third copy was about to be written for
 * `migration-schema-drift.test.ts`, which is one too many.
 */

export const LIVE_RLS = process.env.OPENPLAN_RLS_LIVE_TEST === "1";

export type LocalSupabaseEnv = {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  /** postgresql://… — the port identifies which stack, when more than one is up. */
  DB_URL: string;
};

/** Split from the fetch so the parsing can be exercised without a running stack. */
export function parseLocalSupabaseEnv(output: string): LocalSupabaseEnv {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (match) values.set(match[1], match[2]);
  }

  const env = {
    API_URL: values.get("API_URL"),
    ANON_KEY: values.get("ANON_KEY"),
    SERVICE_ROLE_KEY: values.get("SERVICE_ROLE_KEY"),
    DB_URL: values.get("DB_URL"),
  };

  if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY || !env.DB_URL) {
    throw new Error("Unable to resolve local Supabase env. Run `npm exec -- supabase start` first.");
  }

  return env as LocalSupabaseEnv;
}

export function getLocalSupabaseEnv(): LocalSupabaseEnv {
  const workdir = process.env.OPENPLAN_SUPABASE_WORKDIR?.trim();
  const args = ["exec", "--", "supabase", "status", "-o", "env"];
  if (workdir) args.push("--workdir", workdir);
  const output = execFileSync("npm", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return parseLocalSupabaseEnv(output);
}

export function liveClient(url: string, key: string, label = "openplan"): SupabaseClient {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: `${label}-${randomUUID()}` },
  });
}
