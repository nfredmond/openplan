# Public translation server and explicit retry checkpoint

The previous goal turn made progress with `1a6eae7c`, the initial public database candidate. This increment adds deliberate retry chains, pre-credential discovery and typed server queue/read helpers. It remains development work toward the complete V1 contract. Do not announce a release or public workflow completion.

Worktree: `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. App commands run in its `openplan/` directory. Original checkout, demo and pending reminder constraint remain untouched; another Codex was active in the original checkout. No PR, human-review gate or paid operation is required. Recheck ownership before merging main.

## Implemented

`public-generation-queue-candidate.sql` now records an immutable predecessor for each deliberate retry. A root has at most one chain, and an attempt at most one successor. Only failed, interrupted, incomplete or cancelled attempts may get a successor. Completed or active work must be recovered. Repeating an earlier retry returns its exact child even when a later grandchild exists; ordinary discovery finds the current leaf. The old request, field, dispatch and output evidence remain intact. Creating a successor does not itself authorize another provider dispatch; the existing public allowance applies when claimed/dispatched.

`find_public_translation_request` returns an existing current request before the server prepares a credential. Exact read and discovery accept the displayed source snapshot and check it under SQL's public-source lock. The private creation helper is not granted to anon, authenticated or service_role; narrow root/retry wrappers own its writes. The schema candidate is still under the review directory, not the migrations directory.

`openplan/src/lib/engagement/public-translation-generation.ts` validates public scope, supported machine language, exact displayed-original SHA-256 and optional named predecessor. It uses the existing packet and credential helpers and existing worker-compatible fields. Conclusive lookup happens before credential selection. A retained result needs no new key. A new request captures the current original and selected credential; an explicit retry first reads its terminal predecessor. It pins the source snapshot in lookup, creation and receipt reads, checks returned request/language/state, refuses incomplete words as completed output, and checks cancellation after awaited operations. Database failures remain failures, not empty queues.

These helpers are not connected to the public endpoint or page yet. Legacy valid cache reads, endpoint request/body/origin/agent-marker behavior, public browser polling/retry/cancellation and the real worker join must be completed before activation.

## Evidence

- 50 server tests pass. Focused server plus existing generation, generation routes and editor regression passes all 183 tests in four files. `public-translation-server-regression.log` under the private evidence root records the run; terminal exit was 0.
- Focused ESLint with `--max-warnings 0` passes as a standalone command. TypeScript `--noEmit --incremental false` passes. Actual tests ran from the application package with Vitest 4.1.11. An unnecessary version query from the repository root resolved cached Vitest 5.0.0; it ran no tests and did not establish package identity. No repository changes came from that query.
- `public-translation-server-controls.json`: baseline and harmless comment survive; 26 targeted server faults fail the named tests. Source bytes were restored and their hash checked.
- `public-generation-queue-controls.json`: four controls survive, 34 targeted SQL faults fail. This includes existing staff regression, deliberate successor behavior, original preservation, private public request access, explicit source-snapshot pinning, allowance accounting and previous checks. Transactions roll back in the original resolution proof DB.
- `public-generation-concurrency-evidence.json`: five cases include overlapping root creation, overlapping explicit retry, and baseline/harmless/broken cross-campaign budget serialization. Concurrent retries create exactly one successor and lookup returns it. Removing the budget lock still demonstrates an oversubscribed last slot. The original claim function is restored. This record now names `openplan_public_translation_retry_proof_20260913`; older evidence for the earlier public proof DB remains in Git and private logs.
- `public-translation-server-evidence.json` binds current source hashes and regression log. No browser or real encrypted public-worker execution is claimed. RPC names/snapshots are asserted in mocked server tests; native SQL covers a separate boundary.

## Errors caught and limits

The first helper draft checked the original in one read and then looked up a job without pinning that original. A source change between those calls could pair another source's result with the displayed old text. Both SQL lookup/read now accept and atomically compare the exact snapshot. Targeted SQL faults and server argument assertions cover that join.

The new retry SQL probe initially left the connection in service_role before the older staff probe tried to create auth fixtures. It failed and rolled back; resetting to the schema owner between probes fixed the fixture setup. A predecessor-scope fault initially hit the independent active-state guard because the test's predecessor had not failed. The corrected test makes the predecessor terminal and varies only item scope; it now detects the removed predecessor guard for the intended reason. Failed logs remain retained.

Current tests do not cover all API or browser inputs, live cookies, public encrypted credentials, provider SDK transport, output journal recovery, final RLS/upgrade, or production activation. The new SQL default snapshot parameters preserve internal proof call compatibility; the server helper always supplies the checked snapshot. A future route must not omit that argument. Earlier full QA/worker/RLS results belong to their earlier commits.

## Custody and restart

The application test database remains `supabase_db_openplan-restore-target-2026091050`, API 29821 / DB 29822, at 338 migrations through `20261014000019`. Its public request mapping table is still absent. Browser server 3260 remains stopped.

Both `openplan_public_translation_proof_20260913` and `openplan_public_translation_retry_proof_20260913` are separate schema-only proof databases in that container. They retain synthetic queued/reserved fields with deliberately unopenable public credentials. NEVER connect a provider worker or PostgREST to either. The newer DB was created from the saved resolution-proof schema and loaded with the new candidate. No drop/reset or fixture deletion was used. Old proofs and database histories are preserved.

Private evidence root is `/home/nathaniel/.local/state/openplan/response-write-probe-20260913`. Serial controls, successor concurrency, server fault checks, lint, types and regression jobs reached terminal success. Their source hashes match. Verify actual process/handle state before restarting a command; an old log alone is not liveness evidence.

## Next implementation seam

1. Connect the anonymous translate endpoint to these helpers. Require the hash of the displayed original, preserve valid legacy cache reads without new spend, distinguish queued/running/completed/incomplete/failed/interrupted states, and add exact status/recovery reads. Use bounded strict JSON, private no-store replies and executable agent refusal where the action is unregistered. Preserve public access as anonymous rather than inventing staff identity. Retire the old direct provider invocation and post-hoc public usage check/record together when the new route is ready.
2. Public portal must compute the same SHA-256 of JSON `[title, body]`, show the original while queued, retain request identity for recovery and offer an explicit new attempt only after a terminal failure. Late results after clear, locale change or unmount must be ignored. A shared public request should not be cancelled just because one reader changes locale. Separate browser-safe schemas from this Node-only helper if importing runtime validation into a client component.
3. Prove actual existing-worker execution with encrypted synthetic credentials and intercepted provider transport, including acknowledgement loss, output retention, source/token/key withdrawal and interruption. Bind the worker/database join to the candidate, then install an additive migration only on the named isolated application stack for HTTP/browser acceptance. Expand native/RLS cases for new functions/table/relationships.
4. Run real root/navigation desktop and 390px journeys, keyboard, console and receipt/output evidence. Complete applicable full QA, shuffled, isolated RLS, workers and populated upgrade from v0.58.1's migration `20261014000009`. Merge directly to main after ownership checks, inspect final CI and tag under the release policy. Continue all remaining V1 requirements. No human-review gate is added.
