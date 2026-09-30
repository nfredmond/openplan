# Candidate synthesis response link HTTP handlers

September 29, 2026. Continues the authenticated writer at `246b72fb`. This checkpoint adds unregistered HTTP handlers, the compact command protocol and a candidate navigation index. Staff controls, route registration and migration activation remain unfinished. The latest released workflow remains v0.63.0.

## Saved links remain discoverable

A staff-authenticated index names the response and review-group addresses in retained link events. It includes addresses after a response or group is removed and deduplicates subsequent refresh or withdrawal events. A missing review remains distinct from a review with no links. The index checks campaign, workspace and review scope; its reader requires exact counts and unique ordered addresses. Navigation metadata does not establish current publication eligibility or replace verified event history.

The browser command contains the frozen intent and expected context checksum. It does not need to retain the private source packet in browser storage. The writer first attempts exact recovery of an earlier request. For a new link or refresh, it resolves current evidence on the server and requires its checksum to match the frozen command. Withdrawal uses retained history after live evidence disappears. The raw-packet writer retains its existing byte-preservation contract.

The browser acknowledgement reader verifies event bytes, nested context bytes, exact intent, event sequence, context scope and the expected checksum. The application server continues to verify the complete nested evidence and current authority. The browser reader alone does not establish those facts.

## HTTP boundaries

The candidate private handlers provide index, history and current-context reads. Writes require current staff access, browser origin and matching actor, workspace and campaign. Optional pinned-account headers reject changed sessions. Each unregistered assistant-write marker causes an executable refusal. Commands have a streaming 16,384-byte limit, fatal UTF-8 decoding and strict field validation. Responses use private, no-store caching, bounded error messages and exact retained packets. Audit records omit the private reason and source text.

Handler tests exercise the real request parsing and response construction, but replace staff access and database services. Database probes exercise native grants, staff checks and retained writes separately. Neither layer establishes a working browser session through the real HTTP route.

## Verification and limits

The focused application suites pass 145 tests across record reading, compact writes, acknowledgement verification, index loading and HTTP handling. Type checking passes with an 8 GB Node heap. Its initial default-heap run exhausted memory and produced no type result. Focused lint passes.

Mutation evidence retains 90 executions: 16 surviving baseline or harmless controls and 74 detected faults, including repeated handler checks after removing route registration. Faults cover origin, assistant markers, identity binding, staff access, private caching, byte limits, Unicode, exact receipts, index counts and ordering, compact recovery and native grants. The expanded native probe checks two distinct response addresses, a separate retained review with no links, removal, old retry and withdrawal. It detects a correlated SQL limit that truncates both the count and entries, which a reader checking those fields against each other cannot detect. The 302-address test uses an RPC fixture; it is not a 302-link native-write run.

The first native index test used a fixture account that an earlier fixture step had promoted from viewer to owner. The new test now explicitly restores the viewer role before asserting denial. Removing the native viewer restriction then fails that assertion. An acknowledgement fixture initially iterated context objects alongside event packets; it now selects the four actual event packets. These were test-fixture defects, not evidence that the native access guard failed.

The candidate stays outside the migration directory. The isolated source database retains 347 installed migrations and no candidate objects after rollback. New index membership-change interleavings, browser persistence, staff usability, installed RLS, workers and populated upgrade remain outside this checkpoint's evidence. The focused native run passes four cases and skips 122. The first shuffled run passes 15,854 tests and fails the existing route-caller check because the new endpoint has no product caller yet. The handlers now remain in the application library without an active route until the staff workflow is connected. The route-caller check stays unchanged. The concurrent first QA run was stopped after this finding; it is not a completed QA result. Final QA passes lint, the dead-code gate, 15,855 ordinary tests, 382 provider checks, the dependency audit with zero reported vulnerabilities and the production build. Shuffled testing passes the same 15,855 cases with seed 672286. The ordinary suite skips 755 opt-in cases; provider checks skip four. Ordinary QA does not run live RLS. The four focused native cases remain separate evidence; final main CI and isolation checks are pending. [Machine-readable evidence](http-checks.json) retains source hashes, mutation outcomes and the check record.

## Next work

Connect durable browser commands and retained-link navigation to the existing Analysis and response controls. Preserve unreadable local copies and exact pending requests across interruption and account changes. Complete decision provenance, migration activation and populated upgrade checks. Then exercise identified desktop and 390px navigation, keyboard operation, console output and usable artifacts before releasing the workflow. Reviewed exports, resumable generation and the remaining V1 contract stay open.
