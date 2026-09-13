# Retained generation output checkpoint, September 13, 2026

The user is approaching the weekly usage limit. Save this unfinished increment and resume from here after reset. Full V1 remains active. Continue verified increments directly to main, without PRs or a human-review release gate. Keep operation local and free.

## Saved work

Owned checkout is `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`, package `openplan/`. Parent checkpoint is `75fb2aedad9b7e127ed69a0b5c569ce6b4abd07c`. This checkpoint contains the private retained-output codec, SQL delivery, actual migration 20261014000013, and probes of that migration. Review candidate SQL copies are historical snapshots; `generation_schema_source.py` reads and mutates the canonical migration sections. Both serial probes execute the whole migration.

The codec retains exact JSON string bytes, including escaped NUL and lone surrogates, with receipt identity and a delivery digest. SQL retains opaque output/provider metadata as TEXT, checks safe binding fields, preserves original acknowledgements on retries, and retains late output without reviving cancelled or interrupted jobs. These are foundations, not a connected end-user generation workflow.

## Recorded verification

The final restored probe returned passed=true and rollbackContained=true; its migration SHA256 is `3daf131f02d2476a293cccde3ab5e74e73182dd0d5291db696df791bf0873cad`, matching current source. No probe process remained when checkpointing.

- Six focused suites, 108 tests passed. TypeScript and focused lint exited zero in the preceding work, with private logs retained.
- Queue controls: 30 cases, three intended survivors and 27 targeted failures, all expected outcomes.
- Output controls: 26 cases, five intended survivors and 21 targeted failures, all expected outcomes. Removing the attempt check failed at the wrong-attempt assertion; removing digest checking failed at changed delivery digest. Harmless comments survived.
- Independent held PostgreSQL transactions showed a competing output delivery returning busy, followed by an identical acknowledgement after retry. Readback equalled codec bytes and passed native codec round-trip. Exactly one dispatch usage event remained.

See `generation-output-controls.json`, `generation-queue-controls.json`, and `generation-output-concurrency.json`. Private logs are under `/home/nathaniel/.local/state/openplan/response-write-probe-20260913`, especially generation-output-tests-final.log, generation-output-type.log, generation-output-lint.log, generation-queue-migration-controls.log, generation-output-migration-controls.log, generation-output-concurrency.log and generation-output-restored-probe.json.

The first edit invocation used the wrong directory and its following tests exercised old source; generation-delivery-preedit-tests.log is not new-code evidence. A fixture import initially failed before SQL execution and was corrected to resolve the existing application dependency. The first output mutation run expected the wrong failure wording; the actual guard failure was valid, the expected marker was corrected, and the full run repeated successfully.

## Databases and processes

Serial tests use only disposable container `supabase_db_openplan-restore-target-2026091050`, database postgres, with BEGIN/ROLLBACK. It remains installed through migration 20261014000012; migration 13 was not permanently applied there. The authenticated manual write RPC remains revoked.

Concurrency evidence uses container `supabase_db_openplan-restore-target-2731143`, separate database `openplan_translation_command_proof_20260913`, not its postgres database. Queue and output candidate definitions and synthetic proof rows are retained there. No model or worker is connected. Do not reset either stack or attach a worker to synthetic proof jobs.

Dev port 3260 belongs to this checkout. Port 3261 belongs to `/home/nathaniel/.local/state/openplan/workspace-switch-v0581-2026-09-13` and its previously built v0.58.1 patch. Re-establish served identity and process ownership after reset; neither process needs to survive for resumption. Original checkout and demo remain untouched; another Codex process was active at checkpoint time.

## Next implementation

1. Re-read current direction, ownership and main/CI state. Last recorded released version is v0.58.1; last recorded main is ef16f166447ab477ea36588a5c01620f61560b19. Recheck live before relying on these. This translation branch is unreleased and still needs main integration.
2. Join the durable worker using existing provider-api-worker.ts and workers/planner_agent_connector journal/locking conventions. Extend strict credential preparation to return the selected ciphertext hash from the same read. Bind captured credential, field packet, attempt and reservation. Do not silently fall back after key changes.
3. Persist running state before dispatch/model invocation, and completion bytes before delivery. A recovered uncertain running attempt must never call the model again. A recovered completed attempt must redeliver exact bytes even after source/key/access changes. Validate the full acknowledgement before retiring the journal. Status checks must abort on cancellation, expiry, lost access or failed reads.
4. Connect authenticated queue routes and real worker RPC projections, then public producers, provenance/cache publication and retained publish_generated. That command still deliberately refuses. Manual legacy grants remain revoked.
5. Verify worker restart/retry and actual browser navigation on desktop and 390px, keyboard, console and mutations. Then full QA, shuffled tests, isolated RLS, worker and upgrade/restore checks, main CI and release evidence. Do not claim these broader checks were run for this checkpoint.

Blind categories remain real provider behavior, environment-key plaintext attestation in SQL, HTTP actor binding, actual worker interruption/restart, public publication and browser usefulness. SQL cannot independently recover invalid Unicode text for its output hash; it protects serialized bytes/digest and the native codec verifies reconstructed output. Existing legacy AI producers also need review for shared allowance atomicity. No paid provider calls were made in these tests.
