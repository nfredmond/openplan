# Independent OpenPlan code review

Review date: October 1, 2026 Pacific. Review baseline and latest reviewed commit: `891a0d89a848133d44b9e4f314a76a922cd71ace`. Released v0.66.0: `bc47c0ce580ee24f1a3808978535f52218e796d4`. The difference between these commits is documentation only; the reviewed application, worker and scientific defects also affect the release.

## Conclusions

The review identifies ten defects with executed evidence: four High and six Medium. It also records one Medium source-supported Storage permission concern. Evidence boundaries differ: some findings reach the native database or actual subprocesses; others compose real code with synthetic transport. In particular, SEC-01 proves an authorization-target mismatch in the Storage helper and SDK, not a completed foreign-object download. No Critical finding or deployed compromise is claimed.

The most consequential problems are incomplete approval-to-write binding, unsafe tokenless operation of the optional ActivitySim HTTP wrapper, a Storage path normalization mismatch, and county cancellation that leaves child processes running. Financial parent integrity, connector recovery and scientific direction handling also need correction. Passing CI does not detect these combinations of otherwise tested components.

No application fixes were implemented. No findings are marked resolved. The original baseline and latest reviewed committed state are identical. Remote main remains at the baseline when checked at 03:35:38 UTC on October 2. Active uncommitted development changed during review and was not incorporated or judged as released behavior.

## Prioritized findings

| Order | ID and severity | Demonstrated behavior | Evidence limit |
|---|---|---|---|
| 1 | SCI-01, High | Tokenless optional ActivitySim HTTP route executes a caller-selected harmless command and deletes an unrelated synthetic directory's contents. | Real in-process HTTP route/runtime; no external listener or deployed exposure tested. Requires the documented tokenless wrapper to be reachable. Polling worker is separate. |
| 2 | SEC-01, High | Encoded parent segments pass the run-path guard; the installed SDK prepares a different bucket's signing target. | Synthetic fetch, no network request or foreign bytes retrieved. A complete disclosure requires a known existing target and native confirmation. |
| 3 | PROV-01, High | A valid approval for project and notes also accepts unsigned funding amounts and sends them to persistence. | Real handler/verifier with mocked access and database. Requires an authenticated writer with a live approval. Related financial routes share the source-level omission. |
| 4 | SCI-02, High | Cancelling a county job kills its bootstrap but leaves a child running and writing; cancellation waits beyond the configured grace. | Actual short process tree. An indefinite queue stall follows from unbounded pipe waiting but was not left running. |
| 5 | PROV-02, Medium | A whitespace-only retained connector result repeatedly gets HTTP 400 and blocks later jobs, even after application cancellation. | Real connector/route with synthetic provider and database. No repeat provider dispatch or billing was observed. |
| 6 | FIN-02, Medium | Authenticated allocation RPC accepts fund B with fund A's period in the same workspace. | Native full schema. Cross-workspace control is denied. Ordinary route scopes the parent correctly, but direct RPC does not. |
| 7 | UI-01, Medium | Dashboard queries nonexistent `project_submittals.workspace_id`, so submittals are always unreadable. | Native schema error and identified-build desktop/390px browser observation. Other direct submittal pages are not shown broken. |
| 8 | FIN-01, Medium | Recipient rounding can produce a negative final share, including for a zero-weight recipient. | Actual allocator; native database refuses the negative write and preserves previous allocation. No negative persisted amount is claimed. |
| 9 | SCI-03, Medium | A one-direction count is compared with total bidirectional flow and labeled direction-compatible. | Actual matcher/evaluator; 100 eastbound versus AB 100 plus BA 900 becomes 900% error. Result remains inconclusive. No affected metric found in seven sampled frozen audits. |
| 10 | FIN-03, Medium | OWP reporting stops early when the configured response cap is below its requested 200-row page. | Actual reader with simulated cap 50; default repository cap is 1,000. Conditional installation/configuration defect. |
| Investigate | SEC-02, Medium concern | Two artifact Storage INSERT policies check membership but omit the viewer-role write restriction. | Current policy source inspected. Native upload behavior remains unperformed. |

[FINDINGS.md](FINDINGS.md) gives every finding's source locations, trigger, expected and observed behavior, consequences, reproduction, test blind spot, correction and regression boundary. It preserves independent reviewers' evidence qualifications. [COVERAGE.md](COVERAGE.md) records all planned areas and unestablished outcomes.

## Recommended implementation order and dependencies

1. Address SCI-01 immediately wherever the optional HTTP worker is used: require authentication before setup and confine executable/output configuration. Correct SEC-01 in the shared guard and add effective-target assertions before privileged signing or downloads. Confirm native denial with isolated synthetic objects before calling that entire boundary fixed.
2. Correct PROV-01 across every registered action and manual route sharing the same endpoint. Reject unsigned fields or reconstruct persistence from the narrow approved action. Do not expand financial authority merely to make the hash include more fields. Preserve signed-payload, manual-edit and wrong-scope controls.
3. Repair cancellation and connector recovery, SCI-02 and PROV-02. Terminate the owned process tree with bounded waits. Give retained invalid results a durable disposition that reconciles cancellation without automatically making a replacement provider call. Container termination needs separate verification.
4. Correct FIN-02 with both explicit parent validation and an additive composite database relationship. Inspect and reconcile any existing mismatches before adding the constraint; do not silently delete financial records. Then correct FIN-01 residual allocation while retaining exact totals and nonnegative shares.
5. Repair UI-01's project relationship query and test it on the native schema. Correct FIN-03's complete-read loop with reduced-cap and empty-page controls. These can proceed independently of the worker fixes.
6. Correct SCI-03 through a versioned successor instrument or an explicit refusal of unresolved directional matches. Preserve frozen studies and their hashes. Directional geometry and AB/BA selection need separate cases; do not rerun consumed acceptance evidence to improve results.
7. Resolve SEC-02 with an isolated viewer/member/foreign-workspace Storage matrix. Continue the documented large-export completeness investigation before grading the unpaged archive reads as a new defect.

## What the review establishes

The investigation spans the Next.js application, SQL migrations and RLS, root workers, scientific scripts, provider execution, operations, financial workflows, planning integrations and tests. Three bounded independent reviewers challenged findings, and the coordinating reviewer checked consequential source paths and reproduced selected provider observations. Independent source reports remain in this directory rather than being replaced by this synthesis.

An owned Supabase stack applied all 358 migrations. Native probes establish the allocation-parent failure, negative-write rollback preservation and dashboard schema mismatch. Actual process and HTTP-handler exercises establish worker behavior. T3 browser navigation reaches registration, sign-in, dashboard and Projects on the identified review checkout at desktop and 390 CSS pixels, with console review and limited keyboard/focus checks.

The artifact exercise generates real synthetic ZIP and GeoPackage bytes. Independent CRC, checksum, SQLite/WKB and GDAL inspection confirms the tested content, geometry and separate engine/unavailable-state representation. A harmless archive change survives and altered content fails the expected checksum check. This does not establish completeness of a large export or professional acceptance of its contents.

The direction check succeeds with its existing reminders preserved. Focused existing suites pass, including native finance, provider, connector, worker and artifact tests. Reproductions still expose the defects. Review checks include harmless controls and targeted faults; their blind categories are recorded rather than inferred away from a green result. Remote CI, RLS, nightly QA, upgrade and restore workflow runs also report success for the baseline. This review did not independently repeat the entire QA gate, populated upgrade or restore drill.

## What remains unestablished

The review is risk-based, not an exhaustive inspection of every route or migration. It does not establish all cross-campaign/revoked-user cases, native foreign Storage access, every concurrent write/recovery interleaving, real installed CLI account/provider behavior, full physical power-loss recovery, or a successful independent backup restoration. It does not establish all fifty-state, DC, territory, tribal and overlapping-authority journeys, current legal applicability or national modeling accuracy.

Browser evidence covers a bounded signed-in path, not all core planning journeys, full keyboard or screen-reader accessibility, public-participant acceptance, or practicing-planner usefulness. No PDF/XLSX visual or native Office acceptance occurred. GDAL parsing is not interactive GIS acceptance. Full OWP/UPWP, contracts, RTP, capital, tax/grant and agency procurement outcomes remain subject to the contract and disclosed roadmap work. They are not newly called bugs because they remain unfinished.

Known non-atomic approval/effect/receipt behavior, ODM recovery limitations, existing page caps, plan authority ambiguity and unfinished M9b generation are retained as known work. Architectural concerns include privileged mutable artifact references, database relationships that rely only on route checks, and journals whose replay depends on a permissive completion endpoint. These do not add to the demonstrated finding count.

## Prototype, release and ownership disposition

[PROTOTYPE_REVIEW.md](PROTOTYPE_REVIEW.md) reviews only the preserved four-file synthesis-history snapshot and records SHA-256 hashes. It identifies no new demonstrated defect. The acknowledged preliminary 45 tests and unfinished outer-reader, mutation and native verification are not re-reported as released defects. The active development files now differ from that snapshot and remain outside this report.

The review owns branch `review/independent-20261001-01` and `/home/nathaniel/.local/state/openplan/independent-review-20261001-01`. Only the review directory is an untracked Git change there. The development agent owns implementation and release work. No canonical or active development files, scientific holdouts, release refs, GitHub issues/PRs or demo data were changed by this review. Another untracked UI/UX review directory appeared in the canonical checkout during this session and was left untouched.

[REVIEW_STATUS.md](REVIEW_STATUS.md) records isolation and cleanup. [evidence/closing-baseline.json](evidence/closing-baseline.json) records exact closing checkout states, release refs and CI identities. No intervening committed implementation fix was available to verify, and none is marked resolved. These findings support a correction plan, not a claim of v1 readiness or a defect-free repository.
