# Synthesis response workflow implementation

September 30, 2026. Base commit `03fd1364d44b33fb91c181957e5b96d945a55651` has successful GitHub CI and RLS checks. This note records the subsequent verified local checkpoint, not a release. Full QA, shuffled tests and full installed RLS pass. Final commit CI and the CI populated-upgrade job remain pending.

## Changed behavior

The Analysis tab now connects a retained staff review to saved responses. Staff can inspect the current approved group, save an exact link, retain corrected evidence, withdraw a link and reopen every original event. Removed live responses and groups remain discoverable through private retained addresses. Commands bind the account, workspace, review, response, group, predecessor and inspected context hash. The server resolves complete evidence and preserves the original receipt before considering current-state checks on retry.

The browser retains unfinished reasons and exact pending commands. It preserves unreadable or conflicting copies before another draft. Source revalidation carries quota-failed text in page memory; it does not claim durable storage when the browser refuses storage. Access loss clears private presentation.

Migration `20261014000029_engagement_synthesis_response_links.sql` activates the previously tested candidate tables, writer, private readers, publication checks, automatic withdrawals and retained navigation. It is installed only on the isolated reference test stack. The canonical demo remains v0.63.0.

## Evidence

The isolated database advanced from 347 to 348 migrations. Before and after checks preserve every row count and aggregate checksum in seven existing response and synthesis tables, including 3,135 responses, 3,203 response-history records and eight approval events. These checks establish custody for those populated tables, not every possible installation.

Installed native testing passes 55 cases. It covers complete receipts, correction, withdrawal, staff revocation, anonymous and foreign-account denial, immutable events and members, dependency-driven public withdrawal, retained report bytes, exact lost-acknowledgement recovery, and real concurrent answer changes. Harmless controls succeed; altered grants, removed integrity checks and disabled withdrawal triggers fail their stated assertions. An initial run against the preactivation schema fails because the writer does not exist. The installed cases supply no candidate DDL. The 122 historical candidate-only cases now require `OPENPLAN_SYNTHESIS_CANDIDATE_TEST=1` and a preactivation test schema. Their earlier evidence remains unchanged.

The browser journey starts at sign-in, follows Engagement to Setup, creates a synthetic staff response, then opens Analysis and a source retained by an earlier product journey. It creates and approves a new staff review through the UI. At 1440px and 390px, keyboard activation saves a link, loses the real committed acknowledgement, retries the exact request, corrects and approves the review, refreshes the link and withdraws it. Exact hashes and retained bytes establish that the original survives. Both widths also exercise storage refusal, an actual focus change, recovery-copy restoration and private presentation clearing after an actual endpoint denial. Screenshots were inspected. The final console contains only the deliberately interrupted POST and two deliberately denied reads; no page exceptions occur. Layout controls survive a harmless style change and detect deliberate button overflow.

Browser packet readers verify retained hashes, scope, selected groups, approval identity and complete event ordering. They do not independently recompute all nested source membership or establish current agency authority. Synthetic UI tests establish protocol and recovery behavior; native tests establish database authorization and transaction behavior. Neither establishes human usefulness, interpretation quality or field accessibility across assistive technologies.

## Findings retained

The first runner used the participant Responses tab for the staff-response form. The form belongs under Setup. A later runner used an exact label-text locator for a select whose label includes its options; the role locator reaches the actual control. These runner failures remain in private evidence.

A browser recovery check found an application defect. Restoring a preserved draft passed its reason along with the link address. The strict endpoint refused the extra query parameter, and the display reader also refused the extra scope key. The panel now selects the two address identifiers when opening a link. The regression test first fails on the original behavior. The correction and harmless control pass; restoring the original behavior fails the recovery assertion. The final desktop and phone journeys repeat that recovery successfully.

Earlier mutation probes found overlapping sequence and response-count assertions. The tests now use otherwise valid predecessors and distinguish actual array size from declared count. A withdrawal fixture now repeats the exact previous context, so rejection proves the repeated-withdrawal guard. One partial mutation-report overwrite and one replacement-count error are retained in private findings; the separate final runs establish the reported controls and faults. One earlier desktop journey recorded an unexplained network-change console error. It remains a failed run. Later complete journeys record request failures and pass without that error.

## Remaining work

Inspect final commit CI and the populated-upgrade job before the next implementation. Decision packets and reviewed exports still need the retained synthesis chain. This workflow does not complete M9b, optional generation, measured planner usefulness or the V1 contract. No human software-review gate applies. Final release metadata, final commit CI, tagging and demo upgrade remain separate work.

[Machine-readable results](browser-checks.json) retain source hashes, mutation outcomes and bounded browser results. Raw synthetic packets, screenshots, console captures and local run logs remain in the private evidence directory recorded there.

## Full-suite integration follow-up

The first ordinary and shuffled suites each found the same five failures, with
15,913 other tests passing and 806 opt-in cases skipped. The migration census
needed its two new private tables; the SQL-only column ledger needed eight
reader explanations; the Unreleased changelog lacked the migration name; the
new planner copy used the internal term campaign; and the route audit scanner
did not follow the handler re-export. No failing guard was removed or weakened.

The handler implementation now lives in the registered route. Its bytes matched
the former helper before the move. The column entries identify real SQL readers,
not unfinished application promises. Native catalog inspection confirms 258 RLS
tables and 14 application views, excluding two PostGIS extension views. The
changelog names the required upgrade and the UI says consultation. All 75 focused
integration tests pass. Ten baseline or harmless controls and 17 targeted faults
establish that the updated census and reader entries, audit declaration, wording
and migration note can still fail for their stated reasons. The census cannot
prove row access; the separate full live RLS run remains authoritative for that.
The corrected full QA and shuffled runs pass.

## Final local gates

Full QA passes lint, dead-code checks, all 15,918 ordinary tests, provider checks,
the dependency audit and the production build. Shuffled testing passes the same
15,918 cases. Both ordinary runs skip 806 opt-in cases. Separate installed RLS
passes 713 tests across 67 files, with 122 historical candidate-only cases skipped.
All 52 worker suites pass with no failures or skipped environments.

The browser captures precede the byte-identical handler move and the one-word
access-loss notice correction. The final route regression tests and production
build pass after those changes. Repeat the affected identified-build journey
for the release commit. This remains a development checkpoint with the next
source-to-decision and reviewed-export boundary open.
