import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type Args = {
  dryRun: boolean;
  fixturePath: string;
  baseUrl: string;
};

type SeedUserKey = "workspaceA" | "workspaceB";

type SeedUser = {
  key: SeedUserKey;
  email: string;
  passwordEnv: string;
  defaultPassword: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  projectId: string;
  projectName: string;
  projectSummary: string;
};

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "../qa-harness/fixtures/workspace-url-isolation.local.json"
);

const SEED_USERS: SeedUser[] = [
  {
    key: "workspaceA",
    email: "openplan-workspace-a@example.test",
    passwordEnv: "OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD",
    defaultPassword: "OpenPlanSyntheticA!2026",
    workspaceId: "00000000-0000-4000-8000-0000000000a0",
    workspaceName: "Synthetic Workspace A",
    workspaceSlug: "synthetic-workspace-a",
    projectId: "00000000-0000-4000-8000-0000000000a1",
    projectName: "Synthetic A Project",
    projectSummary: "Local-only fixture record for workspace A URL isolation proof.",
  },
  {
    key: "workspaceB",
    email: "openplan-workspace-b@example.test",
    passwordEnv: "OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD",
    defaultPassword: "OpenPlanSyntheticB!2026",
    workspaceId: "00000000-0000-4000-8000-0000000000b0",
    workspaceName: "Synthetic Workspace B",
    workspaceSlug: "synthetic-workspace-b",
    projectId: "00000000-0000-4000-8000-0000000000b1",
    projectName: "Synthetic B Project",
    projectSummary: "Local-only fixture record for workspace B URL isolation proof.",
  },
];

const DENIED_PATTERN =
  "not found|404|unauthorized|not authorized|forbidden|403|workspace membership|required|no workspace membership|not provisioned|sign in";

function printUsage() {
  console.log(`OpenPlan local workspace URL isolation seed\n\nUsage:\n  tsx scripts/seed-local-workspace-isolation.ts [--dry-run] [--fixture <path>] [--base-url <url>]\n\nSafety:\n  - Refuses non-local Supabase URLs.\n  - Uses only local synthetic @example.test users.\n  - Writes the ignored local fixture used by qa-harness/openplan-local-workspace-url-isolation-smoke.js.\n\nOptions:\n  --dry-run           Validate local env and print planned fixture without writing Supabase or files.\n  --fixture <path>    Fixture output path. Default: ../qa-harness/fixtures/workspace-url-isolation.local.json\n  --base-url <url>    App URL stored in the fixture. Default: http://localhost:3000\n  --help              Show this help.`);
}

function parseArgs(argv: string[]): Args & { help: boolean } {
  const args: Args & { help: boolean } = {
    dryRun: false,
    fixturePath: DEFAULT_FIXTURE_PATH,
    baseUrl: process.env.OPENPLAN_BASE_URL || DEFAULT_BASE_URL,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--fixture") args.fixturePath = path.resolve(process.cwd(), argv[++index] ?? "");
    else if (arg === "--base-url") args.baseUrl = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function loadEnvFile(filePath: string) {
  let contents = "";
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;
    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
  }

  return true;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var ${name}. Run Supabase locally and populate openplan/.env.local.`);
  return value;
}

function assertLocalUrl(urlValue: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error(`${label} is not a valid URL: ${urlValue}`);
  }

  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error(`Refusing ${label} ${urlValue}. This seed is local-only and must not touch production data.`);
  }
}

function passwordFor(user: SeedUser) {
  return process.env[user.passwordEnv]?.trim() || user.defaultPassword;
}

async function listUsersByEmail(supabase: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Failed to list local auth users: ${error.message}`);
    const users = data.users as User[];
    const match = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (users.length < 100) return null;
  }

  throw new Error("Failed to scan local auth users within 2,000-user safety limit.");
}

async function ensureUser(supabase: SupabaseClient, seedUser: SeedUser): Promise<User> {
  const existing = await listUsersByEmail(supabase, seedUser.email);
  const password = passwordFor(seedUser);

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { openplan_local_isolation_seed: true, fixture_key: seedUser.key },
    });
    if (error || !data.user) {
      throw new Error(`Failed to update local synthetic user ${seedUser.email}: ${error?.message ?? "missing user"}`);
    }
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: seedUser.email,
    password,
    email_confirm: true,
    user_metadata: { openplan_local_isolation_seed: true, fixture_key: seedUser.key },
  });
  if (error || !data.user) {
    throw new Error(`Failed to create local synthetic user ${seedUser.email}: ${error?.message ?? "missing user"}`);
  }
  return data.user;
}

async function must(label: string, result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
}

async function seedRecords(supabase: SupabaseClient, userIds: Record<SeedUserKey, string>) {
  for (const seedUser of SEED_USERS) {
    await must(
      `workspace upsert ${seedUser.workspaceSlug}`,
      await supabase.from("workspaces").upsert(
        {
          id: seedUser.workspaceId,
          name: seedUser.workspaceName,
          slug: seedUser.workspaceSlug,
          plan: "pilot",
        },
        { onConflict: "id" }
      )
    );

    await must(
      `workspace member upsert ${seedUser.key}`,
      await supabase.from("workspace_members").upsert(
        {
          workspace_id: seedUser.workspaceId,
          user_id: userIds[seedUser.key],
          role: "owner",
        },
        { onConflict: "workspace_id,user_id" }
      )
    );

    await must(
      `project upsert ${seedUser.projectName}`,
      await supabase.from("projects").upsert(
        {
          id: seedUser.projectId,
          workspace_id: seedUser.workspaceId,
          name: seedUser.projectName,
          summary: seedUser.projectSummary,
          status: "active",
          plan_type: "corridor_plan",
          delivery_phase: "scoping",
          created_by: userIds[seedUser.key],
        },
        { onConflict: "id" }
      )
    );
  }

  await must(
    "remove accidental cross-membership A->B",
    await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", SEED_USERS[1].workspaceId)
      .eq("user_id", userIds.workspaceA)
  );
  await must(
    "remove accidental cross-membership B->A",
    await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", SEED_USERS[0].workspaceId)
      .eq("user_id", userIds.workspaceB)
  );
}

async function verifyRls(url: string, anonKey: string) {
  const clients: Record<SeedUserKey, SupabaseClient> = {
    workspaceA: createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    workspaceB: createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };

  for (const seedUser of SEED_USERS) {
    const signIn = await clients[seedUser.key].auth.signInWithPassword({
      email: seedUser.email,
      password: passwordFor(seedUser),
    });
    if (signIn.error) throw new Error(`Failed to sign in ${seedUser.key}: ${signIn.error.message}`);
  }

  for (const seedUser of SEED_USERS) {
    const other = seedUser.key === "workspaceA" ? SEED_USERS[1] : SEED_USERS[0];
    const ownRead = await clients[seedUser.key]
      .from("projects")
      .select("id,name,workspace_id")
      .eq("id", seedUser.projectId)
      .single();
    if (ownRead.error || ownRead.data?.name !== seedUser.projectName) {
      throw new Error(`${seedUser.key} could not read its own seeded project: ${ownRead.error?.message ?? "wrong row"}`);
    }

    const crossRead = await clients[seedUser.key]
      .from("projects")
      .select("id,name,workspace_id")
      .eq("id", other.projectId);
    if (crossRead.error) throw new Error(`${seedUser.key} cross-read query errored: ${crossRead.error.message}`);
    if ((crossRead.data ?? []).length !== 0) {
      throw new Error(`${seedUser.key} can read ${other.key}'s project; isolation seed is unsafe.`);
    }
  }

  await Promise.all(Object.values(clients).map((client) => client.auth.signOut()));
}

function buildFixture(baseUrl: string) {
  return {
    baseUrl,
    users: Object.fromEntries(
      SEED_USERS.map((seedUser) => [
        seedUser.key,
        {
          email: seedUser.email,
          passwordEnv: seedUser.passwordEnv,
          workspaceName: seedUser.workspaceName,
        },
      ])
    ),
    checks: SEED_USERS.map((seedUser) => {
      const other = seedUser.key === "workspaceA" ? SEED_USERS[1] : SEED_USERS[0];
      return {
        name: `${seedUser.workspaceName} project detail is visible to ${seedUser.key} and blocked for ${other.key}`,
        url: `/projects/${seedUser.projectId}`,
        allowedUser: seedUser.key,
        deniedUsers: [other.key],
        allowedText: seedUser.projectName,
        leakText: seedUser.projectName,
        deniedPattern: DENIED_PATTERN,
      };
    }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  loadEnvFile(path.resolve(process.cwd(), "../.env.local"));

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  assertLocalUrl(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL");
  assertLocalUrl(args.baseUrl, "fixture baseUrl");

  const fixture = buildFixture(args.baseUrl);

  if (args.dryRun) {
    console.log("[seed:workspace-isolation] dry run; no Supabase or fixture writes.");
    console.log(JSON.stringify(fixture, null, 2));
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userIds = {} as Record<SeedUserKey, string>;
  for (const seedUser of SEED_USERS) {
    const user = await ensureUser(supabase, seedUser);
    userIds[seedUser.key] = user.id;
    console.log(`[seed:workspace-isolation] ready user ${seedUser.key}: ${seedUser.email}`);
  }

  await seedRecords(supabase, userIds);
  await verifyRls(supabaseUrl, anonKey);

  mkdirSync(path.dirname(args.fixturePath), { recursive: true });
  writeFileSync(args.fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

  console.log(`[seed:workspace-isolation] wrote fixture: ${args.fixturePath}`);
  console.log("[seed:workspace-isolation] local RLS read/cross-read verification passed.");
  console.log("[seed:workspace-isolation] smoke env exports:");
  for (const seedUser of SEED_USERS) {
    console.log(`export ${seedUser.passwordEnv}='${passwordFor(seedUser).replace(/'/g, "'\\''")}'`);
  }
}

main().catch((error) => {
  console.error("[seed:workspace-isolation] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
