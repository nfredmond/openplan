# Connect normal workers to retained execution attempts

October 8, 2026. Source audit at `f525836acca1403291419009d08c39c59e7bf739`.
This record refines the existing M3/S1 implementation boundary. The roadmap
remains the sole queue. No worker, database or scientific result changes here.

## Decision

Connect both normal dispatchers as one lifecycle change. Do not switch only
`sb_claim_stage` to the managed RPC. A successful managed claim protects the
parent and stage from their existing direct writes. Their next progress or
parent update would then fail. Receipt recovery already exists; it does not
authorize running a stage again after a lost reply.

The direction check passes with registry-age and intervening-change reminders.
The full contract, capability matrix and October 6 direction review still
require operations and separate scientific acceptance alongside everyday
planning work. This audit neither refreshes those review dates nor promotes a
capability grade.

## Verified source inventory

Paths are relative to the repository root. Line references describe the audited
commit; function names are the durable navigation anchors.

| Boundary | Existing implementation | Required join |
| --- | --- | --- |
| AequilibraE entry | `workers/aequilibrae_worker/main.py::_claim_and_run_stage`, lines 6485 onward, claims by conditional REST PATCH and separately marks the parent running. Poll and push share `process_first_actionable_stage`. | Retain the claim request before transport. Resolve its exact receipt before dispatch. Use the claim transaction's parent transition. Exercise both entrypoints. |
| ActivitySim entry | `workers/activitysim_worker/supabase_poll.py::process_stage`, line 887, uses the same separate claim and parent writes. | Use the same command protocol in the packaged worker, with invocation-local attempt context. Confirm its package includes every imported command module. |
| Progress | AequilibraE `stage_setup` has three `sb_patch_stage` call sites; `stage_assignment` has six. ActivitySim `run_bundle_and_preflight_stage` has four. | Retain each intended progress command. Define how a log-only patch becomes a complete command without deleting prior error/log facts or inventing timestamps. |
| Successful completion | AequilibraE dispatcher reads unfinished stages, then PATCHes parent success. ActivitySim calls `maybe_mark_run_succeeded`, also a separate read/write. | Use `write_model_stage_attempt` for the terminal outcome. Its parent lock and complete-stage check own parent completion. Remove the managed path's separate parent PATCH. |
| Failure | Both dispatchers issue a failed-stage write followed by failed-parent PATCH. AequilibraE preserves a real partial log and removes the claim placeholder. | Preserve useful failure evidence in one retained terminal command. Its native transaction revokes sibling ownership and terminalizes outstanding stages. Do not turn delivery uncertainty into computational failure. |
| Blocked predecessor | Both `mark_stage_skipped` functions PATCH an unclaimed queued row after a separate readiness read. | Do not invent a claim for skipped work. Decide this state through a parent-locked lifecycle operation or the existing terminal transaction, and prove the stale-read case. Keep skipped, failed, cancelled and unassessed meanings separate. |
| AequilibraE output | `stage_artifacts`, agreement registration and dispatcher output use retained legacy artifact/KPI/assessment commands. | Bind each output to its actual producing attempt and stable command identity. Retained legacy delivery is not managed ownership. Preserve existing byte hashes and method separation. |
| ActivitySim output | `run_bundle_and_preflight_stage` and `_write_executed_behavioral_kpis` still call direct `sb_post_artifact`/`sb_post_kpi`. | Connect registration to retained attempt commands, including upload confirmation and lost-response recovery. A successful file upload alone is not a registered output. |
| Local files | AequilibraE uses full-run UUID directories and mutable `state.json`; ActivitySim creates separate `execution-*` directories beneath the run UUID. | Bind local state, journals and outputs to installation and attempt, retaining predecessor identity. Neither current naming scheme by itself proves attempt ownership or safe restart. |
| Relaunch and history | The launch route calls the custody boundary; historical/retained executions have restrictions beyond the older relaunch RPC. | Reconcile these restrictions with an explicit recovery workflow. Do not silently reopen retained runs or treat the existence of a relaunch RPC as authorization to use it. |

The call-site counts come from Python AST inspection of these two files, not a
claim that all database writes across the repository were exhaustively found.

## Existing protocol to reuse

Migration `20261016000014_model_attempt_command_custody.sql` supplies managed
claim and stage-write commands. Claim checks the parent, queued stage, active
attempt and lower-order prerequisites while holding the parent lock. Repeating
an identical request returns its retained receipt, including `not_claimed`.
Do not reuse that request for a later scheduling decision and expect a new claim.

The stage-write command and `model_command_client.py::validate_command` accept
only `running`, `succeeded` and `failed`. Adding `skipped` to a Python wrapper
would not define its database semantics. A completed claim receipt also remains
a historical receipt after revocation. The existing ownership inspector is a
point-in-time read, explicitly not a lease or permission to resume computation.

Reuse the command journal and checked receipts. Keep attempt context scoped to
the current invocation, including AequilibraE's process lock and ActivitySim's
handler boundary. Do not create a global run-to-token cache. Resolve pending
commands before later publication, and stop if that reconciliation is uncertain.

## Implementation and evidence order

1. Specify the complete transition table for both workers: fresh claim, lost
   claim, uncertain claim, progress, output, successful completion, computation
   failure, blocked predecessor, cancellation, reaping and restart. Preserve
   retained historical records. Decide blocked-stage semantics before changing
   normal dispatch.
2. Add invocation-scoped command and filesystem ownership to both packages.
   Connect every write in the inventory, including failure and output paths.
   Keep the enforcing database checks active; no legacy fallback on refusal.
3. Exercise actual normal dispatchers against an isolated native database with
   synthetic domain handlers. Include two independent worker processes, push
   versus poll, predecessor completion races, lost acknowledgements at each
   retained boundary, revocation during execution and a fresh recovery process.
   A handler spy must prove uncertain/replayed claims do not execute twice.
4. Verify old workers cannot change managed rows or register outputs, and that
   managed workers do not rewrite historical records. Restore database, journal
   and exact output bytes together into another isolated installation. Confirm
   ownership before any continuation; test wrong installation and wrong attempt.
5. Exercise the resulting recovery controls through real navigation at desktop
   and 390px, with identified build, console inspection and usable artifacts.
   T3 currently reads pages but cannot capture screenshots. That remains an open
   evidence boundary, not a passing visual check.

Each changed test or guard needs its harmless control and a broken behavior that
fails for the stated reason. Synthetic execution proves lifecycle behavior,
not AequilibraE or ActivitySim accuracy. Do not run consumed scientific holdouts
to test this integration. Complete prepared-instrument/assessment custody,
independent scientific acceptance and observed practitioner use remain required.

## Integration custody

PR #170 remains the unchanged main-target candidate at the audited commit while
its CI runs. This follow-on work belongs to
`work/managed-dispatch-integration-20261008`, outside the frozen acceptance
checkout. Do not describe its future implementation as part of PR #170 or as
already released. The earlier attempt-ownership, worker-command and recovery
records remain applicable; this inventory narrows the next code inspection,
not the v1 destination.

## Blocked-stage transaction prototype

`prototype/skip-blocked-stage.sql` defines a separate operation for unclaimed
queued work. It locks the parent and its stages, verifies the named earlier
predecessor and its expected terminal status, and derives the reason from that
record. A stale observation returns a retained `not_skipped` receipt. A changed
payload under an existing request identity is refused. The operation creates
no execution attempt or start record and leaves the parent unchanged.

This operation does not replace the existing managed failure transaction,
which already stops outstanding stages. It addresses the legacy dispatcher's
separate blocked-predecessor path without treating unexecuted work as an attempt.
The complete managed transition table must still reconcile cancellation and
dependent failure semantics before normal dispatch switches over.

`prototype/verify_skip_blocked_stage.py` exercises the actual SQL against the
owned retention fixture database in rollback-only transactions. Baseline,
harmless-comment and restored cases pass. Six broken variants fail their
intended assertions: overwriting running work, ignoring a changed predecessor,
ignoring request identity, ignoring workspace, accepting a later predecessor
and omitting the retained receipt. A synthetic receipt-insert failure rolls back
the stage change; the same request succeeds after that failure is removed.
The verifier confirms the prototype table and function are absent both before
and after every variant. Results are in `prototype/skip-blocked-stage-controls.json`.

Permissions follow the existing service-only command pattern and the
[Supabase function guidance](https://supabase.com/docs/guides/database/functions).
The test checks role grants; it does not invoke the function under each role.
The cases use new unmanaged synthetic rows. Managed-parent cases, simultaneous
processes, HTTP uncertainty, worker packaging, journal delivery, migration and
retention integration remain open. No application database or running worker
was changed. This prototype is not an installed feature or scientific evidence.

### Managed history and actual role follow-up

The verifier now also loads `prototype/skip-blocked-managed-cases.sql`. Real
`anon` and `authenticated` calls fail with insufficient privilege. A real
`service_role` call skips the eligible unmanaged fixture and recovers its exact
receipt; a direct receipt UPDATE under that role is refused. Two added controls
grant anonymous or authenticated execution and fail at their actual invocation
assertions. The original six broken controls still fail; baseline, harmless and
restored cases pass.

Separate fixtures acquire real managed attempts, then terminate through either
`write_model_stage_attempt` failure or the native reaper. The skip operation
returns `not_skipped` and preserves every parent, stage and attempt row in those
terminal histories. The reaper uses an explicit synthetic cutoff to exercise
the transaction, not to establish timeout or heartbeat correctness.

This closes the preceding entry's actual-role and managed-terminal-history
checks. It does not establish concurrent-process ordering, an eligible managed
queued skip, HTTP uncertainty, worker integration, installed migration custody
or scientific acceptance. The updated controls file records eight targeted
broken variants. All synthetic records and prototype objects roll back.
