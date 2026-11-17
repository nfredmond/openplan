# Fourth proven job: a grant award taken to a reimbursement record

**Decision record.** The agent lead (Fable 5.2) chose this job on November
16, 2026 (candidate C3 of the November 14 research). Lane 84 ran it by hand
on a local build in three places and drafted this note. Lanes 89 and 90 made
the product changes the draft asked for (PRs 517 and 518). The Opus 5.5 lead
decided the job's rules on November 17, 2026, at 06:55Z
(`PLAN_PJ4_2026-11-16.md` in the lead's state folder). Lane 93 (Opus 5.5,
agent) wrote this final note, the definition entry and the checker rules from
those rules. No person made or reviewed any of it. Agent-run checks are the
acceptance evidence, and this note asks no person for anything.

**State on November 17, 2026.** Defined, not run. The definition entry
`grant-award-to-reimbursement-record-in-three-places` is in
`schemas/proven_job_definitions.v1.json`, its record fields are the
`awardJourney` sub-schema, and `openplan/scripts/ops/capability-evidence.mjs`
checks a record against it. A synthetic example record is accepted and every
rule refuses a copy changed against it. A fresh-context false-record review
(review 97) found copies the first version accepted; lane 93 closed them
(amounts outside the read rows, custody status and code pairs, payment and
blank dates, a California city, form titles and seven wordings, phrases
across a page break, reading times) and added the who-acted limit. No journey
script, hosted run or record exists. The colour-contrast findings below the
first view that would have refused an honest record (KI-2026-11-17-032) are
marked fixed by lane 96 (PR 520); lane 93 did not measure the screens.

## The job

After an award, a planner records it against a funding opportunity tracked
from the catalog and a project, with its obligation date. The planner logs
reimbursement requests, moves them through review, submission, approval and
payment, records a rejected request and its resubmission, downloads the
reimbursement worksheet PDF before and after close-out, and closes the award
out with its remaining balance released. A finance officer receives the
worksheet.

The run is a demonstration. The award title and the project name carry the
words "Demonstration by an automated OpenPlan proof run". No real agency,
tribe or award is named as having received or claimed anything.

## The three places

Each place is chosen so that the worksheet's process words are tested under a
different reimbursement profile.

| Role | Place rule | Profile the workspace must resolve | Why |
|---|---|---|---|
| County | A county in California (FIPS 06), label ending ", CA" | Caltrans LAPM reimbursement (`us_ca_lapm_reimbursement_v1`) | California is the one state with a profile of its own. |
| City | An incorporated place (not a CDP) in a state with no profile of its own | US federal-aid reimbursement, generic (`us_federal_generic_reimbursement_v1`) | The generic profile is matched by country. |
| Tribal area | A Census tribal area listed in at least two states | The generic profile | The place records no single state, so only the country matches. |

Each profile must be bound as `jurisdiction_matched`: the workspace's own
place chose it. An interim default means the place was not set, and the
worksheet then says "This process was not chosen for this workspace." Both
refuse the record. The city may not lie in a state the profile registry
gives a profile of its own (today California, FIPS 06; a test ties the list
to the registry), and a California city's worksheet would also print
"Process: Caltrans LAPM reimbursement".

The run-through used Plumas County, CA; Klamath Falls, OR; and the Pine Ridge
Reservation, NE-SD. The definition names no place.

## The rules, in plain words

The lead's eleven rules, as the definition and checker hold them.

1. **Places.** As in the table above. Each place id has its kind's form, the
   county's and city's state is the id's first two digits, and for a record in
   the registry each label is the Census Bureau's 2026 Gazetteer name.
2. **One build, one checkout, in order.** One hosted commit, proof mode, one
   clean harness checkout shared by all three journeys and equal to the
   record's commit, one version and migration count in every health readback,
   and the journeys run one at a time as county, city, tribal area. These are
   the rules PR 516 added to the third job.
3. **Fixed amounts, no retention.** Ceiling $200,000.00; local match
   $50,000.00, posture partial; an obligation date on or before every
   request's period start. INV-1 $60,000.00 goes draft, internal review,
   submitted, approved for payment, paid. INV-2 $45,000.00 goes draft,
   submitted, rejected with a reason. INV-2A $45,000.00 is created with
   Resubmit, linked to INV-2, then submitted, approved for payment and paid.
   Then a reconciled close-out ("Closed with balance released").
4. **Money is recomputed.** The checker sums the record's own requests at the
   moment each figure was read, with the product's partition: claimed is gross
   over internal review, submitted, approved for payment and paid; paid is net
   over paid; outstanding is net over claimed and not paid; rejected is gross
   over rejected; remaining is the ceiling minus claimed gross, not clamped.
   Each status list is tied to `CLAIMED_INVOICE_STATUSES` and its kin by a
   test. Every figure in both worksheet downloads and every screen reading
   must equal the recomputed figure to the cent.
5. **Missing is never zero.** A fact the record holds no entry for must read
   "Not recorded" on the worksheet and on screen. $0.00 there refuses the
   record. A close-out that states no released amount refuses it too.
6. **The product's path.** Each request's history holds every status the
   route answered, in order, each with the control that sent it: the
   register's composer to log, "Move to internal review", "Mark submitted",
   "Mark approved for payment", "Mark paid" with its date, "Mark rejected"
   with its reason, "Resubmit" for INV-2A, and "Close out award". Moves follow
   the request trigger: forward only, rejected only from submitted or
   approved, paid only from approved. A payment date is no earlier than the
   request's invoice date and no later than the day it was marked paid; every
   date is a calendar date and every period ends on or after it starts. A
   request is invoiced no earlier than its period starts and due no earlier
   than it is invoiced, and the resubmission claims the period of the request
   it replaces, invoiced no earlier. Each worksheet row's invoice-date, due and
   paid columns, read by the table header's positions, hold the record's
   dates, or "Not recorded" for a date the record leaves blank, so a date the
   record does not hold, or a date in another date's cell, is refused.
7. **Refusals, each with its status.** The journey's member account, signed in
   and able to download the worksheet, is refused logging, approving, paying
   and closing out (403; owner and admin only, the lead's decision). A second
   workspace's account is refused the award's history read, the worksheet
   download (403 or 404) and the Funding tab (404, or 200 with the not-found
   screen), beside the owner's 200 for the same reads in the same run. The
   owner and the member each send a direct PostgREST PATCH of the award's
   closure columns and of a paid request's amount; the database must refuse
   each with 400 and code 23514 or 403 and code 42501, the status and code
   together, or, for the member's request write only, match no row. A 401 is a
   request with no session and never counts. The owner is refused a paid move before approval (422) and a
   claim above the ceiling with no note (422, `over_award_ceiling`).
8. **The worksheet's words.** Page 1 carries the note that it is not a
   funder's form, and every page carries the footer that says so with its own
   page number. It names no SF-270, SF-271, SF-425 or LAPM Exhibit 5-A, by
   number or by title, with any dash or split at a line's end, unless the
   word "not" comes right before the name. No
   sentence says a cost is allowable, eligible or reimbursable, that a balance
   was deobligated, that a payment was received, or that the worksheet is a
   payment request, including a phrase that continues on the next page. It
   prints exactly as many amounts as the rows the checker reads (19 before
   the close-out and 20 after, under the fixed amounts), counted both by
   currency sign and by number with cents, so no other figure can stand on it,
   and the record's typed text holds no amount. The
   award line and the project line carry the demonstration label. A PDF the
   built-in writer typeset is refused.
9. **Screens.** The Funding tab, Grants (Awards), the Invoices register and
   the dashboard, each read while a request is outstanding and again after the
   close-out and inside the journey, with axe-core 4.11.1 (wcag2a, wcag2aa, wcag21a, wcag21aa) light
   and dark at 1440 and 390 px, each screen read whole, no serious or critical
   finding, no console error and no sideways scroll at 390 px. Each reading's
   money equals the recomputed figure; the dashboard's award reads in whole
   dollars and its share drawn in whole percent.
10. **Limits, in the definition's words.** Not a payment request; no
    allowability statement; not an accounting or audit record; demonstration
    figures only; "Paid" is what the workspace typed; no funder reference;
    retention not exercised; who made each status change and the close-out
    is the journey's word (the record names no actor); what the journey
    leaves on the hosted site; what stays on the journey's word; and the three
    limits every job states. A record states these and no limit under another
    id; a record written before the who-acted limit existed needs it added.
11. **Review before any hosted run.** A fresh-context false-record review that
    also prints honest outputs in every role, and three local rehearsals of the
    journey, come before the declaration. Lane 93's own tests do the first
    half of this (see below); the review itself is the next step.

## The fixed amounts and their hand totals

| Figure | Open download (INV-2A submitted) | At close-out |
|---|---|---|
| Claimed gross | $60,000 + $45,000 = $105,000.00 | $105,000.00 |
| Paid net | $60,000.00 | $60,000 + $45,000 = $105,000.00 |
| Outstanding net | $45,000.00 | $0.00 |
| Rejected gross | $45,000.00 | $45,000.00 |
| Remaining against the ceiling | $200,000 - $105,000 = $95,000.00 | $95,000.00 |
| Balance released | none printed | $200,000 - $105,000 = $95,000.00 |
| Dashboard share drawn | 105,000 / 200,000 = 52.5, shown as 53% | 53% |

INV-2 counts in no claim. With no retention, net equals gross for every
request.

## What the checker reads, and how

Every rule reads words, never a fixed line, because Chrome sets a figure
beside its label, below it or below its note, and wraps dates in the request
table. A figure row runs from its label to the next row's label and must hold
exactly one amount. A request row runs from the line that opens with its
number and carries an amount to the next such line, and must hold its gross,
retention and net and no other amount; its status, reason, resubmission note
and payment date are read as words in order. The real Chrome worksheet set
the close-out basis beside the first line of its note, which is why notes are
read as words in order.

The synthetic example's worksheets are built by the product's own code (the
drawdown ledger, the profile binding and the worksheet document) and laid out
as Poppler text by a test fixture. A second test prints each journey's two
worksheets with Chrome and reads them back with Poppler.

## What a proof is not

- Not a payment request. Recipients other than states request payment on
  OMB-approved forms (2 CFR 200.305(b)); the government-wide forms are SF-270
  and SF-271. Caltrans accepts only LAPM Exhibit 5-A and "no longer accepts
  invoices created by LPAs" (LAPM 5.5, January 2026). The worksheet is
  supporting work.
- Not a statement that any cost is allowable or eligible (2 CFR 200.403), that
  a cost falls after obligation, authorization or allocation, or that a balance
  is released or deobligated in the funder's sense (2 CFR 200.344(e), (f)).
- Not an accounting or audit record. "Paid" and each payment date are what the
  workspace typed; no funder reference is recorded.
- Not a test of retention. A reconciled close releases the ceiling minus net
  paid, which counts held retention as released (KI-2026-11-17-031).
- Not a real award. No agency, tribe, funder or program officer took part.

## What stays on the journey's word

The checker cannot ask the hosted site again. Every status the routes
answered, the control that sent it and its time, every screen reading, the
profile each request carried, every refusal status, the database's answers to
each direct write, the accessibility results, how the account was confirmed,
the executor, and which build, mode and checkout ran are the journey's
statements. The checker holds them to each other and to the product's rules,
and it recomputes the money from them, so a record and worksheets falsified
together to agree are not caught. The record names no actor, so who made each
move and the close-out is the journey's word, and the record says so. The
tribal area's states are the journey's reading, because the Gazetteer table of
tribal areas has no state column. A request row's dates are read by the
columns of the table's header, so a date in another date's cell is refused,
including in a row that splits across a page; a very short word of a long
rejection reason set at the edge of the invoice-date column would be misread,
which refuses rather than accepts.

## History: the hand run-through and what followed

Lane 84 ran the job by hand on November 16, 2026 in Plumas County, CA (06063),
Klamath Falls, OR (4139700) and the Pine Ridge Reservation, NE-SD (2810R),
each with its own workspace and account. It found the job not provable that
day:

- an award finishing under its ceiling could not be closed, and an
  over-claimed award with open requests could (KL-2026-09-04-024,
  KI-2026-11-16-130);
- the close-out could be written straight to the database
  (KI-2026-11-16-134);
- there was no on-screen reject, no resubmission link
  (KI-2026-11-16-135), no payment date (KI-2026-11-16-136) and no obligation
  date (KI-2026-11-16-139);
- status moves were unconstrained (KI-2026-11-16-137), the Funding tab summed
  money from six rows (KI-2026-11-16-132), and nothing stopped claims above
  the award (KI-2026-11-16-131).

Its table of who could do what, as seen locally before the fixes:

| Action | Owner | Member | Second workspace |
|---|---|---|---|
| Open the project's Funding tab | 200 | 200 | 404 |
| Record an award | 201 | 201 | 404 "Project not found" |
| Log a request | 201 | 403 | 403 |
| Approve or mark paid | 200 | 403 | 403 |
| Download the worksheet | 200 | 200 | 404 |
| Write the request table directly | not tried | 0 rows | 0 rows |
| Write the award's closure columns directly | accepted | accepted | 0 rows |

Lane 89's custody migrations (PR 517, installed on hosted in window
20261117-01) and lane 90's code fixes (PR 518) addressed these. The rows in
`docs/ops/KNOWN_ISSUES.md` hold each one's current state.

## What could not be established

- What SS4A recipients use to request payment, and whether it is SF-270: DOT's
  SS4A pages answered 403 to every request in lane 84's run-through.
- The fields of LAPM Exhibit 5-A, which a form renderer serves.
- Whether the hosted site's Chrome wraps the worksheet as this machine's does.
- What the dashboard prints on the hosted site for a closed award; the
  definition expects the whole-dollar award and the share drawn the product's
  dashboard code computes.

## What comes next

1. A fresh-context false-record review of this definition and checker that
   also prints honest outputs in every role.
2. Lane 96's contrast fixes and whole-screen reading (KI-2026-11-17-032, PR
   520) are on main; the journey uses `readWholeScreen` for every screen.
3. Lane 94: the journey script, written to this definition, rehearsed three
   times locally.
4. Sourced inputs, the declaration, the hosted run, the record, a
   fresh-context review of the record, and the evidence PR.
