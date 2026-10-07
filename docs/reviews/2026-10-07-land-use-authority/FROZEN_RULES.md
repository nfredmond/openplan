# Preserve the checklist used by a frozen land-use plan

This M1 preparation follows the public-identity correction in PR #123. New
frozen versions retain the complete installed descriptor, including terminology,
requirements, process steps, source URLs and source-review dates. The existing
content hash covers that copy. Changing the installed registry later cannot
silently change the checklist presented with the reviewed version.

Public readers validate the saved descriptor ID and plan kind. Missing metadata
on historical versions remains a distinct legacy condition. A present malformed
or mismatched descriptor returns `incomplete`; it never falls back to the current
registry. Both public pages explain whether the checklist was retained. A saved
checklist does not establish that the law remains current.

Adoption verifies the frozen plan, version, version number and recomputed content
hash. Its evidence manifest retains the descriptor, its hash and its custody
status. Existing permission, review-closure and required process-evidence checks
remain. A changed retained descriptor requires source reconciliation before
adoption. The reconciliation workflow remains open M1 work.

Historical versions without a saved descriptor can still record adoption using
the installed reference identified by their frozen identity. Their manifest says
`current_reference_not_retained_at_review`. This preserves the agency's history
without pretending the current reference was retained during review. It does
not backfill or change historical frozen bytes. An earlier local implementation
refused these legacy cases; review found that this could imply a new agency
review solely because old software lacked metadata, so that behavior was corrected
before committing.

## Checks and limits

All 109 tests in 12 land-use suites pass. The new tests exercise the actual
snapshot builder and adoption route, with database doubles that honor selected
columns and assert ownership filters. Public reader cases cover retained,
retired-registry, absent and malformed descriptors. Rendered-component checks
cover both public disclosures. Full TypeScript and changed-file ESLint pass.

The [controls](frozen-rules/controls/report.json) record one harmless comment
control and 21 deliberate faults. The harmless run passes; every fault fails
its named assertion. All six mutated source files are restored byte for byte.
The initial runner stopped at a correctly failing missing-disclosure assertion
because it expected only `AssertionError`. The runner now also accepts the exact
Testing Library missing-element error for those two disclosure cases. The
assertions and product behavior were not weakened.

The [native probe](frozen-rules/native.json) creates two new synthetic versions
on the isolated restore target. One retains its descriptor through the actual
snapshot builder. The other deliberately represents legacy absence before it is
frozen. A registry change confined to probe memory leaves the retained version
unchanged. The legacy case exposes the current reference and remains explicitly
not retained. The prior reader reproduces the mutable-reference defect. Both
new releases are withdrawn afterward, return `not_found`, and remain retained
for inspection. No older fixture is altered.

These checks do not establish a native adoption transition, a complete readiness
and freeze journey, production HTTP behavior, desktop or 390px visual evidence,
keyboard or console acceptance, legal completeness or practitioner acceptance.
They do not correct workspace-home-based descriptor selection or shared
California general/specific-plan requirements. Those M1 boundaries and the full
v1 contract remain open. No release or tag is created by this checkpoint.
