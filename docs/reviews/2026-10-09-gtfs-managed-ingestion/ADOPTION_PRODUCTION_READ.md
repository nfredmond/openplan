# Completed imports and current service use, October 11

Clean frozen source `6a750ff265ad27839c0af4779afd1cc7c2bd3129` includes
main `8e721db11acf`, the registry correction and the lower language counter.
The app remains version 0.68.0. This verifies a development candidate, not a
release or hosted deployment.

## Build and affected regression

[The selected regression](adoption-counter-regression.json) passes 149 files
and 2,916 tests, with 45 skipped and none failed, in 210.534 seconds. Direction
and changed-guard lint pass. The serial service peaks at a rounded 500.9M under
1 GiB, with swap disabled and one CPU. This is not the complete QA gate.
The earlier failed f381 equality check stays in [its report](REGISTRY_ADOPTION.md).

[The production build](adoption-counter-build.json) completes with actual child
exit zero in 175.853 seconds. Webpack, TypeScript and all 140 pages finish.
Build ID is `8RvVDpNJGWrngjjyMcIfO`. One worker and a 6 GiB Node heap run
inside a 10 GiB service cap, with swap disabled. The largest sampled peak is
6,590,922,752 bytes; the final journal reports a rounded 6.1G peak. Independent
locked dependencies and the previous f381 build cache are copied; no previous
complete build output is copied.

[Twenty-two launcher controls](adoption-counter-launch-controls.json) exercise
synthetic configuration and pure preflight. They establish no server acceptance.
The actual serving process uses the frozen nested package on port 3568. Browser
health reports commit `6a750ff265ad` and app `ok`. Database health remains
`not_checked`, so native reads below provide separate evidence.

[Executable continuity](adoption-executable-continuity.json) confirms runtime,
schema, worker, script and package bytes are unchanged from f381. Its sole
changed executable-area file is the stricter language test baseline. Earlier
TypeScript, lint and control results retain their actual f381 source boundary.

## Actual T3 journey

The retained synthetic owner reaches Dashboard, Data Hub, Projects, the saved
Oakland project, Travel modeling and the existing draft through app links.
Some native-select key calls time out; subsequent DOM reads and the actual
request confirm the resulting choices. An ambiguous Projects locator is
corrected to the observed navigation selector. A project table-link click does
not establish navigation; the visible project card does. Those incomplete tool
attempts receive no acceptance credit.

At desktop and 390px, CTA shows `Ready for review`, 132 routes, 11,138 stops
and no predecessor in use. Its registry shows `Not adopted` and directs review
and adoption. The false no-derived-results statement is absent. No adoption
occurs. Current BART version `8a86a802-a3cc-4b09-979d-6187bad01285` retains
14 routes, 287 stops and the historical-command-receipt caveat. Cancelled
version `1ca4fa87-713d-4a0e-8015-9edd428f1640` stays in its single review panel.

Selecting Fast Screening reveals the model's transit selector. CTA is absent
from its choices. Selecting retained BART makes the actual coverage POST with
saved Oakland geometry: 60,606 serialized bytes and SHA-256
`007c5ce9a3bea160193427fe1e6f769c33c239b3b448cd9e40ab623d9acdd8fd`.
HTTP 200 returns `coverage: yes`, schedule end `2027-01-10` and 238 stop-service
rows. Fresh native geometry and envelope counting agree. These are schedule
rows, not distinct stops, exact polygon coverage or measured operations.

All ten [original captures](candidate-adoption-browser-artifacts.json) are
retained privately and inspected. They show the completed/current/cancelled
cards, exact-archive/checksum disclosure, schedule date and saved Oakland source.
Document width equals the 1280px or 390px CSS viewport. The native select
truncates its long option at 390px; the separate date disclosure remains
readable. The draft keeps zero runs, prototype and independent-validation
caveats, and an unavailable compatible AequilibraE heartbeat. No model launches.

[The observer](candidate-adoption-production-browser.json) runs from
09:28:20.071 to 09:37:20.997 UTC. It captures no window error, rejection,
console error or instrumentation failure in that interval. Earlier Electron
preload errors, the older observer-caused RSC fallback and aborted prefetches
remain historical evidence. The whole browser/network history is not declared
error-free.

## Native custody, controls and remaining work

[Fresh native reads](candidate-adoption-browser-native.json) verify unchanged
project geography, current BART metadata and zero draft runs. CTA stays ready
with one claim, no token, 1,678 route-service and 74,517 stop-service rows.
Its current pointer stays null. Cancellation stays terminal with one attempt
and claim, no token, no derived publication and no current pointer.

[The verifier](verify_adoption_candidate_browser.py) reads native records before
and after its controls and requires equality. Three positive observations and
[46 deliberately broken observations](candidate-adoption-browser-controls.json)
behave as intended. Actual capture bytes match their hashes.
[Scope controls](candidate-adoption-native-scope-controls.json) pass three
positive cases, seven refusals and seven omitted-guard checks. They cover both
databases, immutable container identity, name, project, running state and changed
records. Their [runner](verify_adoption_native_scope_controls.py) changes only
in-memory copies, with no Docker or database writes.

[Source hashes](candidate-adoption-source-hashes.json) identify these records.
[Current-source GitHub CI](gtfs-6a-ci.json) passes all five jobs. Full QA and the
executed shuffled suite each pass 21,778 tests, with 1,604 skipped.
[Live RLS](gtfs-6a-rls.json) passes 104 files and 1,499 tests, with 125 skipped.
[Archive CI](gtfs-6a-restore.json) passes at the same source. Its retained artifact
contains 374 tables, 6 sequences and 1 Storage object, verified mounted
key custody and matching independent OWP reconstruction. Restored sign-in and
the final 104-file RLS pass are observed.

[The separate bounded local archive](adoption-counter-full-archive.json) also
passes with actual child exit zero in 2,889.426 seconds. It restores 374 tables,
six sequences and one object, verifies mounted key custody, restores sign-in,
compares independent OWP records and passes 1,499 RLS tests with 125 skipped.
All twelve own services retain 1 GiB/no-swap/one-CPU limits and no OOM flag.
The largest recorded runner peak is 1,033,023,488 bytes; the final journal rounds
it to 985.1M. Only those twelve containers stop after immutable ID, name, project
and limit checks. Volumes and private proof remain retained.
The encryption checkpoint's [earlier successful archive CI](earlier-904-restore.json)
retains its source boundary. Hosted schema-first disposition, main integration,
release, clean agency commissioning, cross-host recovery, all-worker long
computation, practitioner observation and independent scientific validation stay
open. Migrations 28 through 31 remain unreleased. This lane changes no hosted
schema, configuration or admission setting.

[The next installation boundary](REFERENCE_INSTALLATION_REVIEW.md) compares
pinned official Supabase source with actual owned drill components. It preserves
the different topology and key-mount scope instead of extending CLI acceptance
to production.

## Encryption main and exact-source CI

GitHub records another writer's merge of PR197 at 09:36:40 UTC, main
`091d3ecff4eb3d93817334d14cb2f5bd4556d52c`. This lane does not perform that
merge. [A read-only merge calculation](main-encryption-join-continuity.json)
produces exactly the frozen 6a candidate's committed tree. It changes no worktree
and does not replace native or build evidence.

Encryption source `6072ec774` passes [full QA and shuffle](encryption-607-ci.json),
each with 20,830 tests and 1,604 skipped. Its [live RLS](encryption-607-rls.json)
and [full archive](encryption-607-restore.json) each pass 104 files and 1,499
tests, with 125 skipped. That archive restores 362 tables and one object.
[Earlier d6 archive CI](earlier-d6-restore.json) separately restores 374 tables
and one object with the same live RLS totals. These distinct source inventories
are not current GTFS archive acceptance.
