# Saved API worker, September 12

This is an unfinished roadmap A0b implementation. Main b6dbb8ca completed CI
34725416835, RLS Isolation 34725416839 and Upgrade Path 34725416832 successfully
before this worker work began. The earlier lifecycle and decoder checks remain
separate evidence in ../2026-09-12-api-turn-lifecycle/VERIFICATION.md.

The new worker reuses the connector's private directory, OS lock, bounded JSON
read and synced journal writer. A claimed API job is journaled before generation.
It loads only the exact workspace/connection/revision credential row, observes
current status and lease, and uses the existing generation adapter. Completed
output is synced before the common finish RPC. Recovery of a running journal
fails the old attempt without generating. Completed delivery retries neither
claim nor generate. The database remains the job and reservation authority.
A delivered journal discards the completed answer and receipt; its original
frozen job remains private until the next attempt replaces it.

The command is npm run worker:provider-api, optionally with --once. It uses the
configured Supabase URL and service credential; its default private directory is
separate per destination. Startup --once against the named disposable stack at
API29821 passed and reported idle. A preflight found zero active API jobs. No
provider call occurred in that startup probe. This is not generation acceptance.

## Discovered defects and test weaknesses

The first worker run passed 29 cases but timed out after 20 seconds on deliberate
loss of its own lock process. The shared native helper waited for another exit
event because a signal-terminated child keeps exitCode null. Cleanup now checks
both exitCode and signalCode, always closes stdin, and uses flock --no-fork so
one child owns the lock. The process-loss case now identifies its own newly
started child, confirms that flock execed cat, terminates only that child, and
requires a bounded cleanup failure if the old waiting bug returns. The existing
native suite passed 382 cases with four skipped after this change.

Initial TypeScript checks also caught the query builder's abortSignal ordering
and a widened protocol literal in a synthetic test receipt. Those were corrected;
no type suppression was added to production code. The worker baseline grew to
38 passing cases with real filesystem and OS locking, but mocked database and
generation calls. Changed-file lint and an earlier TypeScript run passed; final
checks on the completed implementation remain pending.

The initial mutation campaign is retained in initial-mutations.json. The runner
incorrectly required an AssertionError prefix even though Vitest rejects-match
failures use Error plus a __VITEST_REJECTS__ stack. Named expected error codes
also represent the two deliberately broken completion-recovery paths. The
runner now checks those specific failure forms, not every nonzero exit.

One real test gap survived: removing generation-code sanitization could send the
canary to the finish RPC, while the test inspected only the delivered journal
that had already discarded the completion. It now checks the RPC payload and
exact sanitized code. Inspection of the polling mutation also showed that a
cleanup abort after the fake provider timed out could set a misleading success
flag. Both cancellation fixtures now ignore aborts after their promise settled.
The initial polling fault failed only the later-response assertion; the revised
campaign must fail the direct timely-cancellation assertion too.

## Pending evidence and limits

The revised mutation campaign completed 43 cases with exit zero: one harmless
control survived and 42 faults failed for their named assertions or specific
recovery errors. Both source files were restored and checked by SHA-256; private
recovery state is /tmp/openplan-api-worker-mutations-fkpjR0/state.json.
The restored five-file replay passed 176 tests, including all 38 worker cases.
The native replay passed 382 tests with four skipped. TypeScript and changed-file
ESLint passed on the restored source. No full QA or shuffled run has yet been
performed on this worker increment. Tests use real
private files/flock but mocked Supabase and generation. They cannot establish
PostgREST serialization, encrypted-key loading through the real SDK, end-to-end
process interruption, response-loss recovery against real retained jobs, or
browser navigation. The existing independent adapter and SQL campaigns cover
different boundaries. The project POST discriminator and UI still need joining.
No new provider option or release is claimed. No external paid service is used.

## Real-process checkpoint before usage reset

The new provider-api-worker-live.test.ts passed all 11 cases against the named
disposable database, actual child worker, real SDK and synthetic local HTTP
endpoint. The first access-loss fixture failed the last-owner constraint;
adding a second synthetic owner corrected the fixture without changing guards.
The separate live mutation campaign completed one harmless survivor and six
expected faults. All outcomes and named failure messages are retained in
live-mutations.json. The production worker source matches HEAD after restoration.
These tests extend the earlier mocked boundary with dispatch, encrypted saved
credentials, completion-response recovery and real process interruption.
They do not establish browser reachability or external-provider compatibility.
A final restored live replay, full QA, shuffled tests and full isolated RLS on
this increment remain pending. RESUME.md records the exact continuation.
