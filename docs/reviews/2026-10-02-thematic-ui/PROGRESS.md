# Thematic Analysis UI continuation

October 2, 2026. Unreleased work in the isolated thematic-import-ui worktree,
now based on main `a8f71830`. The [combined integration](INTEGRATION.md) is landed;
the UI changes described here are still being exercised.

Current checkpoint: full QA passes before the final focus correction. That
correction separately passes 51 focused tests, a harmless control, five detected
faults, strict lint and a production build. Production-browser focus and busy-read
checks remain open, as does confirmation of actual saved browser downloads.
This is a development candidate, not a release or completed v1 acceptance.

The current implementation adds private request browsing for a saved source,
original-proposal preview, dedicated browser recovery and explicit replacement
of an exact staff-review parent. It retains machine authorship, earlier
uncertainty, original contribution text and downloadable proposal/history JSON.
The category editor still refuses thematic commands in its own recovery slot.
Imported drafts and their later corrections retain the original machine evidence.

## Evidence so far

Dedicated recovery: 11 tests pass. A harmless control survives and 27 targeted
faults are detected. The [record](recovery-mutations.json) names source and log
hashes. These are browser-storage/transport checks, not native authorization.

The actual preview route joins the original history reader over synthetic
transport. Nine tests cover source identity, cancellation, incomplete/unsealed
states, denied final access, corrupt captures and original-byte checks. A
harmless route control survives and 24 targeted faults are detected in the
[browser record](browser-mutations.json). Full restored application controls pass
20 cases across the route/browser and recovery files. Native access is a separate
boundary; a mock response is not an installed RLS proof.

Migration20261015000011 adds an authenticated, current-staff request list for an
exact saved source, using 25-entry keyset pages. Candidate baseline and controls
pass. All 16 installed checks pass on the owned restore-target: full source
scope, tied timestamps, bounded continuation, cancelled/departed requester
history, role/principal refusals and privilege faults. Every SQL fixture and
mutation rolls back. Listing does not establish complete output, accuracy or
execution authority.

Preserved failed attempts include a reused fixture cancellation ID, a fixture
that attempted to remove its last owner, and a principal-fault diagnostic that
expected the later foreign-account assertion rather than the earlier viewer
leak. The fixture now uses its own cancellation ID and a separate retained owner.
The permission guard was not weakened. The first browser source-mismatch test
expected different error wording; the existing review verifier correctly refused
it. The follow-up also tests the distinct preview/source comparison.

Initial standalone TypeScript exhausted its default heap. The 6GiB retry found
one inferred test-query union that allowed undefined properties; the test now
uses an explicit string-record array. Component lint then found synchronous
state changes in effects and dependency warnings. Downloads now begin from a
user action, retained-evidence state is tied to exact inputs, and cleanup uses
an explicit invalidation callback. Corrected component lint passes.

The import component, review editor and source panel initially pass 32 interaction
cases. The extended component/editor control now passes 31 cases, including a
save completed after panel unmount. The separate editor/approval suite passes
31 cases. These overlapping totals are not added together.

The initial harmless component mutation exposes an intermittent restoration
failure: the child reports no pending import before its stored selection loads.
The panel now keeps its parent blocked until restoration finishes. A direct
callback-sequence test detects removal of this guard; relying only on a later
visible button had allowed that fault to survive once. The corrected whole-suite
harmless control passes, 13 other targeted UI faults are detected, and the final
restoration fault fails its intended assertion. Original failures and the
survivor remain in [component mutation evidence](component-mutations.json).
The checked boundaries include retained selections, private-preview clearing,
required reasons, parent hashes, exact preserved edits, unmounted callbacks,
original text, focus, artifact bytes and competing correction/approval controls.
Browser layout, native permission and actual saved downloads remain separate.

Standalone TypeScript passes with the 6GiB heap. The first full QA run passes
lint and the configured dead-code gate, then records 17,537 application passes,
1,469 skips and two failures. The existing plain-language check catches two
new uses of "recorded"; these now say "reported" without changing uncertainty
caveats. The route audit check catches the missing proposal-read logger. The
route now logs bounded outcomes without private proposal text. Both unchanged
guards and focused route/component regression pass 29 cases. That failed QA run
does not establish connector, audit or build results.

A follow-up recovery probe reproduces a loading state left active after a
storage refresh supersedes a preview. Restoration now clears that loading state.
Late access-denied replies also cannot notify a panel that has unmounted or whose
preview request was aborted. The harmless follow-up control passes; five targeted faults fail for the intended
reasons. Source files are restored. See [follow-up mutations](followup-mutations.json).

## Requirements at the initial UI checkpoint

The following list records the initial checkpoint. Later sections document completed
checks and remaining limits.

Finish component behavior and fault checks, the full QA gate, and identified
T3 browser journeys from real navigation at desktop and 390px. Inspect keyboard
use, stale parent/retry behavior, quota recovery, original-evidence downloads
and console output. No real-browser acceptance is claimed yet. The new native test and migration are registered in the shared command and
changelog; the native command now includes 89 files.
Retain the larger source/history scaling and complete generation workflow gaps.
No field or model-quality outcome has been measured by these synthetic checks.

## Crash recovery

After Nathaniel reported a computer crash, the worktree changes, native worker
output and two browser-preserved import copies remain present. The owned
Supabase containers are healthy. Port3477 had no listener; the development
server was restarted from this worktree and which-openplan.sh again confirms
its live checkout identity. T3 reopened the dedicated synthetic origin with its
session and local storage intact. The preserved copies contain both the earlier
reason and the latest quota-failure reason, with the same parent and original
proposal hashes. No import completion is inferred from this recovery.

## Native producer and browser findings

The actual local worker producer initially refused its immutable segment plan
before provider dispatch. Identical source identifiers had different serialized
field order in synthesis-generation-records.ts. Explicit source-field ordering
now preserves the existing worker recipe regardless of caller object order.
The original failed plan remains unchanged. The regression first fails, then
75 related tests pass. A harmless control survives and restoring the spread
operator fails the canonical-byte assertion in [source-order mutations](source-order-mutations.json).
A fresh native producer completes segment, two context and thematic runs through
35 local synthetic-provider calls. No paid provider is used.

The browser fixture comes from signup, workspace/campaign navigation, the actual
intake route, source capture and staff-review UI. The worker consumes that saved
source. It contains two comments, including a long multilingual contribution,
and no survey answers. The synthetic proposal assigns neither comment to a
group. This evidence does not establish cited-group presentation, large source
scaling, semantic quality or practitioner acceptance.

Desktop inspection shows original proposal wording and uncertainty. At390px,
the long original contribution includes its final sentence and retained context
uncertainty. Selecting a contribution moves keyboard focus to its evidence.
The import requires a reason. A targeted browser Storage.setItem quota fault
retains the latest reason in memory through source-inspector refresh. After
removing the fault, the real preserve control archives both older stored text
and newer failed text. Those archives survive the reported computer crash.

After recovery, the UI restores the preserved selection and imports revision2
with request d7022f14-a6a3-4016-bdb8-2ba1570fdf50. A browser transport probe drops
the first successful response after the real server commits. Retry returns200
with replayed=true and the identical revision hash, following the initial201.
The exact requests and receipts remain in [browser recovery evidence](browser-import-recovery.json).
Revision2 remains unapproved; approval event e14a0958 remains attached to revision1.
Restoring the archived revision1 selection after import disables replacement and
new approval, preserves its reason and explains the stale parent at390px.

Concurrent original-history reads returned one native busy error from
lock_synthesis_generation_request_scope. Refresh succeeds without changing
permission or lock rules. The approval component previously retained the read
failure message after successful refresh. It now separates history errors from
save errors, clears only the recovered history error and keeps an unconfirmed
save's retry state. The new test first fails on the stale warning. Twelve panel
tests pass after correction. A harmless control survives; retaining the read
warning and incorrectly clearing the save error each fail their intended check.
See [approval refresh mutations](approval-refresh-mutations.json). The first
attempt ran from the repository root without package aliases and found no tests;
that is not a valid mutation result. The corrected test runs use openplan/.
A browser-injected503 followed by the real history response confirms recovery
without a stale warning. These checks do not prove that concurrent native reads
will never return busy; the observed retry remains required.

Identified browser screenshots are retained outside git:

- Desktop original proposal: browser-screenshot-thematic-20261002-localhost-mur8dtaw-215e6734.png
- 390px complete original beginning: browser-screenshot-thematic-20261002-localhost-mur8gchl-6a950d5c.png
- 390px original final sentence and context: browser-screenshot-thematic-20261002-localhost-mur8gl2v-a8c48982.png
- Recovered approval display: browser-screenshot-thematic-20261002-localhost-murgr8t8-0badd883.png
- 390px stale import: browser-screenshot-thematic-20261002-localhost-murgsffx-213102ac.png

All paths are under Nathaniel's .t3/userdata/browser-artifacts directory. T3
snapshots truncate earlier console entries; empty returned console arrays do not
prove a clean full journey. The temporary in-page warning/error observer before
the crash recorded no entries during its narrower observation period.
Actual saved browser downloads are still unverified. A focus refresh also closes
an inspection that has not yet become a retained import selection; this remains
a usability correction. Full QA restarts after the crash and approval fix, with
the owned dev server stopped to prevent .next contention. Its outcome is pending.

## Subsequent focus correction

The post-crash QA run exits0, including 17,544 application passes and 1,469 skips,
387 connector passes and four skips, lint, configured deadcode, dependency audit
zero, webpack and TypeScript. Exact source hashes and the completed log hash are
retained in [QA before focus correction](qa-before-focus-correction.json).
Installed discovery independently passes16 cases in31.46seconds on the owned
stack; [its record](native-after-crash.json) names the fault/control boundary.

Two subsequent regressions reproduce loss of an unselected proposal inspection.
Account/source/review-specific memory now retains only its request ID and whether
the import panel was explicitly open. Source refresh still clears private content;
remount performs a fresh authorized preview read. A deliberate denial does not
restore old proposal wording. Explicit closure remains closed on the next focus.
The focused source/editor/import/recovery suite passes51 cases. These changes
postdate the complete QA result above; fault checks and browser reinspection are
still required before declaring this correction verified.

The initial focus mutation run lets an explicit-close fault survive because the
assertion precedes asynchronous refresh completion. Its [initial result](focus-mutations-initial.json)
remains. Waiting for the real refresh before asserting detects that fault. The
corrected [focus mutation run](focus-mutations.json) retains a surviving harmless
control and five detected faults. Restored controls pass51 cases and strict lint
passes for all six changed application/test files. These component checks cannot
establish real browser permission, native lock behavior or downloaded files.

A reidentified390px dev browser restores the unselected original proposal through
a new source/review/proposal read. A scoped console observer records no warning
or error during that interaction. However, duplicate development reads produce
native busy503 responses. After explicit closure, the enclosing review's read
fails, so that browser step cannot yet establish closure after a successful
refresh. See [observed requests](focus-browser-observation.json). The dev server
is stopped and a fresh production build is running to test the actual serving
path before attributing those duplicate reads solely to development mode.
The complete V1 contract and the remaining workflow/scale/semantic requirements
remain unchanged. No release or new main integration is declared.

The subsequent production build completes successfully. Its first server reports
an unknown commit and is stopped before acceptance. A committed source checkpoint
and matching runtime identity will precede production-browser verification.
