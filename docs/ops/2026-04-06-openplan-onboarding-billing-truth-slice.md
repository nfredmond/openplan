# OpenPlan Onboarding + Billing Truth Slice — 2026-04-06

**Owner:** Bartholomew Hale (COO)  
**Scope:** public pricing truth, sign-up handoff clarity, first-success sign-in guidance  
**Status:** shipped in repo; validate with local test/build gate before treating as complete

## Why this slice existed
OpenPlan had a narrow but real saleability gap between public packaging and first-run product behavior:

1. the public pricing page still said Stripe checkout wiring was "in progress," even though the app now has a real explicit checkout launcher and workspace billing-selection flow;
2. pricing CTAs dropped users into generic sign-up with no plan context carried forward;
3. sign-up redirected to `sign-in?created=1`, but the sign-in page did not actually explain what to do next.

That combination was survivable for internal operators, but sloppy for a truthful early-access buyer path.

## What changed
### Public pricing surface
- Reframed pricing as **OpenPlan Early Access Pricing** rather than broad-launch language.
- Changed plan CTAs to explicit account-creation actions.
- Carried plan intent into sign-up via query params (`/sign-up?plan=starter|professional`).
- Replaced the stale "wiring is in progress" note with the current truth:
  - account creation first,
  - sign-in second,
  - explicit workspace billing selection third,
  - Stripe return alone does not equal activation.

### Sign-up handoff
- Sign-up now reads plan intent from the query string when present.
- The page tells the user this step creates the login only; workspace targeting and billing happen after sign-in.
- After successful sign-up, the redirect to sign-in now preserves selected plan context.

### First-success sign-in guidance
- Sign-in now recognizes `created=1` and surfaces a real next-step checklist.
- The message tells the user to:
  1. sign in,
  2. create or open the correct workspace,
  3. launch billing only from the correct workspace context.
- Sign-in also preserves selected plan context on the “Create an account” link for continuity.

## Why this matters
This slice does not pretend OpenPlan is broad self-serve. It does make the early-access path more truthful and less operator-dependent.

Specifically, it reduces three avoidable sources of confusion:
- plan intent disappearing between pricing and auth,
- account creation being mistaken for paid activation,
- users landing on sign-in with no first-success instructions.

## Acceptance evidence to validate locally
- pricing page renders plan-scoped sign-up links;
- pricing page no longer claims checkout wiring is merely "in progress";
- sign-in shows first-success guidance when loaded with `created=1`;
- tests added for pricing and sign-in guidance behavior.

## Remaining bounded gap
This slice improves **truth and onboarding clarity**. It does **not** by itself re-prove live production checkout, webhook activation, or full new-buyer end-to-end smoke. Those remain separate proof lanes.

## April 6 follow-through added in the same wave
A second billing-support hardening pass now complements the onboarding truth slice:
- `/billing` now derives a clearer support state from workspace status plus recent billing events,
- Stripe-return-without-webhook-confirmation now surfaces as an explicit unresolved state instead of vague pending language,
- generic `checkout_pending` and inactive/past-due states now tell the operator what to verify next.

Fresh production-truth findings from the same date are recorded separately in:
- `docs/ops/2026-04-06-openplan-production-billing-truth-refresh.md`

That follow-through matters because onboarding truth alone is not enough; the in-app billing surface also needs to tell the truth when activation is still unresolved.
