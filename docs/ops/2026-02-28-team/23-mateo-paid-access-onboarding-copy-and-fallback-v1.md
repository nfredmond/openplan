# Paid-Access Provisioning — Purchaser Onboarding Copy + Delayed Entitlement Fallback (v1)

Date (PT): 2026-02-28  
Owner: Mateo Ruiz (Assistant Planner)  
Source tracker: `21-paid-access-provisioning-execution-tracker.md`

## Purpose
Provide purchaser-facing onboarding language that:
1) ties access to the **purchaser email** and **target workspace**, and  
2) gives a clear fallback path when billing succeeds but entitlement visibility is delayed.

---

## A) Onboarding Copy Block (customer-facing)

### 1) Checkout Success Screen
**Header:** Payment received — let’s finish your setup  
**Body:** Your purchase is linked to the email used at checkout: **{{purchaser_email}}**.  
To activate access, sign in (or create your account) using this same email, then open workspace **{{workspace_name}}**.  
Most activations complete within a few minutes.

**Primary CTA:** Continue to sign in  
**Secondary CTA:** I used a different email

**Small note:** If your access does not appear after a few minutes, use “Refresh access” from Billing, or contact support with your receipt email.

---

### 2) Purchase Confirmation Email
**Subject:** Your OpenPlan purchase is confirmed — next steps to activate access

**Body copy:**
Hi {{customer_first_name}},

Thanks for your purchase of **{{plan_name}}**.

Your paid access is tied to:
- Purchaser email: **{{purchaser_email}}**
- Workspace: **{{workspace_name}}**

**Next steps**
1. Sign in (or create your account) using **{{purchaser_email}}**.
2. Open workspace **{{workspace_name}}**.
3. Confirm your plan under **Billing > Subscription**.

If you do not see access within a few minutes, click **Refresh access** in Billing first. If it still does not appear, reply to this email and include:
- receipt ID: **{{receipt_id}}**
- purchaser email used at checkout
- workspace name

We’ll resolve entitlement visibility quickly.

Thanks,  
OpenPlan Support

---

### 3) First-Login Instruction Panel (in app)
**Title:** Activate your purchased access

**Copy:**
We found a recent purchase for **{{purchaser_email}}**.
To complete activation:
- confirm you are signed in as **{{signed_in_email}}**
- open workspace **{{workspace_name}}**
- verify **{{plan_name}}** in Billing

If **{{signed_in_email}}** does not match the purchaser email, choose one:
- switch to purchaser email account, or
- request manual ownership review

**CTAs:**
- Refresh access
- Switch account
- Request review

---

### 4) Email-Mismatch Guidance (customer-safe)
**Message:**
Your payment was successful, but the signed-in email does not match the purchaser email used at checkout.
For account safety, we need to verify workspace ownership before granting paid access.

**What you can do now:**
- sign in with the purchaser email, or
- submit a quick ownership review request

---

## B) Delayed Entitlement Fallback Script (support use)

### 1) Customer Reply Script (fast response)
Hi {{customer_first_name}},

Thanks for your message — I can confirm your payment was received.
Sometimes entitlement visibility is delayed briefly while billing and workspace records finish syncing.

Please try this first:
1. Sign in with the purchaser email used at checkout: **{{purchaser_email}}**
2. Open workspace: **{{workspace_name}}**
3. Go to **Billing > Subscription** and click **Refresh access**

If access still doesn’t appear after 5–10 minutes, reply with:
- receipt ID / Stripe payment ID
- purchaser email used at checkout
- workspace name
- screenshot of Billing > Subscription

We’ll complete a manual provisioning review right away.

---

### 2) Internal Escalation Script (support -> engineering)
**Subject:** Entitlement visibility delay — manual review requested

**Include fields:**
- Receipt/payment ID: {{payment_id}}
- Purchaser email: {{purchaser_email}}
- Signed-in email: {{signed_in_email}}
- Workspace ID/name: {{workspace_id}} / {{workspace_name}}
- Current billing status in DB: {{subscription_status}}
- Stripe customer/subscription IDs: {{stripe_customer_id}} / {{stripe_subscription_id}}
- Webhook event IDs observed: {{event_ids}}
- Repro time window (PT): {{time_window}}

**Action request:**
Validate purchaser-email/workspace binding, replay safe provisioning path if needed, and confirm final entitlement state.

---

### 3) Customer Closeout Script (after fix)
Hi {{customer_first_name}},

Your paid access is now active for workspace **{{workspace_name}}** under **{{purchaser_email}}**.
Please refresh and confirm plan status in **Billing > Subscription**.

If anything still looks off, reply here and we’ll stay with you until it’s fully resolved.

---

## C) Handoff Note (for Iris + Camila + Elena)

### Implementation placement (Iris)
- Add copy to:
  1) checkout success view,
  2) purchase confirmation email template,
  3) first-login entitlement panel,
  4) mismatch warning state,
  5) delayed-entitlement support macro.
- Ensure template variables are wired: purchaser email, workspace name/ID, receipt/payment IDs, signed-in email.

### UX/content checks (Camila)
- Keep first-step instructions above the fold.
- Avoid jargon (use “purchaser email” consistently).
- Ensure mismatch state reads as safety verification, not payment failure.

### Governance/checkpoint (Elena)
- Pair with QA HOLD items in `22-paid-access-provisioning-qa-gate-checklist.md`:
  - purchaser-email mismatch handling,
  - replay policy clarity.
- Use this copy block as canonical message set for tonight’s paid-access lane.

---

## Status for tracker
- Mateo deliverable complete: onboarding copy + fallback support script + handoff note.
