# Preserve original held custody after a competing write

Two custody passes can read an outstanding artifact before either records it.
A later failed upsert can then replace a held row with failed state and null
path/hash. Immutable Storage protects the object but leaves no usable row
pointing to it.

Candidate migration20261017000011 adds a before-update guard. Once a row is held,
its original facts cannot change through an update or conflicting insert.
Attempt count, last-attempt time and updated-at remain operational metadata.
The guard raises23514 with a fixed message and a named constraint. It changes no
existing row or member grant. Delete/reinsert remains outside this update guard.
Later georeference corrections and future added columns are also frozen.

## Application recovery

The application recovers only the exact23514/message pair. It rereads custody
and checks every expected kind/ordinal before writing a job summary. A rejected
bulk write can leave an expected artifact absent, so a partial retained roster
cannot become complete. Missing and unreadable results require another attempt.
Other constraint and serialization errors remain failed writes.

The retry route reads the full original callback roster. The engine skips held
artifacts while retaining missing identities for retry. An all-held retry can
repair package readiness without another source transfer. Both routes refuse
package writes from unreadable results. They advance pending custody readiness
to partial, preserving human verification states, titles, notes and other edits.
A failed readiness repair returns503.

Application recovery will land before the guard activates. Migration00011
follows Claude's00009/00010 source integration and a fresh hosted backup. Neither
the candidate migration nor these application corrections is merged or applied
to hosted. PR312 is the separate, migration-free delivery candidate.

## Why the error code changed

The initial candidate raises40001. Direct SQL row controls pass, but seven actual
HTTP application trials time out. Request, body, query and backend diagnostics
show PostgREST repeating the rejected statement. The owned services stop in
finally; the databases remain retained. Those trials remain failures.

[Supabase documents this serialization retry behavior](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
The corrected guard returns23514 through actual PostgREST as HTTP400. Recovery
recognizes that exact refusal and reads preserved rows. The native mutation
control restores40001 and fails the intended prompt-response assertion. A direct
SQL check alone would not establish this HTTP boundary.

## Verification to date

Four source cohorts each pass80 cases across three affected files. All18 source
faults reach their named assertions;90 diagnostic controls challenge the result
classifier. Source edits restore in finally. The final source-binding record includes the corrected test-client casts. The scoped TypeScript dependency
check passes after correcting those casts; full-program acceptance is separate.
Changed-file lint and the final related cohort remain pending.

Four native row cohorts exercise direct writes, six original fact changes,
member access and a real lock wait between competing transactions. All nine
faults fail at intended assertions, including a wrong serialization error code.
The63 diagnostic controls pass. Four native HTTP/application cohorts each pass
seven cases using actual compiled routes, engine, SDK and PostgREST. Six faults
reach their intended diagnostics;36 classifier controls pass. The HTTP fixture
proves bulk rollback, complete-roster recovery, pending readiness repair,
preservation of human fields, visible member rows with zero updates, and
anonymous write refusal. JWTs are issued only for this isolated fixture; hosted
Auth and login are not tested. Source downloads and Storage are synthetic.

The native fixtures use selected409 plus candidate DDL, without adding schema
history entries. They are not labeled current main. A pinned-source upgrade
fixture separately uses main122cfbbaa's411 migrations, the exact00009/00010 branch
sources, and guard00011. Its baseline upgrade and logical restore pass, with
history409,411,413 and414 at the respective boundaries. The original held row
and member write refusal survive restore. Four complete upgrade/restore cohorts and three intended faults pass. The first
harmless trial fails PostgreSQL readiness at its eight-second fixture allowance.
A later30-second baseline also fails before migration. Default ten-second Docker
stop ends with137, prolonging the next recovery. The corrected fixture allows180
seconds for startup and120 for graceful shutdown. Four cohorts then pass;
production budgets do not change.

The independent read-only review identifies the earlier unreadable-summary
regression and confirms its corrected scope. Its pending-count and failed-repair
suggestions are incorporated. The final source review confirms the exact23514/message classification and
code-before-guard rollout. Its controller-timeout cleanup suggestion is
implemented and tested with four five-case simulated-boundary cohorts and11 intended
faults. It does not establish actual timeout cleanup, hosted or browser acceptance.

## Evidence limits

The guard does not establish physical object presence, source preparation,
expired-source recovery, recurring late-object cleanup, full worker integration,
capacity, browser usability, processing quality or scientific acceptance.
Source extension still affects object identity. Same-cluster logical restore
is separate from hosted backup/restore, Storage restore, login, global-role
recovery and independent installation on another machine. Nathaniel has no
second Linux machine available. No M3, M5b.2 or V1 acceptance is declared.

The controls, bindings and native result are stored beside this report. Private
logs and retained database identities remain under:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/aerial-held-custody-20261014/`.

## Proof runner cleanup correction

The native row and HTTP runners now allow30 seconds for initial readiness and
120 seconds for graceful owned-cluster shutdown. Their controllers use a bounded
240-second outer allowance and invoke the same fenced cleanup on timeout. The
fresh row controls retain four cohorts, nine intended faults and63 classifier
controls. The fresh HTTP controls retain four seven-case cohorts, six faults and
36 classifier controls. Cleanup controls pass four five-test cohorts and11
intended faults, including skipped cleanup in either native controller. The
Docker boundary in those timeout checks is simulated; native cohorts separately
exercise ordinary owned service cleanup. No production budget changes.

Application recovery is PR313. This guard branch includes that exact source.
The guard remains unapplied and cannot merge until application recovery is live,
00009/00010 source joins main, and the hosted owner takes a fresh backup, applies
and verifies00011. Selected-source fixture evidence does not replace that rollout.
