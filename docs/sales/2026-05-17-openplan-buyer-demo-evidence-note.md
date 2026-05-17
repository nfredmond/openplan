# OpenPlan Buyer Demo Evidence Note

**Date:** 2026-05-17 16:26–16:28 PDT  
**Production alias:** `https://openplan-natford.vercel.app`  
**Deployed commit checked:** `380e10982588`  
**Evidence posture:** Read-only buyer-demo rehearsal; no production writes, provisioning, schema changes, checkout/spend actions, outbound email, or secret-value printing.

## Executive status

OpenPlan is in a buyer-demo-safe posture for a **supervised proof-first walkthrough** of the current wedge:

1. **Command Center** establishes the proof-first handoff.
2. **Pilot Readiness** provides the evidence ledger and caveat context.
3. **Request Access** keeps intake reviewed-first and non-automatic.
4. **Examples** shows a completed validation artifact with caveats intact.

This evidence supports a supervised demo conversation. It does **not** support claims that OpenPlan is a complete self-serve municipal SaaS, legal/LAPM automation platform, autonomous AI planner, grant-award predictor, or validated behavioral forecasting product.

## Read-only production checks

### Production health

`curl -fsS https://openplan-natford.vercel.app/api/health`

Result:

```json
{"status":"ok","service":"openplan","deployment":{"commit":"380e10982588"},"checks":{"app":"ok","database":"not_checked","billing":"not_checked"}}
```

### Buyer-demo preflight

Command run from `openplan/openplan`:

```bash
npm run ops:check-buyer-demo-preflight -- --live-reads
```

Result: **passed**.

The preflight confirmed:

- sales/current buyer proof claim-boundary tests passed;
- pilot-readiness preflight returned `Status: OK`;
- production health returned OK;
- Vercel production deployment was `READY` at deployment `openplan-mjv70gnmd-natford.vercel.app`;
- deployed commit was `380e10982588`;
- run remained read-only and did not emit evidence-file writes.

## Timed buyer-demo rehearsal path

Browser profile: authenticated QA workspace.  
Account/workspace label visible in app shell: `openplan-proof-qa-20260406204637`.

| Step | URL | Observed load duration | Result |
| --- | --- | ---: | --- |
| 1 | `/command-center` | ~2.98s | Passed |
| 2 | `/admin/pilot-readiness` | ~1.51s | Passed |
| 3 | `/request-access` | ~0.79s | Passed |
| 4 | `/examples` | ~0.59s | Passed |

### Step 1 — Command Center

Confirmed in production:

- page title: `Command Center · OpenPlan · OpenPlan`;
- proof-first line present: `Run the buyer demo from proof, then intake, then examples.`;
- handoff boundary present: `No production writes, provisioning, outbound email, checkout, or self-serve activation are implied by this handoff.`;
- stop rule present: `Stop the demo if live-read preflight reports unresolved attention...`;
- handoff links present for readiness packet, request access, and examples.

### Step 2 — Pilot Readiness

Confirmed in production:

- page title: `Pilot Readiness Evidence Center | OpenPlan Admin · OpenPlan`;
- evidence ledger visible;
- read-only preflight guidance visible;
- buyer reliance and caveat language visible;
- no guaranteed/instant/automatic approval claim observed.

Representative headings observed:

- `Pilot readiness evidence ledger`
- `Run a read-only preflight before outward reliance`
- `How to use this evidence center without overclaiming readiness`
- `Current packet docs, static exports, and preflight proof`

### Step 3 — Request Access

Confirmed in production:

- page title: `Request services review: self-hosting, hosting, implementation · OpenPlan`;
- reviewed-first posture visible;
- request explicitly starts an internal intake record, not a live workspace, hosted subscription, or service commitment;
- form submission copy says it does not create an account, hosted workspace, subscription, or services contract;
- payment setup remains separate;
- no checkout-now / buy-now / start-subscription claim observed.

Representative boundary copy observed:

> A request starts an internal review record, not a live workspace, hosted subscription, or service commitment.

> Submitting creates an internal intake record only; it does not create an account, hosted workspace, subscription, or services contract.

### Step 4 — Examples

Confirmed in production:

- page title: `Evidence catalog: screening proof with caveats intact · OpenPlan`;
- examples page says `One completed run, verbatim`;
- old phrase `One live run, verbatim` is absent;
- page states it is `not a guarantee of current runtime state`;
- supervised access path remains visible;
- caveat language is prominent.

## Friction observed

No blocking friction was found in this proof-first path.

Minor operator note: the demo workspace has a clean proof/readiness surface, but the signed-in Command Center still shows mostly zero operational counts. That is acceptable for a proof-first buyer conversation, but the next product substance lane should make a demo workspace carry a realistic rural RTPA/county story so operators are not presenting an empty queue after the proof boundary is established.

## Safe claims for external demo

Use language like:

- OpenPlan has a deployed, smoke-tested proof-first buyer-demo path.
- The current buyer-demo path is supervised and guarded by preflight checks, caveat language, and no-write/no-checkout boundaries.
- The examples page shows a completed validation artifact with caveats intact.
- Nat Ford can offer implementation, hosting/admin, onboarding, support, and planning services around the Apache-2.0 OpenPlan core.

## Claims to avoid

Do **not** claim:

- instant self-serve customer activation;
- automatic workspace provisioning from request access;
- live/real-time validation from the static examples artifact;
- legal-grade LAPM/compliance automation;
- validated behavioral forecasting or certified calibration;
- autonomous AI planning;
- guaranteed grant awards or eligibility determinations;
- production billing/checkout proof from this rehearsal.

## Next recommended lane

Move from proof surfaces to **demo workspace substance**:

- create a read-only/semi-static rural RTPA or county demo story that gives Command Center meaningful project/report/funding cues;
- keep it clearly labeled as demo/sample context;
- avoid mutating production data unless and until a supervised provisioning/demo-data plan is approved.
