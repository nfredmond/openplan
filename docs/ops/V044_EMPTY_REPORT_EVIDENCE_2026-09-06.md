# Empty report evidence correction

## Finding and scope

The full twelve-journey run `2026-09-06T08-03-55-299Z` on clean, pushed
`648504cf18aa9fc2feb91060b4485e17fef1b709` found an empty report labeled
evidence-backed in Projects. The Reports catalog and exact PDF correctly said
the evidence chain was empty. The same presence check affected project detail,
Reports posture filters and assistant project grounding.

The faulty checks treated a metadata object as evidence. The correction uses
the existing parsed summary's `hasEvidence === true`. The shared parser also
retains model-evidence counts and their recorded claim label, so a report with
only model evidence does not disappear under the stricter check. The existing
definition of supported evidence categories is unchanged. No scientific claim,
default, acceptance threshold, frozen artifact, holdout or write path changes.

This work is isolated from the ongoing full run. Its partial outcomes remain
failures. No release tag or complete first-week acceptance is claimed here.

## Reproduction

The original browser check signed in from the front door, opened Projects,
then each project and Reports at desktop1440 and mobile390. The UI-created
empty report is `1b185fb0-b1c1-4432-9293-8f85cc62c819`; the sourced Safety report
is `d07ac0da-c571-4ead-9837-490b3b11984a`. Both belonged to the same fresh QA
workspace. No rows were hand-seeded and the check made no application writes.

The empty report had an Evidence-backed1 badge and detail count1. It appeared
under Evidence-backed and disappeared under No evidence attached. The genuinely
sourced report appeared as evidence-backed and must continue to do so. The
browser check requiring corrected behavior rejected the original empty badge
with1instead0. Console errors were zero.

Local evidence is under
`~/.local/state/openplan/release-checks/v044-2026-09-05/`:

- `empty-report-original-scoped-v2-browser/proof.json`,22views;
- `empty-report-original-negative-browser/proof.json`, expected rejection;
- `empty-report-original-browser/` and `empty-report-original-filters-browser/`,
  earlier successful checks with broader framing;
- `empty-report-original-scoped-browser/`, a retained failed helper attempt.

The failed helper used a query-parameter selector that matched both posture
and freshness links after navigation. Its replacement selects the visible
posture label. That failure was not an application defect. Main inspected the
representative empty badge/detail, selected filter, report heading and explicit
empty-chain warning screenshots. Not every original screenshot was reviewed.

## Regression and mutation evidence

Twelve cases cover absent metadata, context-only metadata, empty and explicit
zero summaries, and one positive count in each of eight existing categories.
Tests render the actual Projects index/detail and Reports pages, exercise both
Reports filters and load actual assistant project context through a
projection-aware database mock. Both assistant metadata projections are checked.
Model-only evidence retains its original Prototype Only label.

The original source failed11tests for the expected false-evidence behavior.
The corrected focused set passed175tests. A harmless source-comment mutation
survived all175. Eight targeted mutations each failed for their stated reason:

| Mutation | Observed rejection |
|---|---|
| Restore object-presence count in Projects | Empty report gains a false badge |
| Restore object-presence count in project detail | Empty count becomes2instead0 |
| Restore object-presence Reports filter | Empty reports enter the wrong filter |
| Restore context-presence assistant count | Empty/context-only report becomes evidence |
| Drop parsed model-evidence count | Recorded count1 is lost |
| Drop parsed model claim label | Original Prototype Only label is lost |
| Remove report metadata projection | Required metadata_json read is absent |
| Remove artifact metadata projection | Required metadata_json read is absent |

Source was restored with scoped edits after each mutation. Related tests passed
244checks across13files; focused ESLint and TypeScript passed. A broader source
archive run passed13082tests, skipped112 and failed11. Ten failures required Git
history or index absent from the archive. One wording guard caught the extra
word recorded in the new hint. The hint was shortened without relaxing the
guard. The final focused set, including that wording guard, passed179tests and
TypeScript passed again. All failed and successful logs are retained in
`empty-report-correction-6ZqY7F/` beside the local evidence above.

These checks do not establish scientific validity, upstream source accuracy,
tenant isolation or browser layout. Full Git-checkout QA, corrected-build browser
proof and exact-commit remote CI are pending at this implementation checkpoint.

## Release boundary

### Verification follow-up

The first full Git-worktree gate passed lint, dead-code checks and13092app
tests, skipped112 and failed one health-route test. The QA service supplied
OPENPLAN_COMMIT_SHA, but that test's unknown-identity case did not clear inherited
identity values. The application correctly returned the supplied commit. This
was a test-fixture defect, not a wrong application identity or report regression.

The health suite now explicitly clears both supported identity variables before
each case and supplies the value that case needs. With both operator identity
variables set, all six tests pass. A comment-only mutation survives; removing
the Vercel reset exposes the inherited111111111111identity and removing the
self-hosted reset exposesaba2cf82e6e0, each failing the unknown-identity assertion
for the expected reason. Restored tests pass. No health-route production code
or expected result was changed. Logs health-explicit-env-*.log retain the proof.

The implementation and this follow-up live in an isolated Git worktree while
the unchanged full journey run owns main. Draft PR100 is for CI, not release
authorization. Corrected-build full QA and browser verification are still pending.

The current full run completed four passing journeys and two partial outcomes
through job05; later journeys are still running. Safety lacks an established
construction treatment/cost/benefit case. Model05 retains the manager-supplied
synthetic exercise assumption and does not establish a forecast or value for
money. Its four distinct output files match their stored hashes and share exact
network custody; both methods remain Prototype Only. Existing display findings
023/044,024and048 are queued, not repaired by this change.

The distributed-loading candidate remains failed, retired and scientifically
inconclusive. This correction does not restart model selection or reopen any
holdout. Release remains withheld.

### Corrected-build verification on 15a15e30

The complete Git-worktree qa:gate exited0 with13093app tests passing,112skipped,
135live isolation tests passing, no production dependency vulnerabilities, and
a successful build. This run retained the explicit operator commit identity.
The earlier failed health-test run remains recorded above.

A separately owned server on3201 reported15a15e3023a6 and its process directory
matched the correction worktree. Supplying the old main SHA to the browser
check failed before login with Unexpected running build. The unchanged main
server on3200 continued serving the full twelve-journey run.

The corrected front-door journey visited Projects, project details and both
Reports posture filters at1440and390pixels. Empty reports have no project-index
evidence badge, detail count0, and appear only under No evidence attached. The
sourced Safety report retains count1 and appears only under Evidence-backed.
All20screenshots were inspected. There were zero unexpected console errors and
zero application writes. Local proof is
empty-report-corrected-15a15e30-browser/proof.json in the evidence root above.

This is not a responsive-layout pass. The empty report card has534pixels of
content inside the narrow mobile module, clipping its title and evidence badge.
The outer document still measures390pixels, exposing a blind category in that
width assertion. The empty-chain warning remains visible; the layout defect is
queued separately. Assistant counts are covered by actual-loader regression
tests, not a claim that an LLM conversation was visually verified.

At this checkpoint, exact-commit remote RLS34025511267, Upgrade34025547283 and
Nightly34025548482 succeeded; CI34025511248 is still running its full gate.
Eight full-run journeys pass, Safety04 and Model05 are PARTLY, and the final two
journeys are unfinished. Neither this focused correction nor remote CI changes
those outcomes or authorizes a release.

The completed run subsequently finished with nine passes and three partial
outcomes. Exact a80be8db remote checks all succeeded. See the superseding
[final outcome record](V044_FINAL_FIRST_WEEK_OUTCOMES_2026-09-06.md) for the
additional model-evidence clarity gap, 123-file audit and unchanged release
boundary. The technical correction is verified; complete release acceptance
is not.
