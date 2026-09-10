# v0.48.0 release evidence

Prepared from main `3a752db6c7c249c45fa245530f4b52fda6a54251`. This release contains the merged M2d.4 saved reconciliation, period closure, refund matching and multiple successor allocation increments. It requires no human review, PM approval or finance acceptance. Those were never necessary to complete the version/tag steps, and Nathaniel explicitly confirmed their exclusion on September 9.

## Accepted application

The [multiple-allocation evidence](../2026-09-09-m2d4-multi-carryover/VERIFICATION.md) records desktop/390px navigation, keyboard operation, original and corrected downloads, immutable hashes, interrupted retries, private access and preservation of physical costs. The [settlement](../2026-09-09-m2d4-settlement/VERIFICATION.md), [period-closure](../2026-09-09-m2d4-period-closure/VERIFICATION.md) and [refund-matching](../2026-09-09-m2d4-refund-matching/VERIFICATION.md) records retain their own guard, concurrency and recovery evidence. Their dated unreleased statements describe earlier checkpoints; v0.48.0 is the release disposition of that work.

At `3a752db6`, [full QA and shuffled/worker/modeling/ops CI](https://github.com/nfredmond/openplan/actions/runs/34435065379), [321-test RLS isolation](https://github.com/nfredmond/openplan/actions/runs/34435065409) and [populated upgrade from v0.47.0](https://github.com/nfredmond/openplan/actions/runs/34435065329) all passed. Local ordinary and shuffled suites each passed 13,451 tests; 52 worker suites passed. Final release-commit CI is inspected separately before tagging.

## Upgrade

Apply all four additive migrations after v0.47.0 before starting this app:

- `20261004000001_work_program_closeout_reconciliation.sql`
- `20261005000001_work_program_period_closure.sql`
- `20261006000001_work_program_refund_matches.sql`
- `20261007000001_work_program_multi_carryover.sql`

The release ordering table retains 311 migrations through the last file. The populated upgrade preserves original reports, approvals, closure decisions, source rows and hashes. Pending legacy commands keep their exact payloads. No database reset, paid infrastructure or reminder constraint change is part of this release.

## Remaining software limits

Independent two-cycle reconstruction and exact restore evidence remain unfinished. Supporting records do not establish prescribed agency-form compatibility, verified bank transfers or external spending/adoption authority. Automatic reminder delivery remains unchanged. These limits are disclosed without turning human review into a release gate. This is an engineering development release, not a declaration that M2d.4 or the full v1 contract is complete.

## Release metadata checks

The package and lockfile, roadmap, contract, capability matrix and registry identify v0.48.0 without changing review dates or capability ratings. The first direction check caught the still-v0.47 contract field; aligning it corrected the release metadata. Direction and all 11 migration-ordering/document checks pass. A harmless comment survives the ordering check; changing the release migration count from 311 to 310 fails. The check cannot prove a populated database upgrade, which is covered separately above.

## Release-build browser acceptance

Production build `16fab60f9d93bed7fa8d5d5fbc31364995fd9ff0` identifies itself as v0.48.0 from the isolated release checkout at loopback 3267. Its webpack build passed. The named disposable database remains `supabase_db_m2d3-reimbursement-verification`; no migration or database reset was needed for the metadata-only release preparation.

The release-build browser journey passed at desktop and 390px from real navigation, including keyboard save/download, three allocations across two successors, original and corrected JSON downloads, retained previous approvals and four unchanged physical entries. Interrupted save/reload/retry created one draft, the excess successor allocation was refused, and interrupted history reads hid exports until recovery. Expected injected errors were the only console errors. Both screenshots were inspected. See `browser-results.json` for exact approval versions and original/corrected checksums.

[Desktop](split-funding-1440.png) · [390px](split-funding-390.png). Raw downloads and synthetic credentials remain outside git. Later release-evidence commits change only documentation; the accepted application is unchanged. Tag and GitHub publication follow successful CI, shuffled tests, RLS and populated upgrade on the final release commit.

## Published

[v0.48.0](https://github.com/nfredmond/openplan/releases/tag/v0.48.0) was published September 9, 2026 Pacific time, at 2026-09-10T04:53:59Z. The remote annotated tag resolves to `e39258b92f119d5b7d8326155f99188d43a7eaf3`. GitHub confirms a published, non-draft release.

Before tagging, that exact commit passed [full QA, shuffled tests and worker/modeling/ops CI](https://github.com/nfredmond/openplan/actions/runs/34437609808), [RLS isolation](https://github.com/nfredmond/openplan/actions/runs/34437609795) and [the populated upgrade from v0.47.0](https://github.com/nfredmond/openplan/actions/runs/34437609604). All jobs completed successfully. The release contains the accepted application above; the final evidence commit changes only documentation. Continuous development proceeds under the current v1 contract.
