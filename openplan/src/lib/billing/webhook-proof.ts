export type StripeBillingEvidence = {
  id: string;
  type: string;
  created: number;
  workspaceId?: string;
  email?: string;
};

export type BillingEventEvidence = {
  eventType: string;
  createdAt: string;
};

export type BillingWebhookReceiptEvidence = {
  eventId: string;
  eventType: string;
  status: string;
  createdAt: string;
  processedAt?: string | null;
};

export type WorkspaceBillingEvidence = {
  id: string;
  name?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPlan?: string | null;
  billingUpdatedAt?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export type WebhookProofSummary = {
  workspaceId: string;
  status: "pass" | "blocked";
  blockers: string[];
  nextActions: string[];
  checks: Array<{
    key: string;
    ok: boolean;
    detail: string;
  }>;
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function summarizeWebhookProof({
  workspaceId,
  workspace,
  stripeEvents,
  billingEvents,
  webhookReceipts,
}: {
  workspaceId: string;
  workspace: WorkspaceBillingEvidence | null;
  stripeEvents: StripeBillingEvidence[];
  billingEvents: BillingEventEvidence[];
  webhookReceipts: BillingWebhookReceiptEvidence[];
}): WebhookProofSummary {
  const blockers: string[] = [];
  const nextActions: string[] = [];

  const processedReceipts = webhookReceipts.filter((receipt) => receipt.status === "processed");
  const failedReceipts = webhookReceipts.filter((receipt) => receipt.status === "failed");
  const ignoredReceipts = webhookReceipts.filter((receipt) => receipt.status === "ignored");
  const relevantBillingEvents = billingEvents.filter((event) =>
    [
      "webhook_billing_updated",
      "checkout_identity_review_required",
      "billing_update_blocked_pending_identity_review",
    ].includes(event.eventType)
  );

  const stripeEventIds = unique(stripeEvents.map((event) => event.id));
  const processedReceiptEventIds = new Set(processedReceipts.map((receipt) => receipt.eventId));
  const missingReceiptEventIds = stripeEventIds.filter((eventId) => !processedReceiptEventIds.has(eventId));

  if (!workspace) {
    blockers.push(`Workspace ${workspaceId} was not found from service-role Supabase access.`);
    nextActions.push("Confirm the workspace UUID is correct and that the proof lane is pointed at the intended production project.");
  }

  if (!stripeEvents.length) {
    blockers.push("No recent Stripe billing events matched this workspace, so webhook ingestion cannot be proven yet.");
    nextActions.push("Run or re-run the supervised checkout canary against the exact workspace before expecting webhook proof.");
  }

  if (stripeEvents.length && missingReceiptEventIds.length) {
    blockers.push(
      `Stripe produced ${missingReceiptEventIds.length} matching event(s) with no processed billing_webhook_receipts row: ${missingReceiptEventIds.join(", ")}.`
    );
    nextActions.push("Verify the Stripe webhook endpoint URL, signing secret, and Vercel deployment target before re-running the canary.");
  }

  if (stripeEvents.length && !relevantBillingEvents.length) {
    blockers.push("No recent billing_events evidence was written for the webhook lane, so application-side ingestion is still unproven.");
    nextActions.push("Inspect /api/billing/webhook logs and confirm billing_events insert permissions/schema are intact.");
  }

  if (workspace?.subscriptionStatus === "checkout_pending" && stripeEvents.length) {
    blockers.push("Workspace still reads checkout_pending even though recent Stripe events exist for this workspace.");
    nextActions.push("Inspect the latest webhook receipt and workspace update logs before treating activation as successful.");
  }

  if (failedReceipts.length) {
    blockers.push(`Found ${failedReceipts.length} failed billing_webhook_receipts row(s); the webhook lane needs remediation before saleable proof.`);
    nextActions.push("Review the failed receipt rows and corresponding deployment logs, then remediate before another paid canary.");
  }

  if (!nextActions.length && ignoredReceipts.length && !processedReceipts.length) {
    nextActions.push("If ignored receipts are expected, document the reason explicitly in the proof packet before calling the lane closed.");
  }

  const checks = [
    {
      key: "workspace_snapshot",
      ok: Boolean(workspace),
      detail: workspace
        ? `${workspace.name ?? "Workspace"} status=${workspace.subscriptionStatus ?? "n/a"} plan=${workspace.subscriptionPlan ?? "n/a"}`
        : `Workspace ${workspaceId} not found`,
    },
    {
      key: "stripe_events",
      ok: stripeEvents.length > 0,
      detail:
        stripeEvents.length > 0
          ? `${stripeEvents.length} matching Stripe event(s): ${stripeEvents.map((event) => `${event.type}:${event.id}`).join(", ")}`
          : "No matching Stripe events",
    },
    {
      key: "webhook_receipts",
      ok: stripeEvents.length === 0 ? false : missingReceiptEventIds.length === 0 && failedReceipts.length === 0,
      detail:
        webhookReceipts.length > 0
          ? `${processedReceipts.length} processed, ${ignoredReceipts.length} ignored, ${failedReceipts.length} failed receipt row(s)`
          : "No webhook receipts found",
    },
    {
      key: "billing_events",
      ok: relevantBillingEvents.length > 0,
      detail:
        relevantBillingEvents.length > 0
          ? `${relevantBillingEvents.length} relevant billing event(s): ${relevantBillingEvents.map((event) => event.eventType).join(", ")}`
          : "No recent webhook-related billing events found",
    },
  ];

  return {
    workspaceId,
    status: blockers.length ? "blocked" : "pass",
    blockers,
    nextActions: unique(nextActions),
    checks,
  };
}
