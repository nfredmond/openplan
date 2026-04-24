import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildBillingReadinessSummary,
  loadBillingReadinessFacts,
  summarizeUsageDryRun,
  type BillingReadinessFacts,
} from "@/lib/billing/readiness";
import { flushUsageEventsToStripe } from "@/lib/billing/usage-flush";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

export const runtime = "nodejs";

const billingReadinessSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  includeUsageDryRun: z.boolean().optional().default(false),
  closedBefore: z.string().datetime().optional(),
  bucketKey: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.:-]+$/).optional(),
  limit: z.number().int().min(1).max(5000).optional().default(500),
});

function configuredReadinessSecret(): string | null {
  return (
    process.env.OPENPLAN_BILLING_READINESS_SECRET?.trim() ||
    process.env.OPENPLAN_BILLING_USAGE_FLUSH_SECRET?.trim() ||
    null
  );
}

function requestSecret(request: NextRequest): string | null {
  const explicit =
    request.headers.get("x-openplan-billing-readiness-secret")?.trim() ||
    request.headers.get("x-openplan-billing-usage-flush-secret")?.trim();
  if (explicit) {
    return explicit;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return null;
}

function isAuthorized(request: NextRequest): boolean | "missing_config" {
  const expected = configuredReadinessSecret();
  if (!expected) {
    return "missing_config";
  }

  return requestSecret(request) === expected;
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("billing.readiness", request);
  const startedAt = Date.now();
  const authorized = isAuthorized(request);

  if (authorized === "missing_config") {
    audit.warn("billing_readiness_secret_missing");
    return NextResponse.json({ error: "Billing readiness is not configured" }, { status: 503 });
  }

  if (!authorized) {
    audit.warn("billing_readiness_unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = billingReadinessSchema.safeParse(body);
  if (!parsed.success) {
    audit.warn("billing_readiness_validation_failed", { issues: parsed.error.issues.length });
    return NextResponse.json({ error: "Invalid billing readiness payload" }, { status: 400 });
  }

  const input = parsed.data;
  if (input.closedBefore && Date.parse(input.closedBefore) > Date.now() + 5 * 60 * 1000) {
    audit.warn("billing_readiness_future_cutoff_rejected", { closedBefore: input.closedBefore });
    return NextResponse.json({ error: "Billing readiness cutoff cannot be in the future" }, { status: 400 });
  }

  const facts: BillingReadinessFacts = {};
  let serviceSupabase;
  try {
    serviceSupabase = createServiceRoleClient();
  } catch (error) {
    facts.subscriptionLedger = {
      accessible: false,
      error: error instanceof Error ? error.message : "unknown",
    };
    facts.usageLedger = {
      accessible: false,
      error: error instanceof Error ? error.message : "unknown",
    };
    facts.workspace = {
      requested: Boolean(input.workspaceId),
      workspaceId: input.workspaceId ?? null,
      found: false,
      error: error instanceof Error ? error.message : "unknown",
    };
    if (input.includeUsageDryRun) {
      facts.usageDryRun = {
        attempted: true,
        ok: false,
        error: error instanceof Error ? error.message : "unknown",
      };
    }
  }

  if (serviceSupabase) {
    try {
      Object.assign(
        facts,
        await loadBillingReadinessFacts(serviceSupabase, {
          workspaceId: input.workspaceId ?? null,
        })
      );
    } catch (error) {
      facts.subscriptionLedger = {
        accessible: false,
        error: error instanceof Error ? error.message : "unknown",
      };
      facts.usageLedger = {
        accessible: false,
        error: error instanceof Error ? error.message : "unknown",
      };
    }

    if (input.includeUsageDryRun) {
      try {
        const usageDryRun = await flushUsageEventsToStripe({
          supabase: serviceSupabase,
          stripeClient: null,
          dryRun: true,
          closedBefore: input.closedBefore ?? null,
          workspaceId: input.workspaceId ?? null,
          bucketKey: input.bucketKey ?? null,
          limit: input.limit,
        });
        facts.usageDryRun = summarizeUsageDryRun(usageDryRun);
      } catch (error) {
        facts.usageDryRun = {
          attempted: true,
          ok: false,
          error: error instanceof Error ? error.message : "unknown",
        };
      }
    }
  }

  const summary = buildBillingReadinessSummary({ facts });
  const event = summary.readyForPaidCanary ? "billing_readiness_ready" : "billing_readiness_blocked";
  audit[summary.readyForPaidCanary ? "info" : "warn"](event, {
    workspaceId: input.workspaceId ?? null,
    includeUsageDryRun: input.includeUsageDryRun,
    blockerCount: summary.blockers.length,
    warningCount: summary.warnings.length,
    missingEnv:
      summary.blockers.find((blocker) => blocker.includes("Missing required environment variable")) ??
      (serviceSupabase ? undefined : "service_role_client_unavailable"),
    durationMs: Date.now() - startedAt,
  });

  if (!summary.readyForPaidCanary && facts.usageDryRun?.error) {
    audit.warn("billing_readiness_usage_dry_run_failed", {
      workspaceId: input.workspaceId ?? null,
      message: facts.usageDryRun.error,
    });
  }

  return NextResponse.json(
    {
      ok: summary.readyForPaidCanary,
      ...summary,
    },
    { status: 200 }
  );
}
