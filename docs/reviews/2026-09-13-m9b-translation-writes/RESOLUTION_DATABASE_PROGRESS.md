# Generation resolution database and receipt checks

Continues the usage-reset checkpoint `a278a13d` in the owned translation checkout and `work/translation-command-workflow`. The previous goal turn made progress by committing and pushing the unfinished work with a recovery note. This checkpoint checks the proposed database rules and fixes validation before a server write. The feature remains unfinished and unreleased; the full V1 objective is unchanged.

## What changed

The resolution server helper now validates scope before calling the database. Previously it validated that scope only while checking the returned receipt, after a write could already have occurred. An invalid scope now produces no RPC call.

The candidate migration parses in a rollback transaction. `translation-generation-resolution-live.test.ts` has 21 native PostgreSQL cases. They check exact damaged strings including NUL and lone surrogate escapes, original-receipt replay, distinct copies, late creation and creation replay refusals, queued/reserved cancellation, running interruption, late output retention without revival, unchanged completed output and request intent, field inventory, original actor/current staff access, private receipt reads, service metadata-only access and immutable receipts. A native generation delivery codec supplies synthetic output to the real dispatch and retention RPCs. No provider is called. An absent resolution cannot block another actor's request using the same UUID.

Every fixture and candidate DDL statement runs inside a transaction that rolls back. The deterministic reservation is synthetic; dispatch and output retention use the actual database functions. The missing-inventory probe temporarily disables the fixture's immutability trigger and removes only its synthetic field inside that same rolled-back transaction. Nothing queued is committed or visible to another worker.

`translation-generation-resolution.test.ts` has 39 unit cases for exact payload/result identity, byte digests, coherent field outcomes, encoded copies, invalid reasons, pre-write validation, exact authenticated RPC arguments, refusal classifications and unchecked acknowledgements. Together with the existing generation-route tests, 85 tests pass. Focused ESLint and TypeScript pass. Release-ordering checks pass, six tests, after documenting candidate migration 19 in the unreleased changelog. These checks do not establish a working resolution endpoint or editor.

## Counterfactual evidence

`prove-generation-resolution.py` runs baseline and harmless changes for SQL, schema and server code. All six survive. All 29 targeted faults fail their named cases. Faults include allowing late creation, changing replay payloads or markers, rejecting a second distinct copy, resolving another actor's request, leaking to other staff/service credentials, removing immutability, mislabeling running work as cancelled, missing inventory/output, cross-actor tombstones, mismatched payload/result scope and IDs, incoherent states/attempts, invalid opaque encodings/reasons, unchecked digests, writes before validation and unchecked acknowledgements. `generation-resolution-controls.json` retains source/test hashes and private result locations. The final report matches the restored source bytes.

The first service metadata test filtered by the receipt ID, which is intentionally outside the service role's column grants. PostgreSQL correctly refused it. The test now filters by permitted request/actor metadata. The first fault-run baseline consequently stopped, rather than counting that failure as a killed mutation. The corrected complete run is the retained report.

These tests cannot establish simultaneous create/resolve serialization, HTTP authorization/body handling, browser storage and acknowledgement recovery, provider transport behavior, installed upgrade behavior or full release readiness. Incomplete-output resolution and the remaining terminal-state combinations also need explicit coverage before broad outcome claims. The existing 404 console issue and public-generation durability work remain open.

## Exact resume point

The application stack remains `supabase_db_openplan-restore-target-2026091050`, database `postgres`, 337 migrations through `20261014000018`. After all probes, migration 19's table was absent, 27 existing fields were cancelled and four were completed; none were queued/reserved/running. Ordinary dev remains the previously recorded port 3260; re-identify its process and served checkout before browser work. The original checkout and demo were untouched. No main merge or tag occurred. Another Codex process remains active in the original checkout.

To rerun the candidate test from the owned `openplan/` package:

```bash
OPENPLAN_RLS_LIVE_TEST=1 OPENPLAN_TRANSLATION_RESOLUTION_CANDIDATE=1 OPENPLAN_SUPABASE_WORKDIR=/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050 npm exec -- vitest run src/test/translation-generation-resolution-live.test.ts
```

The new native file is not yet registered in `test:rls-live`; register it and the new private table census when activating the migration. Without the candidate flag the test expects migration 19 already installed; it must not silently install missing production DDL. Never set the candidate flag on an already installed migration 19.

Next prove simultaneous create/resolve using independent connections in a separate named proof database, plus remaining terminal outcomes. Then add the authenticated resolution API with origin/stream limits, agent refusal and exact receipt verification. Add the metadata preflight before queue credential preparation while retaining the authoritative SQL gate. Connect durable pending-resolution intent, exact retry and checked local archive behavior to the editor, then verify actual navigation, keyboard, console, desktop and 390px. Full QA, shuffled tests, worker/upgrade checks and final main CI remain release requirements. No human review is required to release the completed engineering increment.
