# Preserve retained outputs during relaunch

October 8, 2026. Candidate source `ce41dc15326ebf10dd00a69d7a59e0b98cc0c216`.
PR #168 remains on hold. This is an implementation checkpoint, not a deployed
migration or completed recovery workflow.

## Reproduced conflict

The existing launch route queues the same run, resets its existing stages, then
deletes artifacts, KPIs and scientific projections. The updated worker retains
stable output identities and command receipts for that same run and stage.
An exact retry returns a historical receipt. It does not recreate a deleted row.

A rollback-only native probe follows the run/stage update and KPI deletion order
with service-role commands in the owned disposable KPI-upgrade database. The
first KPI registration succeeds. After deletion, the same command returns its
original receipt while the KPI count remains zero. This proves the database
interaction, not the authenticated HTTP route or normal dispatcher journey.
Private evidence is `relaunch-receipt-deletion.json` and its executable
`probe-relaunch-receipt-deletion.py` under the existing model-command proof root.
No application database changes were made.

Clearing the journals or changing stable output identities would discard the
recovery evidence. Reclassifying a historical receipt as current existence would
misstate its meaning. Neither is a correction.

## Database prototype

[The proposed guard](prototype/retained-output-protection.sql) preserves legacy
runs that have artifact, KPI or assessment command receipts. It refuses requeue,
input or scope replacement, stage reset, and replacement/deletion of retained
run outputs. Ordinary progress and completion remain allowed. Existing managed
attempt guards remain separate. No trigger or function from this prototype is
installed outside a rolled-back test transaction.

[The native check](prototype/verify_retained_output_protection.py) runs 30
prohibited changes across three independently selected receipt families. The KPI
case uses the real registration RPC. Artifact and assessment receipt-selector
fixtures are synthetic table rows, not claims of completed scientific ingestion.
An unretained run still queues and deletes its synthetic KPI. Retained stages
still log progress and complete; retained runs complete; an unchanged KPI update
succeeds. Output values remain intact.

Baseline, harmless-comment and restored-source runs pass. Eight adverse variants
are detected: absent guard, each missing receipt selector, permitted requeue,
permitted input replacement, permitted deletion and permitted output replacement.
The initial broad deletion control reached an existing foreign-key refusal before
the intended assertion. Reordering the parent deletion after output changes
makes that control fail for an accepted prohibited output deletion. No existing
constraint or expected refusal was removed. All transactions roll back.

## Work required before integration

The route must inspect retained recovery state before failure-history, input,
run, stage or output writes and return a clear scoped refusal. A failed or
incomplete inspection must not mean that no retained work exists. A database
guard remains necessary because a route read is not an execution lease.

Complete native concurrent registration/reset and deletion cases, authenticated
route cases, projection scope and permissions, installed migration/upgrade and
restore checks. Verify the exact relaunch request through T3 at desktop and
390px when preview capture works. Current tests do not prove these boundaries.
The prototype also needs native coverage of its scientific-projection triggers
and cross-run changes before it becomes a migration.

A local computation can be retained before any database output receipt exists.
This prototype does not protect that earlier boundary. Full continuation needs
a durable execution identity before computation, attempt-aware output binding,
complete scientific ingestion and explicit reconciliation after interruption.
Current same-run relaunch and its local scratch reuse cannot be called safe
merely because receipt-backed deletion is refused. Preserve original producing
attempts and consumed scientific evidence. Do not enable full-stage replay.

The V1 contract and roadmap M3 remain unchanged. This checkpoint prevents no
production action yet and closes neither independent scientific acceptance nor
practitioner acceptance.
