# OpenPlan Operator Remediation Packet — 2026-04-06

**Owner:** Bartholomew Hale (COO)  
**Purpose:** convert the remaining production billing/proof blockers into an executable closure packet with exact commands, exact evidence expectations, and no fake certainty.

## Executive summary
OpenPlan is not blocked by broad product ambiguity anymore. It is blocked by a short list of production-ops truths that must be closed cleanly:

1. the proof lane needs a usable production `SUPABASE_SERVICE_ROLE_KEY`,
2. Stripe must be pointed at the canonical webhook endpoint for the live alias,
3. the supervised canary must be re-run against a dedicated workspace,
4. webhook ingestion must be re-proven with read-only evidence after the canary,
5. and the resulting evidence must be attached to the release packet without overclaiming.

This packet is meant to shorten the distance from “we think billing should work” to “we can honestly show the proof lane is runnable.”

## What changed in the repo for this packet
### 1. Unsafe webhook script replaced with a read-only proof tool
`openplan/scripts/verify-webhook-ingestion.ts` used to mutate a random workspace. That was operator-hostile and unsuitable for production proof.

It is now a **read-only** Stripe → webhook → Supabase proof checker.

New behavior:
- requires an explicit `--workspace-id`,
- optionally filters by `--email`,
- loads env from an explicit file or the standard proof locations,
- checks recent Stripe events,
- checks `billing_webhook_receipts`,
- checks `billing_events`,
- checks current workspace billing state,
- exits `0` only when the ingestion lane is coherent,
- exits `2` when blockers remain.

### 2. New npm entrypoint
From `openplan/openplan`:

```bash
npm run ops:webhook-proof -- --workspace-id <workspace-uuid> --since-minutes 240 --env-file /tmp/openplan.vercel.env
```

This should now be the standard read-only webhook-proof command after any supervised billing canary.

### 3. Canary preflight summary now separates “env file loaded” from “proof-capable env posture”
Previously, an operator could see that the env snapshot loaded and still miss that the pulled file was not actually proof-capable because the service-role key was blank.

The preflight summary now breaks this out explicitly:
- env snapshot file loaded,
- core env posture present,
- service-role proof posture present.

That reduces the chance of reading a partially loaded env as a green light.

## Exact operator closure sequence

### Phase A — restore the missing proof prerequisite
**Goal:** make the proof lane capable of taking truthful snapshots again.

#### Required human/operator action
Restore a valid production `SUPABASE_SERVICE_ROLE_KEY` to the intended proof lane.

That means one of the following must become true:
- the production Vercel env for `natford/openplan` again exposes a valid `SUPABASE_SERVICE_ROLE_KEY`, or
- the proof operator explicitly provides a valid equivalent env file for the run.

#### Verify immediately after restoration
From repo root:

```bash
cd openplan
vercel env pull /tmp/openplan.vercel.env --environment=production -y
```

Then confirm the pulled env now contains a non-empty service-role key before proceeding.

**Abort if still blank.** Do not attempt to call the billing proof lane “rerunnable” without this prerequisite.

---

### Phase B — verify the live Stripe webhook target
**Goal:** confirm Stripe is actually aimed at the canonical deployment.

Canonical expected endpoint:

```text
https://openplan-natford.vercel.app/api/billing/webhook
```

Required event coverage:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

#### Operator check
Run the preflight (below) or inspect Stripe directly and confirm the exact endpoint is enabled.

**If Stripe is pointed somewhere else:** fix the endpoint before any paid canary rerun.

---

### Phase C — run the preflight on the exact canary workspace
**Goal:** prove env, alias, price, webhook posture, and workspace evidence before touching money.

From `openplan/openplan`:

```bash
./scripts/openplan-supervised-paid-canary-preflight.sh \
  --workspace-id <workspace-uuid> \
  --billing-email <approved-operator-email> \
  --env-file /tmp/openplan.vercel.env \
  --since-minutes 240
```

If the canonical alias is under Vercel deployment protection and the operator has the legitimate automation bypass secret, provide it explicitly so preflight can tell the difference between “protected but runnable” and “blocked by protection”:

```bash
./scripts/openplan-supervised-paid-canary-preflight.sh \
  --workspace-id <workspace-uuid> \
  --billing-email <approved-operator-email> \
  --env-file /tmp/openplan.vercel.env \
  --since-minutes 240 \
  --vercel-protection-bypass-secret "$OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET"
```

#### Preflight must show all of the following
1. env snapshot loaded,
2. canonical alias/browser proof route reachable in the current proof mode,
3. Starter price valid,
4. canonical Stripe webhook endpoint valid,
5. production workspace snapshot captured,
6. current monitor snapshot captured.

The preflight summary now classifies alias posture explicitly:
- `open` → alias responded without deployment protection bypass,
- `protected` + `effective proof mode: bypass-header` → alias is protected but proof automation is legitimately runnable with the supplied bypass secret,
- `protected` + `effective proof mode: none` → stop and remediate before checkout.

**If any item is NO, stop there.** Remediate that item before any supervised checkout.

---

### Phase D — run the supervised canary
**Goal:** generate a fresh Stripe event against the intended dedicated workspace.

Use the exact billing route emitted by preflight. Do not improvise a different workspace midstream.

Example route shape:

```text
https://openplan-natford.vercel.app/billing?workspaceId=<workspace-uuid>
```

During execution, run the monitor command emitted by preflight in a separate terminal.

---

### Phase E — re-prove webhook ingestion with the new read-only checker
**Goal:** confirm Stripe event → webhook receipt → billing event → workspace state all line up.

From `openplan/openplan`:

```bash
npm run ops:webhook-proof -- \
  --workspace-id <workspace-uuid> \
  --email <approved-operator-email> \
  --since-minutes 240 \
  --env-file /tmp/openplan.vercel.env
```

Optional JSON capture for the packet:

```bash
npm run ops:webhook-proof -- \
  --workspace-id <workspace-uuid> \
  --email <approved-operator-email> \
  --since-minutes 240 \
  --env-file /tmp/openplan.vercel.env \
  --json > ../docs/ops/2026-04-06-test-output/webhook-proof-<workspace-uuid>.json
```

#### PASS criteria
The command exits `0` and reports:
- matching recent Stripe event(s),
- processed `billing_webhook_receipts` rows for those events,
- recent webhook-related `billing_events`,
- and a workspace no longer stranded in `checkout_pending`.

#### HOLD criteria
Treat the lane as still blocked if the command reports any blocker, especially:
- no matching Stripe events,
- Stripe events without processed receipts,
- failed receipt rows,
- no `billing_events` evidence,
- or a workspace still stuck in `checkout_pending`.

---

### Phase F — assemble the refreshed proof packet
Attach or update all relevant evidence under `docs/ops/`:
- preflight summary,
- monitor snapshot,
- webhook-proof output,
- authenticated smoke / billing notes if rerun,
- cleanup evidence if QA residue was created.

Then update the approval/governance packet with exact truth language:
- **safe:** “the supervised canary and webhook ingestion lane were freshly re-proven”
- **unsafe:** “billing is universally closed forever”

## Operator checklist
- [ ] Valid production `SUPABASE_SERVICE_ROLE_KEY` restored to the proof lane.
- [ ] `vercel env pull` shows the key is no longer blank.
- [ ] Stripe endpoint points to `https://openplan-natford.vercel.app/api/billing/webhook`.
- [ ] Preflight returns no blockers.
- [ ] If the alias is Vercel-protected, the packet records whether proof used a bypass secret or an intentionally authenticated browser session.
- [ ] Supervised canary run executed against the dedicated QA workspace.
- [ ] `npm run ops:webhook-proof` returns exit code `0`.
- [ ] Evidence files stored under `docs/ops/`.
- [ ] Cleanup performed if production QA residue was created.
- [ ] Final client/commercial language remains evidence-accurate.

## Honest current status after this packet
### What is now better
- The repo has a safer and more deterministic webhook-proof tool.
- The canary preflight now distinguishes a genuinely reachable alias from a Vercel-protected alias and can validate a legitimate bypass-secret path when supplied.
- The operator path is more explicit.
- The remaining blockers are now concrete and commandable instead of vague.

### What still requires human/operator action
- restoring the missing service-role proof prerequisite,
- confirming/correcting the live Stripe webhook endpoint,
- running the supervised canary,
- and capturing fresh evidence.

## Bottom line
The proof lane is **not yet freshly closed**, but it is now **operationally much more runnable**.

The remaining work is no longer “figure out what OpenPlan is.” It is:
- restore one missing production proof dependency,
- confirm the live webhook target,
- run the canary,
- and re-prove the lane with the new read-only checker.
