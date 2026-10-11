# Review corrections before integration

The PR review at `9e7918dd6cc0` identifies three recoverability defects. The production journey and complete GitHub checks at `f6394f05` remain dated evidence; they do not establish acceptance of these corrections.

## The legacy reaper leaves managed execution alone

A managed worker renews its private execution lease without refreshing the legacy version timestamp. The legacy stale sweep can therefore select a healthy enrolled version and attempt a write outside its managed context. The trigger rejects that write, stopping cleanup before later work is considered.

Candidate migration 28 now excludes every enrolled managed version after the existing feed/version lock sequence. Managed execution owns its lease, replacement and closure. An unmanaged stale version still closes normally. Because the service role cannot read the private execution table directly, the service-only reaper uses definer access and an empty search path. Explicit execute revokes keep anonymous and authenticated callers out. Private schema and table grants stay closed.

[Native SQL controls](managed-reaper-controls.json) apply candidate migrations 28 through 31 to a retained clone of the recorded predecessor. The healthy managed execution, version and feed remain identical after a deliberately eligible future cutoff. Its lease stays live; an unmanaged fixture closes. Actual unauthorized RPCs and private-table queries fail with SQLSTATE 42501. Removing the exclusion fails at the managed write guard, changing the function to invoker access fails on its private query, and opening authenticated execute fails the scope assertion. Function definitions and privileges restore in `finally`. No proof database is deleted. This is an eligibility challenge, not an observed 15-minute import.

## Cancellation supersedes pending terminal delivery

The attempt coordinator checks cancellation before inspecting or replaying a retained completion/failure. It observes the terminal state and leaves the exact obsolete command bytes unchanged. Queue recovery settles that cancelled job without another work callback or claim. Lost replies after actual ready/failed completion continue through receipt replay.

[Recovery controls](review-recovery-controls.json) cover both pending completion and failure, queue settlement and the actual installed CLI. [Native cancellation recovery](cancelled-terminal-native.json) uses real isolated PostgREST claims and SQL cancellation, retained private journals and fresh Node processes. Three positive cases recover twice without terminal replay; removing cancellation precedence reproduces an unavailable acknowledgement against the cancelled execution. Native rows retain one cancelled attempt, one claim, zero derived rows and no adoption. The complete command contains synthetic unpublished evidence; this is not a parser-publication proof.

## The supervisor respects the operator's parse budget

The installed CLI obtains parser options from the configured cooperative parse budget. It preserves the 30-minute default supervisor window and extends it to a larger budget plus 30 seconds for startup/output. Integer and timer-range checks prevent Node from clamping an excessive timeout to immediate expiry. The actual CLI invocation test observes a 45-minute budget becoming a 2,730,000 ms supervisor deadline. A fixed helper deadline, a CLI override and omitted overflow refusal each fail their intended tests. This does not establish an actual 45-minute parser run or largest-feed capacity.

The [unit control report](review-recovery-controls.json) records three positive and four broken variants. Strict changed-file lint and scoped TypeScript pass in [the check report](review-recovery-checks.json). The final expanded native harness receives its own type check. Original controls remain bounded to mocked database transport and configuration; native SQL and HTTP checks remain separate.

The [first control expectation](review-recovery-controls-initial-failure.json) uses the wrong Vitest error text and receives no complete control credit. Its source restores. The [first native fixture](cancelled-terminal-native-initial-failure.json) reuses one normalized URL for separate new feeds; SQL correctly rejects that duplicate. Independent cases now use unique synthetic URLs. Both failed attempts remain visible.

## Current boundaries

The previous candidate [full archive restore workflow](ci-f639-restore-success.json) passes its 372-table, one-file fixture and all 1,492 restored RLS tests, with 125 skipped. Current live RLS, final joined CI, production build/read and release remain separate. The [reviewed SQL inventory](reviewed-schema-join-candidate.json) supersedes the earlier candidate hash manifest. Migrations 28 through 31 must precede app deployment even with managed admission disabled. No cloud migration, hosted service, public signup, DNS or paid infrastructure changes occur here. Managed mode remains opt-in; the candidate is unreleased. No scientific, practitioner, cross-host or full M3 acceptance is declared.
