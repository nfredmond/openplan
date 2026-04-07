import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { summarizeWebhookProof, type StripeBillingEvidence } from "../src/lib/billing/webhook-proof";

type Args = {
  workspaceId: string;
  envFile?: string;
  sinceMinutes: number;
  email?: string;
  json: boolean;
};

type StripeEventObject = {
  id?: string;
  type?: string;
  created?: number;
  data?: {
    object?: Record<string, unknown>;
  };
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_ENV_CANDIDATES = ["/tmp/openplan.vercel.env", path.join(ROOT_DIR, ".env.local")];
const STRIPE_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "charge.refunded",
];

function usage(): string {
  return [
    "Usage:",
    "  tsx scripts/verify-webhook-ingestion.ts --workspace-id <uuid> [--since-minutes 240] [--env-file /tmp/openplan.vercel.env] [--email owner@example.gov] [--json]",
    "",
    "Purpose:",
    "  Read-only proof check for Stripe -> webhook -> Supabase billing ingestion.",
    "  Exits 0 when the proof lane is coherent; exits 2 when blockers remain.",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    workspaceId: "",
    sinceMinutes: 180,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--workspace-id":
        parsed.workspaceId = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--env-file":
        parsed.envFile = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--since-minutes":
        parsed.sinceMinutes = Number(argv[index + 1] ?? "180");
        index += 1;
        break;
      case "--email":
        parsed.email = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "-h":
      case "--help":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!parsed.workspaceId) {
    throw new Error("--workspace-id is required");
  }

  if (!Number.isFinite(parsed.sinceMinutes) || parsed.sinceMinutes <= 0) {
    throw new Error("--since-minutes must be a positive number");
  }

  return parsed;
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const trimmed = rawValue.trim();
    const normalized =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ? trimmed.slice(1, -1)
        : trimmed;
    env[key] = normalized;
  }
  return env;
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }
}

function loadEnv(envFile?: string): string[] {
  const loaded: string[] = [];
  const candidates = envFile ? [envFile, path.join(ROOT_DIR, ".env.local")] : DEFAULT_ENV_CANDIDATES;
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      loadEnvFile(candidate);
      loaded.push(candidate);
    }
  }
  return loaded;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  const email = normalizeString(value)?.toLowerCase();
  return email || undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function extractWorkspaceIdFromStripeObject(object: Record<string, unknown>): string | undefined {
  const metadata = asRecord(object.metadata);
  return normalizeString(metadata.workspaceId) ?? normalizeString(metadata.workspace_id) ?? normalizeString(object.client_reference_id);
}

function extractEmailFromStripeObject(object: Record<string, unknown>): string | undefined {
  const customerDetails = asRecord(object.customer_details);
  return normalizeEmail(object.customer_email) ?? normalizeEmail(customerDetails.email) ?? normalizeEmail(object.receipt_email);
}

async function fetchStripeEvents(stripeKey: string, sinceEpoch: number): Promise<StripeBillingEvidence[]> {
  const all: StripeBillingEvidence[] = [];

  for (const type of STRIPE_EVENT_TYPES) {
    const response = await fetch("https://api.stripe.com/v1/events?" + new URLSearchParams({
      type,
      limit: "100",
      "created[gte]": String(sinceEpoch),
    }), {
      headers: {
        Authorization: `Bearer ${stripeKey}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Stripe events lookup failed for ${type}: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as { data?: StripeEventObject[] };
    for (const event of payload.data ?? []) {
      const object = asRecord(event.data?.object);
      all.push({
        id: normalizeString(event.id) ?? "unknown",
        type: normalizeString(event.type) ?? type,
        created: typeof event.created === "number" ? event.created : 0,
        workspaceId: extractWorkspaceIdFromStripeObject(object),
        email: extractEmailFromStripeObject(object),
      });
    }
  }

  return all;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const loadedEnvFiles = loadEnv(args.envFile);

  const stripeKey = process.env.OPENPLAN_STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim();
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeKey) {
    throw new Error("Missing required environment variable: OPENPLAN_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY)");
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sinceEpoch = Math.floor(Date.now() / 1000) - args.sinceMinutes * 60;
  const sinceIso = new Date(sinceEpoch * 1000).toISOString();
  const requestedEmail = args.email?.trim().toLowerCase();

  const stripeEvents = (await fetchStripeEvents(stripeKey, sinceEpoch)).filter((event) => {
    if (event.workspaceId !== args.workspaceId) return false;
    if (requestedEmail && event.email !== requestedEmail) return false;
    return true;
  });

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id,name,subscription_plan,subscription_status,billing_updated_at,stripe_customer_id,stripe_subscription_id")
    .eq("id", args.workspaceId)
    .maybeSingle();

  if (workspaceError) {
    throw new Error(`Workspace lookup failed: ${workspaceError.message}`);
  }

  const { data: billingEvents, error: billingEventsError } = await supabase
    .from("billing_events")
    .select("event_type,created_at,payload")
    .eq("workspace_id", args.workspaceId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(25);

  if (billingEventsError) {
    throw new Error(`Billing events lookup failed: ${billingEventsError.message}`);
  }

  const { data: webhookReceipts, error: webhookReceiptsError } = await supabase
    .from("billing_webhook_receipts")
    .select("event_id,event_type,status,workspace_id,created_at,processed_at")
    .eq("workspace_id", args.workspaceId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(25);

  if (webhookReceiptsError) {
    throw new Error(`Webhook receipts lookup failed: ${webhookReceiptsError.message}`);
  }

  const summary = summarizeWebhookProof({
    workspaceId: args.workspaceId,
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          subscriptionStatus: workspace.subscription_status,
          subscriptionPlan: workspace.subscription_plan,
          billingUpdatedAt: workspace.billing_updated_at,
          stripeCustomerId: workspace.stripe_customer_id,
          stripeSubscriptionId: workspace.stripe_subscription_id,
        }
      : null,
    stripeEvents,
    billingEvents: (billingEvents ?? []).map((event) => ({
      eventType: event.event_type,
      createdAt: event.created_at,
    })),
    webhookReceipts: (webhookReceipts ?? []).map((receipt) => ({
      eventId: receipt.event_id,
      eventType: receipt.event_type,
      status: receipt.status,
      createdAt: receipt.created_at,
      processedAt: receipt.processed_at,
    })),
  });

  const payload = {
    capturedAt: new Date().toISOString(),
    status: summary.status,
    workspaceId: args.workspaceId,
    sinceMinutes: args.sinceMinutes,
    envFilesLoaded: loadedEnvFiles,
    workspace,
    stripeEvents,
    billingEvents,
    webhookReceipts,
    summary,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# OpenPlan webhook ingestion proof`);
    console.log(`- Captured at: ${payload.capturedAt}`);
    console.log(`- Workspace: ${args.workspaceId}`);
    console.log(`- Status: ${summary.status.toUpperCase()}`);
    console.log(`- Env files loaded: ${loadedEnvFiles.join(", ") || "process env only"}`);
    console.log(`- Stripe events matched: ${stripeEvents.length}`);
    console.log(`- billing_events matched: ${(billingEvents ?? []).length}`);
    console.log(`- billing_webhook_receipts matched: ${(webhookReceipts ?? []).length}`);
    console.log(``);
    console.log(`## Checks`);
    for (const check of summary.checks) {
      console.log(`- [${check.ok ? "x" : " "}] ${check.key}: ${check.detail}`);
    }
    console.log(``);
    console.log(`## Blockers`);
    if (summary.blockers.length) {
      for (const blocker of summary.blockers) {
        console.log(`- ${blocker}`);
      }
    } else {
      console.log(`- None.`);
    }
    console.log(``);
    console.log(`## Next actions`);
    if (summary.nextActions.length) {
      for (const action of summary.nextActions) {
        console.log(`- ${action}`);
      }
    } else {
      console.log(`- None. The webhook proof lane is coherent for this workspace and time window.`);
    }
  }

  process.exit(summary.status === "pass" ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
