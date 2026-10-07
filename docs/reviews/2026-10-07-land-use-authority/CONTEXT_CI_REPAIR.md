# Context editor integration checks

The GitHub shuffled run for `c3d26729` found five failures after the focused
land-use checks passed. Its [failure extract](context-editor/ci-repair/github-c3d-failures.log)
is preserved. None establishes an order-dependent defect: each identified an
outdated assertion or missing integration maintenance that reproduces in the
affected checks. The whole-suite runner's generic order-dependence message is
not a diagnosis.

The changelog omitted the five context/revision/freeze migrations. Unreleased
now names each migration and its operating effect, without declaring a release.
The schema inventory omitted the two private command journals. A fresh
[isolated catalog read](context-editor/ci-repair/catalog.json) confirms 282
application tables, all with RLS, 14 application views and 758 policies. Both
new journals have zero client policies. Inventory counts now match those facts.

Ten journal columns were invisible to the TypeScript identifier scan. Their
entries now name their actual SQL use. Two generated command digests are
explicitly classified as write-only audit information: runtime replay compares
exact command text and does not return or display those digests. This records
that boundary rather than inventing an application reader. The other columns
participate in native replay, receipt reconstruction or digest constraints.

The jurisdiction panel test pinned an old source hash even though the payload
now supplies the current source hash. It now checks every source in the selected
planning job, requiring the displayed exact hash and matching source path. The
test still exercises job switching and the unsupported Oregon plan disclosure.
This verifies payload-to-view fidelity, not source-file integrity or jurisdiction
coverage. Existing registry evidence checks keep those separate responsibilities.

The new copy exceeded the existing language counts. It now uses "plan area,"
"assessment reasons" and "review recovery copies." The copy baseline is unchanged.
Responsible bodies remain distinct from the area covered by the plan and office
location. All frozen, unresolved and review limits remain. The first wording
repair left one counted word; a second exposed an office-location sentence that
the scanner had previously skipped because of an HTML entity. Both failed
[attempts](context-editor/ci-repair/initial-repair.log) remain, including the
[follow-up](context-editor/ci-repair/copy-followup.log). The final text avoids
both terms without hiding or removing the explanation.

The affected eight suites pass 101 tests, including the GitHub failing seed
`443012` in the [targeted shuffled run](context-editor/ci-repair/shuffled.log).
TypeScript and changed-file ESLint pass. The
[control record](context-editor/ci-repair/controls.json) includes a passing baseline
and harmless comment control. Ten deliberate faults fail their named tests:
old relation count, missing column accounting, stale accounting exemption,
wrong source hash, wrong source path, uncleared replacement boundary, ignored
boundary label, treating unsaved typing as saved, omitted migration note and
reintroduced jargon. Every temporary source change is restored byte-for-byte.
The [control source](context-editor/ci-repair/controls.py) and
[unit result](context-editor/ci-repair/unit.json) retain the details.

The schema and copy scans cannot establish running database permissions, visual
clarity or practitioner usefulness. Mounted tests use synthetic data and mocked
transport. This repair changes copy and integration checks, with no schema or
workflow behavior change. The earlier production/browser evidence continues to
identify `c3d26729`; it does not establish rendered acceptance of the revised copy.
Whole-suite GitHub checks, the next production build and desktop/390px visual
acceptance remain separate until their actual results are recorded.
