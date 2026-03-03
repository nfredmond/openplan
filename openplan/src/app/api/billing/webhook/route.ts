import { NextRequest, NextResponse } from "next/server";
import {
  buildWebhookPayloadHash,
  mapStripeEventToBillingMutation,
  parseLegacyWebhookPayload,
  resolveLegacyWebhookEventId,
  type BillingWebhookMutation,
  verifyStripeWebhookSignature,
} from "@/lib/billing/webhook";
import { claimWebhookEvent, completeWebhookEvent } from "@/lib/billing/webhook-idempotency";
import { logBillingEvent } from "@/lib/billing/events";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

type WebhookEnvelope = {
  provider: "legacy" | "stripe";
  eventId: string;
  eventType: string;
  mutation: BillingWebhookMutation;
  verificationMode: "legacy_secret" | "stripe_signature" | "legacy_secret_guarded_fallback";
  fallbackReason?: "missing_webhook_secret" | "missing_sdk";
};

function isGuardedStripeFallbackAllowed(): boolean {
  return process.env.OPENPLAN_STRIPE_ALLOW_GUARDED_FALLBACK?.trim().toLowerCase() === "true";
}

function isLegacyAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.OPENPLAN_BILLING_WEBHOOK_SECRET?.trim();
  if (!expectedSecret) {
    return false;
  }

  const headerSecret = request.headers.get("x-openplan-billing-secret")?.trim();
  return Boolean(headerSecret && headerSecret === expectedSecret);
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function getStripeVerificationStatus(reason: string): number {
  if (reason === "invalid_signature") {
    return 400;
  }

  if (reason === "missing_webhook_secret" || reason === "missing_sdk") {
    return 503;
  }

  return 400;
}

async function applyBillingMutation(mutation: BillingWebhookMutation) {
  const serviceSupabase = createServiceRoleClient();
  return serviceSupabase
    .from("workspaces")
    .update({
      plan: mutation.subscriptionPlan,
      subscription_plan: mutation.subscriptionPlan,
      subscription_status: mutation.subscriptionStatus,
      stripe_customer_id: mutation.stripeCustomerId,
      stripe_subscription_id: mutation.stripeSubscriptionId,
      subscription_current_period_end: mutation.currentPeriodEnd,
      billing_updated_at: new Date().toISOString(),
    })
    .eq("id", mutation.workspaceId);
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("billing.webhook", request);
  const startedAt = Date.now();

  const rawBody = await request.text();
  if (!rawBody) {
    return NextResponse.json({ error: "Empty webhook payload" }, { status: 400 });
  }

  const parsedBody = parseJson(rawBody);
  const payloadHash = buildWebhookPayloadHash(rawBody);
  const stripeSignature = request.headers.get("stripe-signature");
  const legacyAuthorized = isLegacyAuthorized(request);

  let receiptId: string | undefined;
  let envelope: WebhookEnvelope | null = null;

  if (stripeSignature) {
    const stripeVerification = await verifyStripeWebhookSignature({
      rawBody,
      signatureHeader: stripeSignature,
      webhookSecret: process.env.OPENPLAN_STRIPE_WEBHOOK_SECRET,
      apiKey: process.env.OPENPLAN_STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY,
    });

    if (stripeVerification.ok) {
      const stripeEvent = stripeVerification.event;
      const claim = await claimWebhookEvent({
        provider: "stripe",
        eventId: stripeEvent.id,
        eventType: stripeEvent.type,
        payloadHash,
      });

      if (!claim.accepted) {
        audit.info("duplicate_event_ignored", {
          provider: "stripe",
          eventId: stripeEvent.id,
          eventType: stripeEvent.type,
          durationMs: Date.now() - startedAt,
        });

        return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
      }

      receiptId = claim.receiptId;

      const mapped = mapStripeEventToBillingMutation(stripeEvent);
      if (!mapped.handled) {
        if (receiptId) {
          await completeWebhookEvent({
            receiptId,
            status: "ignored",
            eventType: stripeEvent.type,
            failureReason: mapped.reason,
          }).catch((error) => {
            audit.warn("webhook_receipt_complete_failed", {
              provider: "stripe",
              eventId: stripeEvent.id,
              message: error instanceof Error ? error.message : "unknown",
            });
          });
        }

        audit.info("stripe_event_ignored", {
          eventId: stripeEvent.id,
          eventType: stripeEvent.type,
          reason: mapped.reason,
          durationMs: Date.now() - startedAt,
        });

        return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
      }

      envelope = {
        provider: "stripe",
        eventId: stripeEvent.id,
        eventType: stripeEvent.type,
        mutation: mapped.mutation,
        verificationMode: "stripe_signature",
      };
    } else {
      const fallbackReason =
        stripeVerification.reason === "missing_webhook_secret" || stripeVerification.reason === "missing_sdk"
          ? stripeVerification.reason
          : undefined;
      const fallbackAllowed = Boolean(
        fallbackReason && legacyAuthorized && isGuardedStripeFallbackAllowed()
      );

      if (fallbackAllowed) {
        const parsedLegacy = parseLegacyWebhookPayload(parsedBody);
        if (parsedLegacy.success) {
          const payload = parsedLegacy.data;
          envelope = {
            provider: "legacy",
            eventId: resolveLegacyWebhookEventId(rawBody, payload.eventId),
            eventType: payload.eventType ?? "legacy.workspace_billing_updated",
            mutation: {
              workspaceId: payload.workspaceId,
              subscriptionStatus: payload.subscriptionStatus,
              subscriptionPlan: payload.subscriptionPlan,
              stripeCustomerId: payload.stripeCustomerId,
              stripeSubscriptionId: payload.stripeSubscriptionId,
              currentPeriodEnd: payload.currentPeriodEnd,
              source: payload.source,
            },
            verificationMode: "legacy_secret_guarded_fallback",
            fallbackReason,
          };
        }
      }

      if (!envelope) {
        audit.warn("stripe_verification_failed", {
          reason: stripeVerification.reason,
          message: stripeVerification.message ?? null,
          hasLegacyAuth: legacyAuthorized,
          guardedFallbackAllowed: isGuardedStripeFallbackAllowed(),
          durationMs: Date.now() - startedAt,
        });

        return NextResponse.json(
          {
            error: "Stripe webhook verification failed",
            reason: stripeVerification.reason,
            message: stripeVerification.message,
            fallbackAllowed: isGuardedStripeFallbackAllowed(),
          },
          { status: getStripeVerificationStatus(stripeVerification.reason) }
        );
      }
    }
  }

  if (!envelope) {
    if (!legacyAuthorized) {
      audit.warn("unauthorized", {
        hasConfiguredSecret: Boolean(process.env.OPENPLAN_BILLING_WEBHOOK_SECRET),
      });

      return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
    }

    const parsedLegacy = parseLegacyWebhookPayload(parsedBody);
    if (!parsedLegacy.success) {
      audit.warn("validation_failed", {
        issues: parsedLegacy.error.issues.length,
      });

      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const payload = parsedLegacy.data;
    envelope = {
      provider: "legacy",
      eventId: resolveLegacyWebhookEventId(rawBody, payload.eventId),
      eventType: payload.eventType ?? "legacy.workspace_billing_updated",
      mutation: {
        workspaceId: payload.workspaceId,
        subscriptionStatus: payload.subscriptionStatus,
        subscriptionPlan: payload.subscriptionPlan,
        stripeCustomerId: payload.stripeCustomerId,
        stripeSubscriptionId: payload.stripeSubscriptionId,
        currentPeriodEnd: payload.currentPeriodEnd,
        source: payload.source,
      },
      verificationMode: "legacy_secret",
    };
  }

  if (!receiptId) {
    const claim = await claimWebhookEvent({
      provider: envelope.provider,
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      payloadHash,
      workspaceId: envelope.mutation.workspaceId,
    });

    if (!claim.accepted) {
      audit.info("duplicate_event_ignored", {
        provider: envelope.provider,
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        workspaceId: envelope.mutation.workspaceId,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }

    receiptId = claim.receiptId;
  }

  const { error } = await applyBillingMutation(envelope.mutation);

  if (error) {
    if (receiptId) {
      await completeWebhookEvent({
        receiptId,
        status: "failed",
        workspaceId: envelope.mutation.workspaceId,
        eventType: envelope.eventType,
        failureReason: error.message,
      }).catch((receiptError) => {
        audit.warn("webhook_receipt_complete_failed", {
          eventId: envelope?.eventId,
          message: receiptError instanceof Error ? receiptError.message : "unknown",
        });
      });
    }

    audit.error("workspace_update_failed", {
      workspaceId: envelope.mutation.workspaceId,
      message: error.message,
      code: error.code ?? null,
      source: envelope.mutation.source ?? envelope.provider,
      providerEventId: envelope.eventId,
      providerEventType: envelope.eventType,
    });

    return NextResponse.json({ error: "Failed to apply billing update" }, { status: 500 });
  }

  try {
    await logBillingEvent({
      workspaceId: envelope.mutation.workspaceId,
      eventType: "webhook_billing_updated",
      source: envelope.mutation.source ?? envelope.provider,
      payload: {
        subscriptionStatus: envelope.mutation.subscriptionStatus,
        subscriptionPlan: envelope.mutation.subscriptionPlan ?? null,
        stripeCustomerId: envelope.mutation.stripeCustomerId ?? null,
        stripeSubscriptionId: envelope.mutation.stripeSubscriptionId ?? null,
        currentPeriodEnd: envelope.mutation.currentPeriodEnd ?? null,
        provider: envelope.provider,
        providerEventId: envelope.eventId,
        providerEventType: envelope.eventType,
        verificationMode: envelope.verificationMode,
        fallbackReason: envelope.fallbackReason ?? null,
      },
    });
  } catch (eventError) {
    audit.warn("billing_event_log_failed", {
      workspaceId: envelope.mutation.workspaceId,
      message: eventError instanceof Error ? eventError.message : "unknown",
      providerEventId: envelope.eventId,
    });
  }

  if (receiptId) {
    await completeWebhookEvent({
      receiptId,
      status: "processed",
      workspaceId: envelope.mutation.workspaceId,
      eventType: envelope.eventType,
    }).catch((receiptError) => {
      audit.warn("webhook_receipt_complete_failed", {
        workspaceId: envelope?.mutation.workspaceId,
        eventId: envelope?.eventId,
        message: receiptError instanceof Error ? receiptError.message : "unknown",
      });
    });
  }

  audit.info("workspace_billing_updated", {
    workspaceId: envelope.mutation.workspaceId,
    subscriptionStatus: envelope.mutation.subscriptionStatus,
    subscriptionPlan: envelope.mutation.subscriptionPlan ?? null,
    source: envelope.mutation.source ?? envelope.provider,
    provider: envelope.provider,
    providerEventId: envelope.eventId,
    providerEventType: envelope.eventType,
    verificationMode: envelope.verificationMode,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
