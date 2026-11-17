# Award custody window: three migrations in one transaction

Inputs for the hosted install kit (`scripts/ops/hosted-install/README.md`,
Phase C). Hosted history moves from 455 rows through `20261102140000` to 458
through `20261117000200`. Written by lane 89 (agent-run, local) for the lead,
who runs the window. **Not yet run on hosted.**

Merge order matters: install these three files, confirm them, then merge the
code. The code reads the new columns (`obligated_on`,
`closure_released_amount`, `paid_date`, `rejection_reason`,
`resubmits_invoice_id`) and calls `funding_award_closeout_command`; on a
database at 455 the award, register and worksheet reads fail and every
close-out answers 503 "Award close-out requires migration
20261117000000_award_closure_custody."

## The three files, in install order

| # | File | What it changes | Locks |
|---|---|---|---|
| 1 | `20261117000000_award_closure_custody` | Adds `funding_awards.closure_released_amount`; widens `funding_awards_closure_basis_known` to admit `reconciled_with_balance`; adds two CHECKs (released amount only and always on a reconciled close, which also needs a note); adds `reimbursement_request_net` (the app's net arithmetic in SQL), `funding_award_closeout_command` (service role only: earned close-out, reconciled close-out, closure recorded on import, reopen; files the close-out milestone in the same transaction) and the trigger `funding_award_closure_custody`, which refuses any change to the closure columns on any award unless that command (or the managed command) set `openplan.award_closure_command` for the award under the server's role, and refuses any close while a linked request is open | ACCESS EXCLUSIVE on `funding_awards` from `ALTER TABLE` (add column, drop and add CHECK, two CHECKs validated by scan) and SHARE ROW EXCLUSIVE from `CREATE TRIGGER` |
| 2 | `20261117000100_reimbursement_request_status_custody` | Adds `billing_invoice_records.rejection_reason`, `resubmits_invoice_id` (self-reference) and `paid_date`; three CHECKs; a unique partial index (one resubmission per rejected request); the trigger `reimbursement_request_status_custody`: created as draft, forward moves only, rejected only from submitted or approved with a reason, paid only from approved with a payment date not after tomorrow (UTC), paid and rejected final, a resubmission names a rejected request on the same award in the same workspace | ACCESS EXCLUSIVE on `billing_invoice_records` from `ALTER TABLE`; SHARE from `CREATE UNIQUE INDEX`; SHARE ROW EXCLUSIVE from `CREATE TRIGGER` |
| 3 | `20261117000200_reimbursement_dates_and_numbers` | Adds `funding_awards.obligated_on`; unique partial index `billing_invoice_records_award_number_unique` on `(funding_award_id, lower(invoice_number))` | ACCESS EXCLUSIVE on `funding_awards`; SHARE on `billing_invoice_records` while the index builds |

No file uses `DROP TRIGGER IF EXISTS`, rewrites a row or replaces an existing
function, policy or grant. File 1 drops one CHECK and adds it back with one
more value in the same `ALTER TABLE` statement. Each file is plain SQL with no
`BEGIN`/`COMMIT`; the kit wraps all three in one transaction. Holding hosted
at 458 with the old code is not safe for close-out (see "If the code merges
late" below), so merge the code right after post-verify.

md5 of each file as committed on the lane branch (the plan's `commit` and
history checks use the frozen integration head, not these):

| File | md5 |
|---|---|
| `20261117000000_award_closure_custody.sql` | `6bab16a06aee80584f67477959031de0` |
| `20261117000100_reimbursement_request_status_custody.sql` | `4c6f1c9edd5f9bcee1f2b97e966fdbbb` |
| `20261117000200_reimbursement_dates_and_numbers.sql` | `22edbd5e30055c95fcf808f1a3ae7027` |

## Pre-checks against hosted (read-only)

`prechecks/10-award-custody.sql`. Each row reads `pass` or stops the read:

- history is 455 through `20261102140000` and none of the three versions is present;
- **no award holds two requests whose numbers match without regard to case**
  (the unique index in file 3 fails to build otherwise; lane 84 logged
  E-DUP twice on a local build). If this fails, the informational query in the
  same file lists the pairs. Do not delete a request; have the workspace rename
  one, then re-run the pre-check;
- `funding_awards_closure_basis_known` exists by that name and every stored
  basis is inside the widened set;
- none of the new columns, functions, triggers, constraints or indexes exists;
- `managed_award_closeout` still sets `openplan.award_closure_command`, the
  setting the new trigger accepts.

The informational counts at the end say what the rules will meet. No existing
row is changed or refused at install: the triggers check changes, not history.
A request already paid without approval stays paid and prints "Not recorded"
for its payment date. An open request on an already closed award blocks only
that award's next close-out after a reopen.

## Post-checks (inside the install transaction)

`postchecks.sql`: history 458 through `20261117000200`; five new nullable
columns, all empty; the widened basis CHECK; six new constraints validated;
two valid unique partial indexes; two enabled BEFORE INSERT OR UPDATE row
triggers; `funding_award_closeout_command` executable by `service_role` only;
the two guard functions not executable by `authenticated`.

## How to tell it worked (after the install)

1. `probes/89-award-custody-refusals.sql`, rolled back. Expected notices:
   "probe 89: member and owner closing writes refused", "probe 89: request
   rules hold", "probe 89: close-out command closes, reconciles and reopens".
   On a database without these files it reads "PROBE CHECK FAILED, probe 89:
   member closed an award by direct write".
2. After the code merges and deploys: on the hosted site, as an owner of a
   test workspace, log a request (it saves as a draft), move it to approved,
   "Mark paid" asks for a date; on a submitted request "Mark rejected" asks for
   a reason, and the rejected row offers "Resubmit". `GET /api/health` reports
   the new commit.

## Rehearsal on the lane's scratch stack (agent-run, local)

Recorded in the pull request body: reset to `20261102140000` (455), pre-check
read, `migration up` of the three files, post-checks, the probe, and the live
RLS files for the changed tables. The kit itself, the hosted dry run and lock
timings under hosted traffic were not run by the lane.

## If the code merges late, or early

- **Code before migrations** (455 with the new code): award, Funding tab,
  register and worksheet reads fail on the missing columns; close-out, reopen
  and imported closure answer 503 naming `20261117000000`. Do not merge first.
- **Migrations before code** (458 with today's code): the old routes write
  closure columns directly, so earned close-out, imported closure and reopen
  on ordinary awards are refused by the trigger (500 "Failed to update funding
  award"); invoice creation in any status but draft and "Mark paid" without a
  date are refused (500). Reads keep working. Merge the code right after
  post-verify.

## Rollback

Not data-destructive to undo, but undo only if the probe fails: in one
transaction, `DROP TRIGGER funding_award_closure_custody ON
public.funding_awards; DROP TRIGGER reimbursement_request_status_custody ON
public.billing_invoice_records;` restores the old write behavior while keeping
the new columns (empty unless written since). Removing columns, indexes and
functions is a separate, reviewed change; columns written after install hold
planner data.
