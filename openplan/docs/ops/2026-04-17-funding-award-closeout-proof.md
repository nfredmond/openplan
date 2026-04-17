---
title: OpenPlan funding-award closeout — live proof (T13)
date: 2026-04-17
head_sha: d7bfb8a (post-stale-mark-audit)
workspace_id: dd68626b-3462-4aa4-94ea-4840b2dae019
project_id: 73f7375b-a8b0-4a4a-9dfe-67f3a1066515
award_id: 345e47fd-b30d-4fdd-9d70-67f8c10084c8
---

# OpenPlan funding-award closeout live proof

Closes the evidence loop on T13 — promoting it off the retro's
"deferred, unit-only" list. Exercises both the **refused** (422) and
**accepted** (200) paths of `POST /api/funding-awards/<awardId>/closeout`
against the 2026-04-16 proof fixture.

## What T13 is supposed to do

1. POST `/api/funding-awards/<awardId>/closeout` with optional notes.
2. Route loads award + project access + linked `billing_invoice_records`.
3. Computes `paidAmount = sum(net_amount) where status='paid'`.
4. If `paidAmount < awardedAmount` → **422** with coverage breakdown,
   no mutation.
5. Otherwise:
   - `funding_awards.spending_status ← 'fully_spent'`
   - insert `project_milestones` row with
     `milestone_type='closeout'`, `phase_code='closeout'`,
     `status='complete'`.
   - `rebuildProjectRtpPosture()` refreshes `projects.rtp_posture`
     (reimbursement fields reflect the paid invoices).

## Fixture reuse

Pre-existing from the 2026-04-16 write-back proof:
- `funding_awards` id `345e47fd-...`, `awarded_amount=250000`,
  `spending_status='not_started'`, linked to project `73f7375b-...`.
- No `billing_invoice_records` seeded yet (zero rows for this award).

The proof script seeds exactly one paid invoice between phases A and
C to flip the coverage condition.

## Transcript

`openplan/rtp-closeout-proof.mjs` (new):

### Phase A — refused (422)

```
status = 422
body   = {
  "error": "Closeout requires 100% paid invoice coverage against the awarded amount",
  "coverage": {
    "awardedAmount": 250000,
    "paidAmount": 0,
    "outstandingAmount": 250000,
    "coverageRatio": 0
  }
}
```

No DB mutation on this path (verified by re-reading the award after
phase A).

### Phase B — seed one paid invoice

```
INSERT INTO billing_invoice_records (
  workspace_id, project_id, funding_award_id, invoice_number,
  consultant_name, billing_basis, status,
  period_start, period_end, invoice_date, due_date,
  amount, net_amount, supporting_docs_status,
  caltrans_posture, created_by, notes
) VALUES (
  'dd68626b-...', '73f7375b-...', '345e47fd-...',
  'PROOF-INV-2026-04-17-001', 'Nat Ford Planning (proof)',
  'lump_sum', 'paid',
  '2026-03-01', '2026-03-31', '2026-04-01', '2026-04-10',
  250000, 250000, 'complete',
  'local_agency_consulting', '44e09473-...',
  'Seeded for 2026-04-17 T13 closeout live-proof.'
);
-- invoice id: 2919eee0-709b-4cd0-aa65-e98cf245c720
```

### Phase C — accepted (200)

```
status = 200
body   = {
  "awardId": "345e47fd-...",
  "coverage": {
    "awardedAmount": 250000,
    "paidAmount": 250000,
    "outstandingAmount": 0,
    "coverageRatio": 1
  },
  "closedAt": "2026-04-17T07:41:17.853Z"
}
```

### Phase D — side-effect verification

```
funding_awards.spending_status = fully_spent
```

Latest closeout milestone:

```json
{
  "id": "df8eb673-1ead-491c-894a-668fafbafcf1",
  "title": "Closeout: Proof STP Award (write-back evidence)",
  "milestone_type": "closeout",
  "phase_code": "closeout",
  "status": "complete",
  "target_date": "2026-04-17",
  "actual_date": "2026-04-17",
  "summary": "2026-04-17 T13 live-proof closeout.",
  "funding_award_id": "345e47fd-..."
}
```

`projects.rtp_posture` after rebuild (key fields):

```json
{
  "reimbursementStatus": "paid",
  "reimbursementReason": "Linked award invoices marked paid now match or exceed the committed award total.",
  "remainingFundingGap": 0,
  "committedFundingAmount": 250000
}
```

## What this proves

- `/api/funding-awards/<awardId>/closeout` **refuses** under-covered
  closeouts with a structured coverage payload and zero mutation.
- It **accepts** fully-covered closeouts in a single atomic-ish
  sequence (award update → milestone insert → posture rebuild) and
  returns the coverage + closedAt to the caller.
- The downstream reader surfaces (project detail, reports, RTP cycle
  detail) will see `reimbursementStatus='paid'` on the same posture
  object the prior write-back proof exercised. That closes the
  "committed → obligated → reimbursed → closed" chain end-to-end.

## What this does NOT cover

- **Multi-invoice coverage.** The proof used one full-coverage
  invoice. Partial coverage (e.g., 2 invoices summing to the award)
  is exercised only by unit tests.
- **Retention math.** The proof uses `retention_percent=0`. Behavior
  with retention held back is unit-tested.
- **Milestone failure handling.** If the `project_milestones` insert
  fails, the route logs a warning but still returns 200 (the
  spending-status update is the critical write). This path was not
  exercised.
- **Re-grounded RTP cycle page re-render.** The project posture
  refreshed; the `/rtp/<cycleId>` re-render after closeout wasn't
  fetched in this proof. (Expected to continue working — same posture
  read path.)

## Script artifacts

- `openplan/rtp-closeout-proof.mjs` — this proof's driver.

## Fixture state after this proof

- `billing_invoice_records`: 1 row (id `2919eee0-...`).
- `funding_awards.spending_status`: `fully_spent`.
- `project_milestones` (with `milestone_type='closeout'`): 1 row.
- `projects.rtp_posture.reimbursementStatus`: `paid`.

These persist until someone runs `pnpm supabase db reset`; subsequent
T13 re-runs will hit the 422 path only if invoices are deleted, or
the positive path will idempotently succeed but create additional
closeout milestones.
