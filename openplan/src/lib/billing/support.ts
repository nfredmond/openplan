import { normalizeSubscriptionStatus } from "@/lib/billing/subscription";

export type BillingSupportEvent = {
  eventType: string;
  createdAt?: string | null;
};

export type BillingSupportState = {
  tone: "info" | "warning";
  title: string;
  summary: string;
  bullets: string[];
};

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findLatestEvent(events: BillingSupportEvent[], eventType: string): BillingSupportEvent | null {
  const matches = events.filter((event) => event.eventType === eventType);
  if (!matches.length) {
    return null;
  }

  return matches.sort((a, b) => (parseTimestamp(b.createdAt) ?? 0) - (parseTimestamp(a.createdAt) ?? 0))[0] ?? null;
}

function formatEventMoment(value: string | null | undefined): string {
  if (!value) {
    return "No timestamp recorded";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "No timestamp recorded";
  }

  return parsed.toLocaleString();
}

export function resolveBillingSupportState({
  status,
  checkoutState,
  billingUpdatedAt,
  events,
}: {
  status: string | null | undefined;
  checkoutState?: string | null;
  billingUpdatedAt?: string | null;
  events?: BillingSupportEvent[] | null;
}): BillingSupportState | null {
  const normalizedStatus = normalizeSubscriptionStatus(status);
  const normalizedCheckoutState = checkoutState?.trim().toLowerCase() ?? null;
  const normalizedEvents = events ?? [];

  const latestCheckoutInitialized = findLatestEvent(normalizedEvents, "checkout_initialized");
  const latestWebhookUpdate = findLatestEvent(normalizedEvents, "webhook_billing_updated");
  const latestBlockedUpdate = findLatestEvent(normalizedEvents, "billing_update_blocked_pending_identity_review");

  if (normalizedCheckoutState === "success" && normalizedStatus === "checkout_pending" && !latestWebhookUpdate) {
    return {
      tone: "warning",
      title: "Stripe returned, but OpenPlan has not confirmed activation yet",
      summary:
        "This workspace is still in Checkout Pending and no recent webhook-backed billing update is visible yet. Treat access as unconfirmed until the status card or billing events show a processed update.",
      bullets: [
        `Most recent checkout initialization: ${formatEventMoment(latestCheckoutInitialized?.createdAt ?? null)}.`,
        `Workspace billing record last updated: ${formatEventMoment(billingUpdatedAt)}.`,
        "If this state does not move within a few minutes, capture the workspace ID, the purchaser email, and the Stripe return URL/session reference before escalating support.",
      ],
    };
  }

  if (normalizedStatus === "checkout_pending") {
    return {
      tone: "info",
      title: "Checkout is pending workspace activation",
      summary:
        "OpenPlan has recorded an attempted checkout for this workspace, but final access still depends on webhook reconciliation and any required review checks.",
      bullets: [
        `Latest checkout initialization: ${formatEventMoment(latestCheckoutInitialized?.createdAt ?? null)}.`,
        latestWebhookUpdate
          ? `Latest webhook billing update: ${formatEventMoment(latestWebhookUpdate.createdAt)}.`
          : "No webhook-backed billing update is visible in the recent event list yet.",
        latestBlockedUpdate
          ? `A billing update was blocked pending review at ${formatEventMoment(latestBlockedUpdate.createdAt)}.`
          : "If you already completed Stripe checkout, stay on this workspace-specific billing page and refresh here instead of assuming access is active elsewhere.",
      ],
    };
  }

  if (["inactive", "canceled", "past_due"].includes(normalizedStatus)) {
    return {
      tone: "warning",
      title: "Workspace billing is not in an active state",
      summary:
        "This workspace is readable, but new paid access should not be treated as active until billing is restarted or reconciled from this exact workspace context.",
      bullets: [
        `Workspace billing record last updated: ${formatEventMoment(billingUpdatedAt)}.`,
        latestWebhookUpdate
          ? `Most recent webhook billing update: ${formatEventMoment(latestWebhookUpdate.createdAt)}.`
          : "No recent webhook billing update is visible in the current event history.",
        "If this status is unexpected, verify you are in the intended workspace before launching a new checkout or asking support to intervene.",
      ],
    };
  }

  return null;
}
