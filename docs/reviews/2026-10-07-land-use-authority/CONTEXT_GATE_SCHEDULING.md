# Await the reported freeze state

October 7, 2026. The [PR 126 shuffled job](https://github.com/nfredmond/openplan/actions/runs/37634282619/job/112836269563)
fails one context-editor assertion at `901a9437`, with seed `175639`. The run
passes 18,643 tests and skips 1,534. The [retained failure excerpt](creation-workflow/gate-scheduling/ci-failure-excerpt.log)
records the initial `blocked()` assertion. Other checks remain separate.

The test waits for an editable field, then immediately expects the parent's
freeze-state callback to report false. The component reports that state through
a separate React effect. The test now waits for the callback's false value both
after initial loading and after the saved context refresh. It still requires
blocking during edits and the deliberately held refresh, and still checks exact
request retention before transport. Application code is unchanged.

The original file passes by itself with CI's seed. That does not reproduce or
explain the whole CI scheduler. A controlled 50-millisecond initial callback
delay demonstrates the narrower timing assumption: the old assertion fails,
while the corrected assertion passes. The delay is a temporary control and is
not part of the application.

The [seven controls](creation-workflow/gate-scheduling/controls/report.json)
pass baseline, harmless comment and delayed-initial-delivery cases. They detect
the old assertion under that delay, a permanently blocked gate, a gate that
stays blocked after saving, and premature unblocking. The script checks the
named failed test and restores source bytes after each case. These controls
show that awaiting delivery has not removed the consequential state assertions.
They do not reproduce every React schedule or establish browser acceptance.

The [related shuffled run](creation-workflow/gate-scheduling/shuffled.log)
passes 36 tests across the context editor, workbench and freeze control with
seed `175639`. Changed-file ESLint passes. No new production build or native
database run is necessary for this test-only correction. The existing build
and workflow evidence retain their original scope. Fresh complete GitHub
checks and rendered acceptance remain required before landing the PR.
