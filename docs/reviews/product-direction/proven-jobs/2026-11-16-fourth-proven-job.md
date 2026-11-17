# Fourth proven job: a grant award taken to a reimbursement record, DRAFT

**Draft for the lead.** The agent lead (Fable 5.2) chose this job on November
16, 2026 (candidate C3 of the November 14 research). Lane 84 (Opus 5.5,
agent) ran it by hand on a local build in three places, read the federal rule
and the two programs' procedures, and wrote this draft. No person made or
reviewed any of it. Agent-run checks are the acceptance evidence, and this note
asks no person for anything. The lead decides every rule below and makes the
note final; nothing here is a definition entry, a checker rule or a record.
Rules marked **(not checked on screen)** were not seen working in the
run-through, because the product cannot do them yet or the lane did not reach
them.

**State on November 16, 2026.** Not provable today. On a local build an
agent can record an award, its obligation date, invoices and two reimbursement
requests, download a worksheet whose totals equal the typed amounts, and be
refused by a second workspace. It cannot reject or resubmit a request on
screen, cannot close an award that finishes under its ceiling, and the close-out
gate can be written around at the database. The blockers are listed below with
their known-issue rows.

## The job

Job id (proposed): `grant-award-to-reimbursement-record-in-three-places`.

After an award, a planner records the award against a tracked funding
opportunity and a project, records when the award must be obligated, logs the
agency's reimbursement requests (invoices to the funder), moves them through
review, submission, approval and payment, records a rejected request and its
resubmission, downloads the reimbursement worksheet PDF, and closes the award
out with its remaining balance stated. A finance officer receives the
worksheet and a close-out reconciliation.

The run is a demonstration. The award, the amounts and the invoices are
demonstration figures typed by an agent, labeled on the award "Demonstration by
an automated OpenPlan proof run". No real agency, tribe or award is named as
having received or claimed anything.

## The three places

Any states. The run-through used, and the proof should use, three different
reimbursement profiles so the worksheet's process words are tested in each:

| Place kind | Run-through place | Why |
|---|---|---|
| County | Plumas County, CA (06063) | California resolves the Caltrans LAPM profile, the deepest one. |
| City | Klamath Falls, OR (4139700) | A state with no profile of its own resolves the generic US federal-aid profile. |
| Census tribal area | Pine Ridge Reservation, NE-SD (2810R) | A place that crosses two states and records no state; resolves the generic profile. |

Each place gets its own workspace and account, with the workspace's "where you
work" set to the place and a time zone set (America/Los_Angeles,
America/Los_Angeles, America/Denver).

## What each journey does

1. Sign up and confirm by email; set the workspace place and time zone on
   Workspace setup.
2. Create the project and set its study place to the same place.
3. Track Safe Streets and Roads for All (SS4A) from the Grants catalog for the
   project. (SS4A is open to counties, cities and tribes. The catalog has no
   tribal program, KI-2026-11-16-144.)
4. Record the award on the project's Funding tab: awarded $200,000.00, local
   match $50,000.00 (partial), spending status active, obligation due
   March 31, 2026, 5:00 PM, the demonstration label in the title and notes.
5. Complete the obligation milestone on the Delivery tab **with its date**
   (not checked on screen: no date can be entered, KI-2026-11-16-140).
6. Log INV-1, $60,000.00, and move it draft, internal review, submitted,
   approved for payment, paid.
7. Log INV-2, $45,000.00, submit it, and **mark it rejected on screen with a
   reason** (not checked on screen: no control, KI-2026-11-16-135; the
   run-through used the route).
8. **Resubmit INV-2 as INV-2A**, $45,000.00, linked to INV-2 (not checked on
   screen: no resubmit path or link, KI-2026-11-16-135), submit it.
9. Read every money figure on the Funding tab, Grants (Awards), Invoices &
   Reimbursements and the dashboard, and download the worksheet.
10. Approve and pay INV-2A; download the final worksheet.
11. **Close the award out with $95,000.00 remaining stated** (not checked on
    screen: refused, KL-2026-09-04-024 and KI-2026-11-16-130).
12. Refusals: a member account and a second workspace's account try each
    action; the journey records each status.
13. Accessibility, console and width checks on each screen the job uses.

Every amount is chosen before the run and written in the journey, so every
total checks by hand: claimed $105,000.00 (INV-1 and INV-2A), paid $60,000.00
then $105,000.00, outstanding $45,000.00 then $0.00, rejected $45,000.00,
remaining $95,000.00.

## What the record must hold, per place

- The hosted commit and version from the health readback, the place's label,
  kind and Census id as the product returned them, and the workspace's resolved
  reimbursement profile id.
- The award's id, title with the demonstration label, ceiling, match, posture
  and obligation date as the product echoed them on creation.
- Each invoice's id, number, gross, retention, net, status history (every
  status the route answered, in order) and date; the rejection reason and the
  resubmission link once they exist.
- The worksheet PDF (both downloads), its SHA-256 and its `pdftotext -layout`
  text, and the close-out answer (status and body).
- For each screen: the figures read from it, screenshots at 1440 and 390 px,
  axe results light and dark, console errors and sideways scroll.
- The refusals table: action, account, status received.

## What the checker would read and recompute

From the record's own invoice entries, never from the product's totals:

- Claimed gross = sum of gross over `internal_review`, `submitted`,
  `approved_for_payment` and `paid`; paid = sum of net over `paid`;
  outstanding = claimed and not paid, net; rejected = sum of gross over
  `rejected`; remaining = ceiling minus claimed gross, not clamped. These are
  the product's own partitions (`drawdown-ledger.ts`), and the checker's
  definition must tie each status list to the product's constant
  (`CLAIMED_INVOICE_STATUSES`) with a test.
- From the worksheet text, each of: "Recorded award ceiling", "Claimed to date
  (gross)", "Paid to date (net of retention)", "Claimed and not yet paid
  (net)", "Remaining against recorded award ceiling", "Rejected by the funder
  (gross)", "Local match recorded on the award", each followed by its amount.
  Every amount must equal the recomputed figure to the cent. The rule must not
  depend on a line wrap: in the run-through the label and amount sat on
  different lines for some rows.
- Each invoice row's number, status and gross appear in the worksheet's
  invoice table.
- The worksheet says it is not a funder's form: "It is not a funder's form and
  carries no form or revision number" on page 1 and in each page's footer, and
  names no form it does not implement (SF-270, SF-271, SF-425, LAPM 5-A).
- No money figure prints "$0.00" for a fact the record shows as not entered:
  the match prints "Not recorded" when none was entered.
- The screen figures read in step 9 equal the recomputed figures.
- The close-out answer states the remaining balance and equals ceiling minus
  paid (not checked on screen: refused today).

## Who may do what (as seen locally)

| Action | Owner | Member | Second workspace |
|---|---|---|---|
| Open the project's Funding tab | 200 | 200 | 404 |
| Record an award | 201 | 201 | 404 "Project not found" |
| Log a request | 201 | 403 | 403 |
| Approve or mark paid | 200 | 403 | 403 |
| Close out (route) | 422 coverage | 422 coverage (authorized) | 404 |
| Download the worksheet | 200 | 200 | 404 |
| Write the invoice table directly (PostgREST) | not tried | 0 rows | 0 rows |
| Write `funding_awards` closure columns directly (awards with no handoff revision; a trigger guards awards that have one) | **accepted** (KI-2026-11-16-134) | **accepted** | 0 rows |

The lead decides whether a member may close out an award. Today the route
allows it by design (`programs.write`, the comment in
`funding-awards/[awardId]/route.ts` explains why), while only owners and admins
may write requests.

## What a proof is not

- Not a payment request. Recipients other than states must request payment on
  OMB-approved forms (2 CFR 200.305(b)); the government-wide forms are SF-270
  and SF-271. Caltrans accepts only LAPM 5-A and "no longer accepts invoices
  created by LPAs" (LAPM 5.5, January 2026). The worksheet is supporting work.
- Not a statement that any cost is allowable or eligible (2 CFR 200.403), that a
  cost falls after obligation, authorization or allocation, or that a balance is
  released or deobligated (2 CFR 200.344(e), (f)).
- Not an accounting or audit record. "Paid" is what the workspace typed; no
  payment date or funder reference is recorded (KI-2026-11-16-136).
- Not a real award. No agency, tribe or program officer took part.

## Blockers, most serious first

| Blocker | Row | Smallest design | Needs |
|---|---|---|---|
| An award that finishes under its ceiling cannot be closed; an over-claimed award with open requests can | KL-2026-09-04-024, KI-2026-11-16-130 | Refuse close-out while any request is open or paid exceeds the ceiling without a basis; add a reconciled close-out with the remaining balance stated | Migration (closure CHECK) for the reconciled close-out |
| The close-out can be written straight to the database | KI-2026-11-16-134 | Trigger refusing closure columns except through a SECURITY DEFINER close-out function | Migration |
| No on-screen reject; no resubmit link | KI-2026-11-16-135 | "Mark rejected" with reason; "Resubmit" prefilled with number plus "A"; `resubmits_invoice_id`, `rejection_reason` | Migration for the link |
| The Funding tab sums money from six rows | KI-2026-11-16-132 | Use the count-checked award read; withhold on mismatch | Code |
| Nothing stops claims above the award | KI-2026-11-16-131 | Refuse a claimed move above the ceiling without a note | Code |
| Status moves are unconstrained; paid with no approval | KI-2026-11-16-137 | Transition trigger | Migration |
| No obligated, authorized or allocated date | KI-2026-11-16-139 | `funding_awards.obligated_on`, warning, worksheet line | Migration |
| No payment date | KI-2026-11-16-136 | `billing_invoice_records.paid_date` | Migration |
| Duplicate numbers, $0 requests | KI-2026-11-16-138 | Unique index; amount above zero | Migration |
| Obligation milestone completion has no date and leaves "Overdue" | KI-2026-11-16-140 | Date on completion; scan reads it | Code |
| Status buttons hidden on Grants, five rows | KI-2026-11-16-141 | Control on every register row | Code |
| Portfolio "Uninvoiced" nets across awards | KI-2026-11-16-133 | Per-award sum | Code |
| Warning badge contrast, unlabeled scan figure, no tribal program | KI-2026-11-16-142 to -144 | As in each row | Code, catalog |

One hosted migration window could carry KI-2026-11-16-134, -135, -136, -137,
-138 and -139 and the reconciled close-out together; each is additive.

## Not established

- Whether the hosted `contract-calculations` worker is needed: no worker ran in
  the run-through and every figure appeared, because the ledger and worksheet
  compute in the request. Whether hosted output differs was not checked.
- What SS4A recipients use to request payment, and whether it is SF-270: DOT's
  SS4A pages answered 403 to every request (see the run-through's program facts).
- The fields of LAPM 5-A, which is served by a form renderer.
- Screen-reader behaviour; hosted behaviour; retention other than 0 percent.
