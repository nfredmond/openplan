# Connect each plan kind to its reviewed rules

October 7, 2026. This checkpoint connects the prepared selector to current
land-use workflows. Explicit reconciliation of older working drafts and rendered
acceptance remain unfinished. It does not complete M1 or declare a release.

Creation, plan-context assessment, draft reads, content validation, applicability,
process records, freeze preparation and adoption now select rules by descriptor
family and plan kind. The server page supplies a separate hash for each pair.
Changing a kind changes its hash and clears the creator's review confirmation.
An older saved creation draft remains available until staff explicitly reviews
current rules. Exact creation, context and freeze retries still discover their
original receipts before consulting today's rules.

New keyed content must be a section in the selected checklist. Applicability
updates retain previously selected keys but cannot omit newly required keys.
Invalid applicability is rejected before a title or authority update. This does
not make the existing two-write identity/applicability operation atomic.

Process records use the selected version's rules. Frozen versions require a
valid state, snapshot hash and bound identity/context. Retained process wording
remains available after current plan or registry changes. The version query
projects the fields used by those checks and scopes the read to the plan.

Frozen public packets keep their original rules. Only an explicitly unretained
legacy reference uses the current selected kind. An unavailable reference leaves
the frozen content readable with an unavailable descriptor, without substituting
another kind's rules.

Adoption compares the selected kind while retaining the complete original
descriptor in its manifest. A change to another kind's label does not invalidate
unchanged selected rules. A historical specific plan reviewed under the old
general-plan checklist is refused for reassessment. An unretained legacy version
must contain nonblank section text for the current kind's required keys. This
checks content presence, not statutory sufficiency, and rewrites no snapshot.

## Verification

The [recovered baseline](plan-kind-connections/recovered-baseline.log) passes 289
tests across eight changed suites. The [full land-use regression](plan-kind-connections/regression.log)
passes 552 tests across 25 suites. Five native suites remain skipped. TypeScript,
changed-file ESLint and the direction check pass. Direction age/scope reminders
remain unchanged. TypeScript initially caught an unknown-valued fixture access;
an explicitly typed local node array fixes it without changing the test cases.

The [control record](plan-kind-connections/controls/report.json) contains a
passing baseline, a harmless comment change and 39 detected behavior faults.
They cover family/kind selection, replay order, projections and scope,
applicability, keyed sections, frozen process custody, legacy references,
adoption checks and creator/page hash and review behavior. Source hashes are
verified after restoration. The [harness](plan-kind-connections/controls/check.py)
runs sequentially in an exclusively owned checkout and restores files in `finally`.

The [attempt history](plan-kind-connections/controls/attempts.json) preserves
stopped runs. The runner initially failed to recognize custom conflict and DOM
assertion formats even though the mutated tests failed. The older-draft test now
asserts that transport is never called before checking its warning. The page
test asserts that a usable draft exists before inspecting its hash. Neither
change weakens the expected behavior.

Earlier test attempts also remain available. The
[root-directory invocation](plan-kind-connections/initial-wrong-cwd.log) missed
the app's Vitest configuration. The [first app run](plan-kind-connections/initial-fixtures.log)
exposed a missing plan-kind field in the freeze mock and an old family expectation.
New process tests initially expected 201 although the existing upsert returns
200. A legacy test initially expected a failed packet for an unavailable kind;
the reader correctly preserves frozen content with an unavailable descriptor.
The [process](plan-kind-connections/initial-process-status.log) and
[legacy](plan-kind-connections/initial-legacy-expectation.log) logs preserve these corrections.

These are projected database mocks, real routes/readers and mounted components.
They do not establish live permissions, rollback, simultaneous transactions,
desktop or 390px rendering, console cleanliness, downloaded artifacts, legal
sufficiency or practitioner outcomes. No migration is added. The prior frozen
history build is not evidence for these connections.

The [draft-reconciliation design](DRAFT_RULE_RECONCILIATION_DESIGN.md) defines the
next operation within M1. It must explicitly add missing current sections while
preserving earlier text, maps, evidence and frozen editions. Native and
identified-build browser evidence remain separate requirements. The roadmap
remains the only active queue.
