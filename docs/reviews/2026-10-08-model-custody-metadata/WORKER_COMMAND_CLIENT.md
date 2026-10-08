# Retained commands for model workers

October 8, 2026. This checkpoint adds a worker-side command client for roadmap
M3/S1. It does not activate attempt management in either stage dispatcher.

## What changed

`workers/aequilibrae_worker/model_command_client.py` delivers stage claims,
stage status writes and artifact writes through the candidate command RPCs.
It retains the exact request before dispatch, binds it to a deployment and URL,
and resolves it only after checking the returned identity and outcome. A lost
reply stays pending. A resolved retry returns the retained receipt without
another POST. Credentials remain outside the journal.

The client checks claim ownership identities, lost-claim outcomes, completion
timestamps, parent outcomes and exact artifact metadata and byte identities.
A failed stage must return a failed parent. A successful intermediate stage may
leave the parent running. A returned claim records its original outcome; it is
not proof that the attempt still owns work when recovery starts.

`model_command_journal.py` carries the tested SQLite journal from the dated
prototype into the worker source directory. The original prototype remains
unchanged as historical evidence. Worker adoption should use the worker module;
it must not import application code from review documents. The existing
AequilibraE Dockerfile copies these sibling Python files. ActivitySim still needs
an explicit shared-client import and packaging decision before adoption.

## Verification

Run from the repository root:

```sh
python3 -B workers/aequilibrae_worker/test_model_command_client.py
python3 -B workers/aequilibrae_worker/test_model_command_journal.py
python3 -B workers/aequilibrae_worker/test_model_command_mutations.py
```

Nine delivery tests and six journal tests pass. Journal tests include separate
process exit after preparation and resolution, concurrent first-open requests,
private permissions, immutable responses and deployment filtering. Two mutation
runner tests retain harmless controls and detect ten targeted broken behaviors.
They modify temporary copies, never the checkout under validation.

The parent-outcome fault initially survived because the fixture's timestamp also
contradicted its parent state. The fixture now supplies a consistent active-parent
timestamp, so removing the outcome check fails for the intended reason.

The reproducible native check is `prototype/verify_worker_client.py`. It requires
`OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER` selecting the disposable restore-target,
`OPENPLAN_MODEL_COMMAND_PROOF_METADATA` selecting its synthetic CLI-upgrade
metadata, and `OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT` selecting a private output
directory. It refuses databases outside the owned proof database naming scheme.
Do not target a demo or application database.

The check passed against the installed candidate migration in the retained
synthetic CLI-upgrade database. Each of two runs exercised a claim, artifact
write and terminal write through authenticated PostgREST. One run succeeded and
one failed. For all six commands the transport discarded the first reply after
HTTP confirmed commit. The client retained the request and retried it exactly.
Each command sent two POSTs; subsequent delivery reused the local receipt. An
independent SQL count found one attempt, artifact and completion receipt per run.
The temporary PostgREST gateway was removed. Synthetic database rows remain in
the owned proof database.

The native check uses a transport adapter to remove the isolated PostgREST
server's missing `/rest/v1` prefix and to discard the reply. It does not simulate
a TCP disconnect or a worker process crash. The prior prototype's separate TCP
recovery evidence does not establish those properties for this new caller.
Local evidence is retained at
`~/.local/state/openplan/model-command-client-20261008-proof/reproducible/native.json`.

## Remaining connection work

Normal dispatchers still use their current receipt-checked legacy writes. Before
adoption, connect all stage claims, logs, artifacts, KPIs, assessment records and
terminal outcomes. Reconcile retained requests and current ownership before
reusing run files or executing a recovered stage. Resolve the existing rules-v4
assessment writer's artifact creation, and use server-confirmed artifact IDs
where the ActivitySim assignment currently creates its own ID. Preserve method
separation and unassessed outcomes when prepared evidence is absent.

The client has per-request connection and read timeouts, but no total wall-clock
response deadline or response-body size cap. Unit transports do not prove HTTP,
RLS, Storage contents or dispatcher behavior. The native proof does not verify
Storage bytes, scientific results, prepared-instrument ordering, cross-consumer
presentation, practitioner acceptance or V1 completion. Those remain required.
