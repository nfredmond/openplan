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
