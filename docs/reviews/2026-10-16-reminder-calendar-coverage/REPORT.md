# Missing reminder calendars are reported

October 16, 2026. Parent candidate `bad4875bd4e6932da20dc667241e2dceccaf05a4`.
This correction changes the existing reminder sweep's availability disclosure.
It does not run a real sweep, send email or establish delivery acceptance.

## Change and purpose

The calendar reader previously marked a failed query unavailable, but accepted a
successful partial or empty response without that flag. A requested workspace
missing from the response used UTC while `workspaceCalendarsUnavailable` remained
false. The reader now checks that every requested workspace has a calendar row.
Missing rows set the existing unavailable flag. UTC fallback and each readable
peer's calendar remain unchanged.

Two tests exercise the actual sweep with its existing filtered fake database.
One omits a calendar while a peer remains readable. It checks the unavailable
flag, exact calendar projection and requested IDs, UTC fallback, and the peer's
different reminder window. The other returns no calendars and checks disclosure
while reminders continue on UTC days. No source, schedule, recipient, roster,
notification write or email transport policy changes.

## Checks that ran

The required direction check exits zero in 2.128 seconds. Existing review-expiry
and version reminders remain unchanged. The check does not renew those reviews.

A single bounded check unit completes in 21.710 seconds. Its selected eight
calendar cases pass with a harmless source comment, pass on the baseline, and
pass after restoration. Removing the new coverage check causes exactly the two
new tests to fail with `AssertionError: expected false to be true`. Their actual
locations are `work-notification-sweep.test.ts:1058:50` and `:1075:50`. The other
six selected cases pass. Root reads both the structured failures and full stderr.
Focused ESLint exits zero. All eight pinned source/configuration/helper files
match after the unit; the private mutation subject restores exactly.

The unit records 1 GiB memory, zero swap, CPU 50 percent and 64 tasks. Its sampled
cgroup peak is 388,980,736 bytes, with no memory or PID-limit events. The actual invocation is
`ab1b195f21ab47d7a5f271ab45ec8e5c`. The host and test sources remain read-only;
the only changed subject is a private file mounted over the owned module.
The donor dependencies are read-only before the first dependency command.
The environment and caches are private, the network is unshared, and `/dev/null`
is the narrow device bind. This does not establish that every inherited nested
mount is read-only.

A separate full-file regression then passes all 49 tests, with none skipped or
failed, in 4.283 seconds. This checks the remaining sweep fixtures once; it does
not repeat the mutation campaign. Invocation is
`b5e83ccd96fa4f368153998c0180d8f1`. Both units reach terminal success and release
their nonblocking exclusive compiler-lock acquisition. No source changes follow
the passing checks.

## Evidence boundary

The 49 tests include the eight selected calendar cases. Repeated controls do not
increase the number of distinct tests. Query projections and filters are
asserted, but database responses, writes and email effects are simulated.
No database, production sweep, cron, HTTP, email, browser or hosted operation
runs. Full configured TypeScript, full application QA, release CI and actual
delivery remain unverified by this checkpoint.

The change reports missing calendar rows. It does not newly classify malformed
time-zone values, change calendar fallback policy, establish cross-batch race
behavior or prove worldwide reminder coverage. The complete M2c, M11 and V1
requirements remain open. The earlier KI-016 source-only record stays intact.
Private receipts, exact command/configuration/source pins and raw failure
streams remain under
`/home/nathaniel/.local/state/openplan/reminder-calendar-coverage-root-20261016`.
