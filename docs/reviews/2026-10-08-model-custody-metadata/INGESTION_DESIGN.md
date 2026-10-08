# Connect comparable evidence to actual model runs

October 8, 2026. Source audit and implementation design against `db92ca1b`.
This does not implement ingestion, run a model or establish scientific acceptance.
The active work remains roadmap S1.

## Finding

Published rules-v5 study files and normal worker assessment custody use different
paths. The production connection is incomplete. Adding a caller for the existing
v2 custody RPC without resolving its identity contract would not complete S1.

| Boundary | Inspected source | Finding |
|---|---|---|
| Normal AequilibraE assignment | `workers/aequilibrae_worker/main.py`, `build_rules_v4_validation_records` and assignment persistence | Builds rules-v4 records and calls `record_modeling_validation_assessment`. |
| ActivitySim assignment within the same orchestrated run | `main.py`, call to `persist_rules_v4_validation_records` | Uses the same `run_id`, a separate output artifact and `behavioral_demand` track. |
| Rules-v5 worker wrapper | `main.py`, `assess_rules_v5_validation_instrument` | Defines a wrapper around the shared evaluator. The tracked Python source search finds no caller of this wrapper. Its existence is not a completed worker path. |
| Published comparable study | `scripts/modeling/run_comparable_observation_study.py`, `assess_all` | Calls the shared rules-v5 evaluator, writes local assessment/diagnosis files and a study result. It does not register the v2 custody RPC. |
| Legacy assessment identity | `20260828000001_model_validation_assessment_custody.sql` | Retains a track and model-output artifact per assessment. Its rules version is constrained to 4. It cannot truthfully receive v5 records unchanged. |
| V2 custody identity | `20260828000004_comparable_observation_v2_custody.sql` | Retains five artifact identities and hashes but no method or output artifact. `UNIQUE (model_run_id)` permits one custody row per run. |
| V2 consumers | `reports/run-citations.ts`, `assistant/chat-tools.ts`, `project-evidence-bundles/generated-records.ts` | Read v2 custody records. Consumer queries do not establish a production writer. |

A tracked-source search for the exact v2 RPC name finds its migration and tests,
not a production caller. Searches also cover direct table references and the
normal worker's artifact registration paths. Dynamic invocation outside the
inspected repository or a separately installed service was not assessed.

The one-row-per-run constraint conflicts with directly persisting separate v2
records for both outputs of the existing dual-method run. This is a source-level
integration conflict, not a claim that a deployed two-method write failed. The
existing wrapper and evaluator docstrings describe a stronger normal-worker
connection than this call-site audit establishes. Keep that distinction visible.

## Identity and storage decision

Preserve existing v4 and v2 rows and their meaning. Do not relabel v4 as v5,
invent a method for a historical v2 record, average the methods, create a second
synthetic model run solely to avoid a constraint, or drop the v2 run constraint
without supplying the missing identity controls.

The production record must bind the actual workspace, model run, stage/attempt,
demand method, output artifact and logical output hash. It must also bind exact
input-bundle, match-audit, comparison-basis, assessment and diagnosis artifacts.
The two demand methods can share a parent run and assignment engine while
remaining separate assessments. Method cannot be inferred from the parent
run's engine label.

Use a versioned successor to the existing custody command for these records.
Retain its service-role boundary and immutable artifacts. An additive successor
table is preferable to reinterpreting ambiguous historical rows. Before writing
that migration, compare its fields with the complete current artifact, stage,
attempt and claim schemas. Reuse their identity and access checks rather than
create another run lifecycle. No new product module is needed.

An exact request retry returns the same custody identity. A different payload
with the same request identity fails. A new assessed input revision retains a
new record linked to its actual output and instrument; it does not overwrite
the earlier assessment. A workspace/run/method label alone is not an adequate
idempotency key.

## Worker connection

The inspected generic stage path claims with a conditional queued-status PATCH
and later updates by stage ID. It does not supply the per-attempt identity
required above. The [state-receipt correction](WORKER_STATE_VERIFICATION.md)
stops after unconfirmed updates, but does not provide fencing or restart
reconciliation. Extend the existing M3 lifecycle rather than invent a parallel
custody-only attempt system or silently omit that requirement.

Use the existing stage execution and artifact upload paths. Require an explicit
prepared instrument for the selected run. The worker must verify its source,
geography, network, assignment, population and observation boundaries before
opening model-output bytes. A caller-provided `model_output_bytes_read: false`
flag alone does not prove ordering or protect a holdout. Preserve actual
preparation custody and attempt ownership.

Keep the current uncontracted assessment path honest when that prepared evidence
does not exist. Missing preparation remains unassessed or inconclusive; it must
not produce invented observations or an empty passing record. The frozen v5
diagnostic instrument's quantity assumptions do not establish a general
nationwide acceptance evaluator.

Upload immutable exact bytes before the custody transaction. Bind file sizes,
logical hashes, schemas and all inter-artifact references to those bytes. On a
lost transaction acknowledgement, resolve the exact request before declaring
failure or creating another assessment. Unreferenced uploaded objects remain
distinct from successfully recorded custody. Never rewrite an object after
its hash is committed or claim success solely because upload succeeded.

Consumers must use the successor's actual identities and hashes in Models,
Reports, assistant grounding and project evidence bundles. Return explicit
missing or failed evidence states. Preserve historical v4/v2 views; do not
silently select a method, a latest row or a summary from an unrelated artifact.

## Evidence required before calling the connection complete

Use synthetic software-integrity fixtures first. Do not reopen a holdout to test
transport or storage. Exercise both method outputs within one actual run,
cross-workspace/run/output rejection, missing and null fields, swapped artifacts,
changed bytes, unknown response recovery, concurrent exact retry and attempted
claim promotion. Include a harmless control and a relevant broken behavior for
each changed guard.

Verify the native RPC and immutable Storage bytes, then traverse the real worker
entry point. Confirm that output bytes remain unread on every failed preparation
gate. Separately verify a visible identified-build journey from the run to its
report, assistant citation and complete exported records at desktop and 390px.
Hashes, summaries and method labels must agree across those consumers. Test
recovery against a disposable stack and retain an unchanged earlier assessment.

Independent AequilibraE and ActivitySim acceptance, representative human use,
all-state/DC coverage and the remaining contract gates are separate obligations.
No successful ingestion case closes them.
