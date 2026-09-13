# v0.57.0 candidate: retained engagement responses

This is preparation, not a published release. Current published release remains
v0.56.1. Full v1 and the remaining M9b scope are unchanged.

## Proposed shipped behavior

Staff can retain and retry an interrupted response save, review a concurrent
correction before applying their proposed wording, and reconstruct the original
and corrected copies with reasons. Private history identifies automatic source
withdrawal separately from staff review. Withdrawal considers linked replies'
parents, including changed approved wording.

Publication atomically retains an update for local recipient preparation.
Activity counts the complete queue and durable delivery outcomes, keeping
unknown recipient counts separate from an established empty audience. Claims
serialize with unsubscribe and campaign closure. The native worker journals its
acknowledgement before completing it in PostgREST, recovers retained outcomes
on restart and does not automatically resend an uncertain delivery attempt.

## Upgrade and limits

Apply migrations 20261014000003 through 20261014000007 before starting the
updated editor or worker. The five migrations bring the ledger from 321 to 326.
They add recovery/history/queue behavior and replace functions or policies;
existing response/history bytes were preserved. The full restored target was
then upgraded and passed 480 isolation tests. See CONFLICT_AND_RESTORE.md.

Keep the browser tab open for its recovery copy. A message already claimed may
be in flight; provider acceptance is not inbox delivery. The verified transport
was local and disabled for real email. No external delivery or participant
usefulness is claimed. Translation-version history, broader engagement decision
follow-through and comparative usability remain unfinished. Model validation,
agency approvals, prescribed forms and automatic reminders retain their own
existing boundaries; this release does not promote them.

## Evidence and remaining release work

- Transaction, authority, large-recipient, concurrency, route, editor, worker
  restart and mutation reports live beside this note. Read their stated scope.
- Original/corrected/reviewed response journeys passed desktop and 390px with
  five retained revisions and original hashes intact. Desktop background network
  failures are disclosed; the narrow console has only induced request failures.
- Full restored-target RLS: 50 files, 480 tests passed. Applicable worker run:
  52 suites passed. Installed conflict HTTP baseline/control pass; targeted old
  error codes fail before starting a retry loop, then functions are restored.
- Full shuffled suite seed 370816: 1265 files and 14306 tests passed, 451 skipped.
- Full QA at f95e477e failed two inventory assertions. They are fixed and
  mutation-proved; a new full QA through provider checks, audit and build is due.
- Public parent/reply withdrawal passed desktop and 390px with stored withdrawal,
  public absence, private history custody and anonymous history refusal verified.
  The original and corrected reports are linked in CONFLICT_AND_RESTORE.md.
- Package/lock, changelog and release ledger are now prepared at 0.57.0.
  The v0.56.1 tag has 321 migrations through 20261014000002; its previously missing ledger
  row is recorded alongside the new candidate's row. Verify final source,
  land directly on main without a PR, inspect final commit CI, then tag.

Use RESET_HANDOFF.md for private stack and account paths. Refresh process and
checkout ownership on resume. Do not touch the separate demo or old restarting
container stack, and do not reuse old prototype installers on the app database.
