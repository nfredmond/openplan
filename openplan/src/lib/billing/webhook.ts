import { createHash } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";

const BILLING_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
  "checkout_pending",
  "pilot",
  "inactive",
] as const;

const BILLING_PLANS = ["starter", "professional", "enterprise", "pilot"] as const;

export type BillingSubscriptionStatus = (typeof BILLING_STATUSES)[number];
export type BillingPlan = (typeof BILLING_PLANS)[number];

export type BillingWebhookMutation = {
  workspaceId: string;
  subscriptionStatus: BillingSubscriptionStatus;
  subscriptionPlan?: BillingPlan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
  source?: string;
};

export const legacyWebhookSchema = z.object({
  eventId: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  workspaceId: z.string().uuid(),
  subscriptionStatus: z.enum(BILLING_STATUSES),
  subscriptionPlan: z.enum(BILLING_PLANS).optional(),
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  currentPeriodEnd: z.string().datetime().optional(),
  source: z.string().optional(),
});

export type LegacyWebhookPayload = z.infer<typeof legacyWebhookSchema>;

type StripeEventSchema = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

type StripeConstructorLike = new (
  apiKey: string,
  options?: Record<string, unknown>
) => {
  webhooks: {
    constructEvent: (payload: string, signature: string, secret: string) => unknown;
  };
};

export type StripeWebhookVerificationResult =
  | { ok: true; event: StripeEventSchema }
  | {
      ok: false;
      reason:
        | "missing_signature"
        | "missing_webhook_secret"
        | "missing_sdk"
        | "invalid_signature"
        | "invalid_event_shape";
      message?: string;
    };

export type StripeWebhookVerificationInput = {
  rawBody: string;
  signatureHeader: string | null;
  webhookSecret?: string | null;
  apiKey?: string | null;
  loadStripeConstructor?: () => Promise<StripeConstructorLike | null>;
};

const stripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.record(z.string(), z.unknown()),
  }),
});

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeStripeStatus(status: string | undefined): BillingSubscriptionStatus {
  switch ((status ?? "").toLowerCase().trim()) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "unpaid":
      return "unpaid";
    case "incomplete_expired":
    case "paused":
      return "inactive";
    default:
      return "inactive";
  }
}

function normalizePlan(plan: string | undefined): BillingPlan | undefined {
  const normalized = plan?.toLowerCase().trim();
  if (!normalized) {
    return undefined;
  }

  if ((BILLING_PLANS as readonly string[]).includes(normalized)) {
    return normalized as BillingPlan;
  }

  return undefined;
}

function extractWorkspaceId(metadata: unknown): string | undefined {
  const metadataRecord = asRecord(metadata);
  return asNonEmptyString(metadataRecord.workspaceId) ?? asNonEmptyString(metadataRecord.workspace_id);
}

function asIsoDatetime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return undefined;
    }

    return new Date(parsed).toISOString();
  }

  return undefined;
}

async function defaultStripeConstructorLoader(): Promise<StripeConstructorLike | null> {
  return Stripe as unknown as StripeConstructorLike;
}

export function parseLegacyWebhookPayload(payload: unknown) {
  return legacyWebhookSchema.safeParse(payload);
}

export function buildWebhookPayloadHash(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function resolveLegacyWebhookEventId(rawBody: string, eventId?: string): string {
  const explicitEventId = asNonEmptyString(eventId);
  if (explicitEventId) {
    return explicitEventId;
  }

  const hash = buildWebhookPayloadHash(rawBody);
  return `legacy_${hash}`;
}

export async function verifyStripeWebhookSignature({
  rawBody,
  signatureHeader,
  webhookSecret,
  apiKey,
  loadStripeConstructor = defaultStripeConstructorLoader,
}: StripeWebhookVerificationInput): Promise<StripeWebhookVerificationResult> {
  const signature = asNonEmptyString(signatureHeader);
  if (!signature) {
    return { ok: false, reason: "missing_signature" };
  }

  const secret = asNonEmptyString(webhookSecret);
  if (!secret) {
    return { ok: false, reason: "missing_webhook_secret" };
  }

  const StripeConstructor = await loadStripeConstructor();
  if (!StripeConstructor) {
    return {
      ok: false,
      reason: "missing_sdk",
      message: "Stripe SDK package is not installed in this deployment.",
    };
  }

  const stripe = new StripeConstructor(apiKey?.trim() || "sk_test_openplan_webhook_placeholder", {
    // TODO(iris): move this to explicit API version pin once Stripe checkout sessions land.
    // For webhook signature verification, this placeholder key is sufficient.
  });

  let eventCandidate: unknown;
  try {
    eventCandidate = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_signature",
      message: error instanceof Error ? error.message : "Stripe signature verification failed",
    };
  }

  const parsed = stripeEventSchema.safeParse(eventCandidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_event_shape",
      message: "Verified Stripe event did not match expected shape.",
    };
  }

  return { ok: true, event: parsed.data };
}

export function mapStripeEventToBillingMutation(
  event: StripeEventSchema
):
  | { handled: true; mutation: BillingWebhookMutation }
  | { handled: false; reason: "unsupported_event_type" | "missing_workspace_id" } {
  const object = asRecord(event.data.object);

  if (event.type === "checkout.session.completed") {
    const workspaceId = extractWorkspaceId(object.metadata);
    if (!workspaceId) {
      return { handled: false, reason: "missing_workspace_id" };
    }

    return {
      handled: true,
      mutation: {
        workspaceId,
        subscriptionStatus: "active",
        subscriptionPlan: normalizePlan(asNonEmptyString(asRecord(object.metadata).plan)),
        stripeCustomerId: asNonEmptyString(object.customer),
        stripeSubscriptionId: asNonEmptyString(object.subscription),
        source: "stripe.checkout.session.completed",
      },
    };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const workspaceId = extractWorkspaceId(object.metadata);
    if (!workspaceId) {
      return { handled: false, reason: "missing_workspace_id" };
    }

    return {
      handled: true,
      mutation: {
        workspaceId,
        subscriptionStatus:
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : normalizeStripeStatus(asNonEmptyString(object.status)),
        subscriptionPlan: normalizePlan(asNonEmptyString(asRecord(object.metadata).plan)),
        stripeCustomerId: asNonEmptyString(object.customer),
        stripeSubscriptionId: asNonEmptyString(object.id),
        currentPeriodEnd: asIsoDatetime(object.current_period_end),
        source: `stripe.${event.type}`,
      },
    };
  }

  return { handled: false, reason: "unsupported_event_type" };
}
