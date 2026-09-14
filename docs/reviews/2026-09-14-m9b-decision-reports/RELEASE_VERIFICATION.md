# v0.60.0 decision links and public-copy privacy

Prepared September 14, 2026. This is the release candidate record. Final main CI,
populated upgrade and publication must be recorded before tagging.

## What changes

Staff can connect a response to a saved project decision, retain the reviewed
source context and reason, correct or withdraw the link without losing originals,
and recover interrupted requests with private copies. A link does not approve a
decision or publish an explanation. Public explanations use the existing reviewed
response command and remain distinct from private decision rationale.

Explicit private/internal contribution flags override approval for public copy
selection. The public portal/feed, photographs, translation sources, votes,
replies and report snapshots respect both the contribution and its root parent.
A reviewed privacy edit retains source history and withdraws affected responses.
Previously generated public files are refused when their source is no longer
publicly available. Internal originals remain available to authorized staff;
corrected public packets are new snapshots. Earlier formats do not acquire missing
historical authorization evidence through this change.

Apply these additive migrations before restarting the app and workers:

- `20261014000021_engagement_response_decision_links.sql`
- `20261014000022_engagement_decision_request_resolution.sql`
- `20261014000023_engagement_public_copy_privacy.sql`

The resulting migration count is 342. Use migration up on the configured stack;
no reset is needed. The existing local Documents export worker prepares files
with `npm run worker:document-exports` from `openplan/`. No new provider or paid
service is required. Manual source/link/response work makes no model calls.

## Evidence

The isolated checkout is
`/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`.
The privacy application build is `dfebc1af3a683a82c8a9da02a3d9215f47af5236`,
served at port 3262. Build health and process checkout agree. Later acceptance
commits changed evidence and a native test fixture, not application behavior.
Version/release metadata changes are checked separately from those browser runs.

[Decision-link journeys](../2026-09-14-m9b-decision-traceability/decision-browser-evidence.json)
retain their earlier build identity, source/correction/withdrawal evidence and
actual private JSON downloads. [Request recovery](../2026-09-14-m9b-decision-traceability/decision-recovery-browser-results.json)
records desktop/390px interrupted and damaged-copy recovery on build 6604a87e.
These are retained earlier runs, not a claim they were rerun during privacy work.
The current privacy journeys also create a new decision through Projects, link a
new response through Engagement and verify its original private context survives.

[Public-copy journeys](public-copy-browser-results.json) cover desktop 1440px and
390px from real navigation, using keyboard activation and independent anonymous
contexts. They establish visible approved input and explanation before privacy,
then removal of that source/response while a public control stays visible.
All 18 original-public/internal/corrected-public PDF/XLSX/ZIP downloads match
retained checksums and sizes. ZIP companions are exact downloaded bytes; snapshot
bytes match retained hashes. Corrected copies contain one control contribution
and no withdrawn response instead of the original two contributions/one response.
All nine desktop PDF pages and all nine original workbook sheets were rendered
and inspected. Wide record sheets require horizontal browsing. Workbook values,
error-typed cells and complete companion records were inspected separately.

Old public downloads return 404 after privacy changes. Internal originals retain
exact bytes; anonymous internal download returns 401. The 390px export loses its
acknowledgement after server acceptance, retains the request through reload and
retries the exact payload to the same job. One deliberately injected network error
is retained separately; otherwise the operator and resident consoles are empty.
[Photograph journeys](public-photo-browser-results.json) upload through the public
form at both widths, read the approved photograph, then verify the private source
and photograph are absent and its old URL returns 404. Staff history retains the
attachment. Approval/privacy metadata edits use the authenticated API; this does
not imply that a dedicated UI privacy control exists.

[Native privacy proof](public-copy-privacy-results.json) covers explicit flags,
Unicode trim, parent relationships, history/withdrawal, public selections, grants
and actual write refusal with baseline, harmless control and 26 targeted faults.
[Reader mutations](public-copy-readers-results.json) exercise 117 application tests
and kill eleven raw-table reversions. Their mocked query boundaries are separate
from native view/grant evidence. [Concurrency](public-copy-concurrency-results.json)
uses the disconnected proof database, verifies all eleven installed function
hashes and observes actual blocker/waiter overlap. Private source commits deny
waiting votes/replies and exclude report contents; harmless edits permit them.
Translation reads are busy during the edit and unavailable after private commit.

[Full QA](public-copy-full-qa-results.json) passed on dfebc1af: 15,315 tests,
523 intentional skips, lint, configured advisory deadcode checks, connectors,
zero audited dependency vulnerabilities and webpack build.
[Shuffled tests and workers](public-copy-shuffle-workers-results.json) passed
15,315/523 and all 52 worker suites on 52b100d8.
[Complete isolated RLS](public-copy-full-rls-results.json) passed 552 tests in
60 files on the named restore-target stack. A populated-fixture false failure
was corrected by scoping positive receipt counts to that fixture; broad negative
cross-user checks remain. Its harmless and targeted fault checks passed.

[Privacy activation](public-copy-activation.json) preserves count and SHA across
14 existing source/history/report tables. Earlier decision-link/recovery activation
records cover migrations 21 and 22. Final GitHub upgrade rehearsal is still
required before tagging. Local migration evidence is not final CI evidence.

## Final candidate CI failure

The first final-main attempt, `28be41642bd39f41bea6ddaac7a7325419cbd8a0`,
passed shuffled tests, all 552 live RLS tests and the populated upgrade from
v0.59.0. Its QA job passed the unit suite, connector checks and dependency audit,
then exhausted the roughly 4 GiB Node heap during TypeScript checking. The
[failed run](https://github.com/nfredmond/openplan/actions/runs/34853274851)
is retained; this commit was not tagged.

The correction gives production builds a 6 GiB heap through inherited
`NODE_OPTIONS`, preserving other existing Node options and all type checking.
A direct `node --max-old-space-size` parent argument did not reach the locally
observed TypeScript CLI child and was replaced before committing. Standalone
cold TypeScript checks passed locally at both 4 and 6 GiB; those runs did not
reproduce the exact Next.js/CI failure. The build probe observes the actual child
heap, uses a harmless source and rejects a deliberately invalid TypeScript
assignment. [Corrected local builds and controls](build-heap-results.json) passed: cold build, harmless source, expected type-error refusal and restored build. Ten package/release tests passed. Final corrected-commit CI remains required before tagging.
No application, migration, worker or artifact behavior changes in this build fix.

## Limits and next work

Internal review files do not yet carry private decision-link lineage. Opening an
engagement review report shows a project-read warning and unrelated grant panels;
the retained files remain downloadable. That report-page correction belongs with
the next internal report-lineage work. M9b is not complete.

Privacy flags have no dedicated UI toggle. The tested public entry used its
accessible non-map path because the isolated build had no working map provider.
These journeys do not prove new map behavior, exhaustive keyboard/screen-reader
coverage, planner usefulness, language quality, representative participation or
legal publication authority. Human review is not a development release gate.
The full V1 contract, other early roadmap priorities and separate nationwide
AequilibraE/ActivitySim validation remain unchanged. Pending reminder constraints
and paid infrastructure remain untouched.
