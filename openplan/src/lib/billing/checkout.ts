import Stripe from "stripe";

export type CheckoutPlan = "starter" | "professional";

type CreateCheckoutSessionInput = {
  workspaceId: string;
  plan: CheckoutPlan;
  initiatedByUserId: string;
  initiatedByUserEmail?: string | null;
  existingStripeCustomerId?: string | null;
  origin: string;
};

type CheckoutSessionResult = {
  id: string;
  url: string;
};

function stripeSecretKey(): string {
  const secretKey = process.env.OPENPLAN_STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY;
  if (!secretKey?.trim()) {
    throw new Error("Missing Stripe secret key configuration");
  }

  return secretKey.trim();
}

function stripePriceIdForPlan(plan: CheckoutPlan): string {
  const priceId =
    plan === "starter"
      ? process.env.OPENPLAN_STRIPE_PRICE_ID_STARTER
      : process.env.OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL;

  if (!priceId?.trim()) {
    throw new Error(`Missing Stripe price ID for ${plan} plan`);
  }

  return priceId.trim();
}

function defaultSuccessUrl(origin: string, plan: CheckoutPlan): string {
  return `${origin}/dashboard/billing?checkout=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`;
}

function defaultCancelUrl(origin: string, plan: CheckoutPlan): string {
  return `${origin}/dashboard/billing?checkout=cancel&plan=${plan}`;
}

export async function createStripeCheckoutSession({
  workspaceId,
  plan,
  initiatedByUserId,
  initiatedByUserEmail,
  existingStripeCustomerId,
  origin,
}: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
  const stripe = new Stripe(stripeSecretKey());
  const priceId = stripePriceIdForPlan(plan);

  const metadata = {
    workspaceId,
    plan,
    initiatedByUserId,
  };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: defaultSuccessUrl(origin, plan),
    cancel_url: defaultCancelUrl(origin, plan),
    client_reference_id: workspaceId,
    metadata,
    subscription_data: { metadata },
    customer: existingStripeCustomerId?.trim() || undefined,
    customer_email: existingStripeCustomerId ? undefined : initiatedByUserEmail?.trim() || undefined,
  });

  if (!session.url) {
    throw new Error("Stripe checkout session did not include redirect URL");
  }

  return {
    id: session.id,
    url: session.url,
  };
}
