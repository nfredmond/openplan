# Combined candidate acceptance, October 7, 2026

## Exact build

Application commit `10c3bc0cadf32a1714c0bcaf931bb5e33537d817`, version
0.68.0, has build ID `j06tqIf_AJ7KqErsLVaKe`. The isolated production server
on port 3509 has PID 2525534 and invocation
`cd9ff9dd01d945c9ac7a61a8b2bbd060`. Its process cwd identifies
`/home/nathaniel/.local/state/openplan/v068-release-20261007/openplan`.
The browser health response confirms the commit and version. Health does not
check the database. This documentation checkpoint uses a separate checkout.

## Engineering checks

Local QA invocation `0cb34061c6f94952bb7d9b23302f0f1a` finishes successfully
at 03:22:50 UTC on October 8. It passes 20,044 tests in 1,509 files, with
1,565 tests in 94 files skipped. Lint, dead-code checks and the webpack
production build pass. Provider checks pass 387 cases with four skipped;
dependency checks pass 18 cases and report zero vulnerabilities. Live RLS is
explicitly disabled in local QA and remains a separate GitHub check.
The initial launcher syntax error remains in the private record; it is not
included in the successful invocation.

[Candidate CI](https://github.com/nfredmond/openplan/actions/runs/37719603937)
and [worker checks](https://github.com/nfredmond/openplan/actions/runs/37719603936)
pass on that exact commit. Both normal QA and shuffled-test jobs succeed.
The [populated upgrade](https://github.com/nfredmond/openplan/actions/runs/37719722645)
from v0.67.0 passes its retained project and operational-row assertions.
Representative upgrade fixtures do not establish full-archive restoration.
At this checkpoint, candidate RLS run 37719603999 and full-archive restore
run 37719725094 remain in progress. No tag or release is declared.

## T3 browser evidence

The same T3 tab exercises real navigation at desktop 1440 by 900 and mobile
390 by 844. Its acceptance window begins about 03:23 UTC on October 8.

- My Work's Unassigned view retains both conflicting award and milestone
  deadlines and the review-needed explanation. The award link opens project
  funding. No award or milestone is changed during combined acceptance.
- The project Delivery tab displays the December 15 calendar-only milestone
  without converting it to December 14 or adding a time. Timestamp fields
  retain their separate local-time display behavior.
- Project Overview distinguishes two linked campaigns from zero retained report
  items. Its link opens the two-campaign filtered list. A duplicate-link locator
  initially fails; targeting the displayed card succeeds.
- Campaign Analysis opens the saved source, generation history and request
  `ec8dbd11-1473-4465-a072-496c4da12fd8`. Saved results remain incomplete with
  four unselected tasks. The resource assessment displays 68,699 required bytes
  against the saved 65,536-byte limit, uses the corrected source-material wording,
  and preserves the warning against resending an uncertain call. Sequence zero
  retains history SHA-256
  `86a4dac68319da39ce845f7fb03e9da9f861ab9af31bb47f914f0cd0c98c5301`.
  No new execution allowance or provider call is initiated.
- Travel modeling navigation opens the published development card. Butte and
  Merced retain separate methods and artifact identities. Merced ActivitySim
  meets its development gate while AequilibraE fails and is retired. The study
  remains inconclusive and no model default changes. Mobile page scroll width
  equals its 390 CSS-pixel viewport. Two native select-key calls report tool
  timeouts; the settled page confirms Merced is selected.
- Browser retrieval of all three displayed Merced ActivitySim artifact URLs
  returns HTTP 200, attachment filenames and exact displayed SHA-256 values.
  Their sizes are 21,967,002, 7,145 and 9,165,314 bytes. Byte retrieval does not
  establish a completed native file save.

The same-tab health snapshot exposes all 18 retained console entries. All
precede this combined acceptance window; no new JavaScript exception is recorded.
The retained network entries show aborted background RSC requests. Older network
entries are omitted, so this is not a complete network audit. A failed scroll
probe is corrected before capturing the resource panel. Screenshots are inspected,
not merely captured.

Private evidence lives under
`/home/nathaniel/.local/state/openplan/v068-release-20261007-proof/`:
`my-work-mobile.json`, `project-browser.json`, `resource-browser.json` and
`models-and-console-browser.json`. These retain screenshots, URLs, measurements,
checksums and tool limitations. Earlier constituent reports retain their own
build identities and broader workflow records.

## Unfinished boundaries

This is synthetic software acceptance and published development-file inspection.
It does not prove observed practitioner/public outcomes, native date entry,
every artifact's native save, independent scientific acceptance or the full V1
contract. Both modeling methods remain distinct. No frozen modeling artifact or
acceptance holdout is changed or reopened. Required database checks and final
main integration remain open at this checkpoint.

## Integration accounting

Integration commit `4cc48ca131758c627cc49985bb74bd153ed3ebd2` includes the
updated calendar branch `d93347f32a11ff652d50e8c701872984657438af` and current
main `2e2c9e94eccfcb92d1fed699d41eaa4f2d29ae8f`. Its application tree is
identical to the tested candidate. Its only file difference is this evidence
record. The branch is pushed as `work/v068-evidence-20261007`.

The refreshed 63-worktree audit finds every worktree HEAD reachable from this
integration commit and contained in a remote branch. The only working change
is the canonical checkout's untracked `.directory`, which is preserved.
This accounts for recorded worktree heads, not lost unsaved buffers or unknown
external clones. The machine-readable private record is
`v068-release-20261007-proof/worktree-audit-latest.json`.

PR #140 at `92894d9168be32ea653e9afd7fb68a7480aa1197` now passes all seven
GitHub checks, including live RLS run 37719459636. PR #142's previous head
passes all seven checks, but GitHub refuses its merge because main advanced.
The normal update-branch operation produces `d93347f3`; its new CI and RLS
checks are running. No protection is bypassed. These heads are included in
the combined integration history, but integration into main is still pending.

## Restore completion and main CI follow-up

Full-archive restore run 37719725094 succeeds on `10c3bc0c`. Its retained
manifest covers 340 database tables, 385 migration records and one seeded
Storage object, with bootstrap state preserved. The drill reports matching
database rows, evidence custody, Storage bytes, relationships and live RLS.
Its native suite passes 1,462 tests in 101 files, with 125 skipped. The scope is
the default local CLI database and Storage; external workers, custom roles and
scheduled SQL jobs remain outside this drill.

Main CI run 37721660435 at `2e2c9e94` fails two land-use context-editor tests.
Both immediately inspect the parent freeze callback after waiting for a separate
rendered state. The component publishes that callback through a React effect.
The tests now wait for the asserted callback value using the existing waitFor
deadline. No application code, assertion outcome or timeout is changed.

All 26 editor tests pass on the restored component. A harmless component comment
passes the two changed cases. Holding the callback permanently blocked fails
both cases at their bounded assertions. The mutation is restored, and all 26
cases and targeted ESLint pass again. The original failure log is retained as
`main-2e2-ci-failed.log`; callback-control logs are `context-editor-*.log` in
the private release proof directory. These are component-timing checks, not
new browser or native database evidence.

The follow-up assertion audit finds the same asynchronous callback boundary in
"keep draft copy and use saved context." That test also waits for the callback,
with no timeout change. Its harmless comment passes, permanently blocking the
callback fails the targeted case, and all 26 restored editor tests pass.
Private evidence is in `context-preserve-*.log` and
`context-preserve-mutations.json`. This additional test correction does not
change the application build or restart the separately running obligation QA.
