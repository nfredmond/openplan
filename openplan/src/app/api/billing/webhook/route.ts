import { NextRequest, NextResponse } from "next/server";
import {
  buildWebhookPayloadHash,
  detectStripeCheckoutIdentityReview,
  mapStripeEventToBillingMutation,
  parseLegacyWebhookPayload,
  resolveLegacyWebhookEventId,
  type BillingWebhookMutation,
  verifyStripeWebhookSignature,
} from "@/lib/billing/webhook";
import { claimWebhookEvent, completeWebhookEvent } from "@/lib/billing/webhook-idempotency";
import { logBillingEvent } from "@/lib/billing/events";
import { applyBillingSubscriptionMutation } from "@/lib/billing/subscriptions";
import {
  createServiceRoleClient,
  isMissingEnvironmentVariableError,
} from "@/lib/supabase/server";
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
  return applyBillingSubscriptionMutation(serviceSupabase, mutation);
}

async function workspaceSubscriptionStatus(workspaceId: string): Promise<string | null> {
  const serviceSupabase = createServiceRoleClient();
  const { data, error } = await serviceSupabase
    .from("workspaces")
    .select("subscription_status")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.subscription_status ?? null;
}

async function hasPendingCheckoutIdentityReview(workspaceId: string, stripeCustomerId?: string) {
  const currentStatus = await workspaceSubscriptionStatus(workspaceId);
  if (currentStatus !== "checkout_pending") {
    return null;
  }

  const serviceSupabase = createServiceRoleClient();
  const { data, error } = await serviceSupabase
    .from("billing_events")
    .select("id, payload, created_at")
    .eq("workspace_id", workspaceId)
    .eq("event_type", "checkout_identity_review_required")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(error.message);
  }

  return (
    data?.find((event) => {
      const payload =
        event && typeof event.payload === "object" && event.payload !== null
          ? (event.payload as Record<string, unknown>)
          : {};
      const eventStripeCustomerId =
        typeof payload.stripeCustomerId === "string" ? payload.stripeCustomerId : undefined;

      return !stripeCustomerId || !eventStripeCustomerId || eventStripeCustomerId === stripeCustomerId;
    }) ?? null
  );
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

      const identityReview = detectStripeCheckoutIdentityReview(stripeEvent);
      if (identityReview) {
        try {
          await logBillingEvent({
            workspaceId: identityReview.workspaceId,
            eventType: "checkout_identity_review_required",
            source: "stripe.checkout.session.completed",
            payload: {
              checkoutSessionId: identityReview.checkoutSessionId,
              stripeCustomerId: identityReview.stripeCustomerId ?? null,
              initiatedByUserEmail: identityReview.initiatedByUserEmail ?? null,
              purchaserEmail: identityReview.purchaserEmail ?? null,
              plan: identityReview.plan ?? null,
              reason: identityReview.reason,
            },
          });
        } catch (eventError) {
          audit.warn("billing_event_log_failed", {
            workspaceId: identityReview.workspaceId,
            message: eventError instanceof Error ? eventError.message : "unknown",
            providerEventId: stripeEvent.id,
          });
        }

        if (receiptId) {
          await completeWebhookEvent({
            receiptId,
            status: "ignored",
            workspaceId: identityReview.workspaceId,
            eventType: stripeEvent.type,
            failureReason: identityReview.reason,
          }).catch((error) => {
            audit.warn("webhook_receipt_complete_failed", {
              provider: "stripe",
              eventId: stripeEvent.id,
              message: error instanceof Error ? error.message : "unknown",
            });
          });
        }

        audit.warn("checkout_identity_review_required", {
          workspaceId: identityReview.workspaceId,
          checkoutSessionId: identityReview.checkoutSessionId,
          stripeCustomerId: identityReview.stripeCustomerId ?? null,
          initiatedByUserEmail: identityReview.initiatedByUserEmail ?? null,
          purchaserEmail: identityReview.purchaserEmail ?? null,
          durationMs: Date.now() - startedAt,
        });

        return NextResponse.json({ ok: true, manualReview: true }, { status: 200 });
      }

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

  if (envelope.provider === "stripe") {
    try {
      const pendingIdentityReview = await hasPendingCheckoutIdentityReview(
        envelope.mutation.workspaceId,
        envelope.mutation.stripeCustomerId
      );

      if (pendingIdentityReview) {
        try {
          await logBillingEvent({
            workspaceId: envelope.mutation.workspaceId,
            eventType: "billing_update_blocked_pending_identity_review",
            source: envelope.mutation.source ?? envelope.provider,
            payload: {
              providerEventId: envelope.eventId,
              providerEventType: envelope.eventType,
              stripeCustomerId: envelope.mutation.stripeCustomerId ?? null,
              pendingReviewEventId: pendingIdentityReview.id,
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
            status: "ignored",
            workspaceId: envelope.mutation.workspaceId,
            eventType: envelope.eventType,
            failureReason: "checkout_identity_review_pending",
          }).catch((receiptError) => {
            audit.warn("webhook_receipt_complete_failed", {
              eventId: envelope.eventId,
              message: receiptError instanceof Error ? receiptError.message : "unknown",
            });
          });
        }

        audit.warn("billing_update_blocked_pending_identity_review", {
          workspaceId: envelope.mutation.workspaceId,
          providerEventId: envelope.eventId,
          providerEventType: envelope.eventType,
          stripeCustomerId: envelope.mutation.stripeCustomerId ?? null,
          pendingReviewEventId: pendingIdentityReview.id,
          durationMs: Date.now() - startedAt,
        });

        return NextResponse.json({ ok: true, manualReview: true, blocked: true }, { status: 200 });
      }
    } catch (reviewError) {
      audit.error("checkout_identity_review_lookup_failed", {
        workspaceId: envelope.mutation.workspaceId,
        providerEventId: envelope.eventId,
        providerEventType: envelope.eventType,
        message: reviewError instanceof Error ? reviewError.message : "unknown",
        missingEnv:
          isMissingEnvironmentVariableError(reviewError) ? reviewError.variableName : undefined,
      });

      if (isMissingEnvironmentVariableError(reviewError)) {
        return NextResponse.json({ error: "Billing configuration unavailable" }, { status: 503 });
      }

      return NextResponse.json({ error: "Failed to apply billing update" }, { status: 500 });
    }
  }

  let mutationResult;
  try {
    mutationResult = await applyBillingMutation(envelope.mutation);
  } catch (mutationError) {
    if (receiptId) {
      await completeWebhookEvent({
        receiptId,
        status: "failed",
        workspaceId: envelope.mutation.workspaceId,
        eventType: envelope.eventType,
        failureReason: mutationError instanceof Error ? mutationError.message : "unknown",
      }).catch((receiptError) => {
        audit.warn("webhook_receipt_complete_failed", {
          eventId: envelope?.eventId,
          message: receiptError instanceof Error ? receiptError.message : "unknown",
        });
      });
    }

    audit.error("workspace_update_failed", {
      workspaceId: envelope.mutation.workspaceId,
      message: mutationError instanceof Error ? mutationError.message : "unknown",
      source: envelope.mutation.source ?? envelope.provider,
      providerEventId: envelope.eventId,
      providerEventType: envelope.eventType,
      missingEnv:
        isMissingEnvironmentVariableError(mutationError) ? mutationError.variableName : undefined,
    });

    if (isMissingEnvironmentVariableError(mutationError)) {
      return NextResponse.json({ error: "Billing configuration unavailable" }, { status: 503 });
    }

    return NextResponse.json({ error: "Failed to apply billing update" }, { status: 500 });
  }

  const { error } = mutationResult;

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

  if (mutationResult.ledgerMissing) {
    audit.warn("billing_ledger_schema_missing", {
      workspaceId: envelope.mutation.workspaceId,
      providerEventId: envelope.eventId,
      providerEventType: envelope.eventType,
    });
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
