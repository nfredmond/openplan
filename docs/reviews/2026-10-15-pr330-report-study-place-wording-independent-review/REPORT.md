# Independent round 1 review of the report study-place wording

No P1 or P2 finding. Candidate `6476c93b30db17f612d872ad4c02b201e20a8bce`
corrects the report legend's inference from searched study place to project
jurisdiction. The source diff and retained focused controls support this bounded
wording correction. This review does not establish new browser, generated
artifact, runtime, integration, or release acceptance.

## Identity and ownership

- Candidate: `6476c93b30db17f612d872ad4c02b201e20a8bce`.
- Source base: `f00465a86ee546e6b261a663f4611cde7b56cb6e`.
- Base application tree: `a13c491da3ad3ba5b237ca5fa8802b236c4ef27b`.
- Assigned review checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-32becb34`.
- Review branch: `t3/pr330-study-place-wording-review`.
- Review starting HEAD: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
- Ownership: this new review directory and the new private matching directory
  `/home/nathaniel/.local/state/openplan/2026-10-15-pr330-report-study-place-wording-independent-review`.

The checkout starts clean. I inspect exact candidate and base Git blobs without
fast-forwarding this checkout or changing application source. The worktree
inventory identifies separate implementation and review checkouts. The task
brief supplies the completed parent browser-interaction boundary. I do not
inspect other sessions or claim to observe their current processes.

I read AGENTS.md, planner-writing, prove-it, and any-place. This is an assigned
bounded review, not selection of a new product lane. I inspect the candidate's
direction-check receipt rather than run another command. No nested delegation,
network, provider, browser, database, dependency, build, full TypeScript, or test
operation forms part of this review.

## Findings and rationale

P1: none. P2: none. No implementation disagreement remains within this scope.

**The new copy removes the identified inference.** At candidate
`openplan/src/lib/reports/geography-figure.ts:367`, the resolved-place detail now
requires a separate human declaration and assessment for project jurisdiction.
It also says geography does not resolve adopting authority or legal
applicability. These statements distinguish study geometry from the human
jurisdiction record. They do not claim that a declaration proves legal power,
that an assessment finds support, or that one administrative boundary replaces
sovereign or overlapping authorities.

The adjacent source context supports that separation. At candidate
`openplan/src/lib/projects/project-jurisdiction.ts:15`, declaration scope includes
administrative, sovereign, overlap, and other. The declaration can contain
multiple entries. Its resolver records identity separately from geometry. The
report's existing jurisdiction section at `openplan/src/lib/reports/html.ts:380`
discloses declarations, assessment scope, and distinct study geometry. Those
paths remain unchanged. I inspect them for consistency, not as a whole-code or
legal audit.

**The change introduces no place-specific rule or broader recovery promise.**
The same replacement applies wherever the existing resolved-identity branch
emits an area legend. It adds no country, state, county, agency, provider,
coordinate, or jurisdiction literal. The declaration and legal-authority
sentences remain applicable when the study place is federal, tribal,
overlapping, or outside the United States. They do not assert that a particular
place or legal system has implemented support.

The old sentence already promised that the boundary and county filter could be
re-derived. The replacement retains that claim as recoverability and removes
jurisdiction from it. I find no increased promise of availability, precision,
currentness, or legal authority. This does not independently establish the
inherited recovery claim for every place. In particular,
`placeHasResolvableIdentity` at candidate
`openplan/src/lib/geographies/place-of-record.ts:79` checks source and reference;
it does not demonstrate provider availability, a unique county filter, or
worldwide coverage. The focused county fixture cannot prove those properties.
The existing county terminology and recovery boundary remain limits of this
review, not new behavior introduced by this patch.

**The application scope matches the brief.** The production file has one line
added and one removed. The test file strengthens one existing test, with nine
lines added and one removed. All other candidate changes relative to the given
source base belong to the implementer's new review packet. Replacing the new
string with the original recreates the entire base production helper byte for
byte. Geometry, drawn/uploaded caveats, identity dispatch, registry rules, and
jurisdiction/legal logic therefore remain unchanged by this patch. The
replacement contains no em dash.

**The strengthened test exercises emitted behavior.** At candidate
`openplan/src/test/packet-geography-figure.test.ts:380`, the test imports and calls
the real `buildPacketGeographyFigure`. It inspects the resulting legend detail,
label, and caveats. It requires the human declaration and assessment sentence,
the retained recovery statement, and the adopting-authority/legal-applicability
sentence. It also rejects the old inference phrase. It does not mock the helper
or search source text. Existing drawn/uploaded and extent-only tests remain
unchanged.

## Retained controls support a source-level conclusion

I read the implementer's full `REPORT.md`, `check_controls.py`, `controls.json`,
`scope.json`, all four final Vitest JSON reports and logs, direction log, and
retained initial-failure records from the exact candidate packet at
`docs/reviews/2026-10-15-pr330-report-study-place-wording/`.

The final records agree across summary counts, individual assertion statuses,
source hashes, and the named implementation test path:

- Baseline records exit 0, 20 passes, and no failures.
- The harmless leading-comment control records exit 0, 20 passes, and no
  failures. The harness can therefore record survival.
- Restoring the original production sentence records exit 1, 19 passes, and one
  failure. The failure is the strengthened resolved-place test at its first new
  declaration-and-assessment assertion. Stderr contains the exact expected new
  sentence and the received old inference. Drawn/uploaded tests still pass.
- Restoration records exit 0, 20 passes, and no failures. Both the case-level
  and outer `finally` blocks restore saved source bytes.

I independently calculate the following SHA-256 values from exact Git blobs and
from the two mutation byte sequences, without running the mutation script:

- Candidate, baseline, restored:
  `8218090f7ab3c6c39610691883021228c428c52706a80b2c506bd0251c9968aa`.
- Harmless leading comment:
  `fda1f489f26ccd8d91d15fd8f94b3f3991d77832940786d81ec8def66d2d19e8`.
- Original inference, identical to the entire base helper:
  `4cee16f36e2a3d25720a5d6e985b68a95cfca86857e812d96812b0878d1e2bd4`.

All four receipt source hashes match these calculations. The base application
tree also matches the supplied identity. The candidate test blob is
`6e765b12fe068336357e0fa4c379ddaea83b6fec`; its SHA-256 is
`2cbf64e8ed06d18bf7c4cb7deaf40603bc471f8cba69780516c6de0f4d2f38b6`.
The retained reports name that test's assigned path, title, and expected failure
location. They do not contain a runtime cryptographic pin of the tested file or
dependency tree. I do not claim stronger attestation or live observation of the
implementer's restoration.

The runner invokes the assigned configuration with the bundled loader, a single
fork worker, and a separate private cache per case. The logs record those paths
and settings. The initial config-loader failure collects no successful test
cases. The later abbreviated-message control failure retains two completed
surviving cases and the intended failing-test report. Neither initial attempt
counts as a successful campaign. The final control checks the full stderr
expectation and records all four cases. The preserved failures therefore do not
undermine the final result or disappear behind it.

The retained direction check records exit 0 with existing registry-review,
capability-review, version, and intervening-change reminders. I retain those
limits. A direction-record check does not establish runtime behavior or resolve
those reminders.

## Unproved boundaries and disposition

The focused test protects this helper's emitted copy for one resolved US county
fixture. It does not establish boundary recovery, provider coverage, every
resolved-place kind, every country, county-filter correctness, declaration
persistence, registry assessment correctness, legal applicability, adopting
authority, or live recovery. Its harmless and fault controls demonstrate the
specific regression assertion, not every possible wording regression.

Source equality establishes unchanged geometry code, not universal geometric
accuracy. The focused controls do not exercise HTML/PDF layout, line wrapping,
route integration, desktop or 390px journeys, console output, native exports,
real data, or human acceptance. No full suite, build, or TypeScript campaign is
necessary to resolve this bounded source review, and none is claimed here.

The task brief states that the preserved f0 browser interactions and frozen
build with the supplied `Z9...` prefix still contain the original sentence. I
do not inspect or amend those artifacts. They cannot supply acceptance for the
replacement wording. This review accepts the bounded source correction and its
retained focused evidence only. Integration, identified-build artifact review,
and any later acceptance remain separate work owned by the parent.

The reviewer changes no parent or candidate source, environment, journals,
dependencies, services, protected proof, or authority records. This handoff is a
local report commit only, with no push, pull-request operation, merge, tag, or
release.

The accompanying `evidence/source-and-receipt-inspection.json` records independent
blob comparisons and receipt reconciliation. The new private matching directory
holds 25 files: exact candidate packet blobs, base/candidate source and test
snapshots, the scoped diff, inspection data, and its file inventory. The private
directory uses mode 0700 and its files use mode 0600. The inspection record's
SHA-256 is `e749f1adec27c5848070df51a701564aa6f39e7af716d5549aa575113edfa154`.
