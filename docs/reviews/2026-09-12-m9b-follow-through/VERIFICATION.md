# Staff response read recovery, implementation checkpoint

This is unfinished M9b work on work/engagement-response-recovery, after release
source c73b051095d59beb105cf9cb1570776d416676ec. It is not part of v0.55.0.
Implementation checkout remains the isolated agent-hold-receipts-2026-09-10
checkout. Root/main/demo are untouched locally; no other OpenPlan agent owns
these files. No browser/dev/fixture worker is currently running.

The authenticated response loader now returns rows and error separately and
withholds partial rows on failure. The GET route uses the existing read-failure
classifier: pending schema 503, other database read failures 500, a successful
empty read 200 with an empty list. The campaign page passes the failure into
the existing response builder. It hides invented zero counts and empty-state
claims, disables edits while responses are unavailable, and offers a local GET
retry. Successful retries validate row shape, campaign scope and unique IDs
before replacing entries. Failed retries preserve already held entries. The
public reader, publication guard, notifications, SQL and exports are unchanged.

Focused initial replay: 96 tests in five files passed. The additional campaign
page failure case passed with the whole 57-case page suite. TypeScript and
changed-file ESLint passed. Later mutation controls run all 93 tests across the
four affected test files. The unchanged four-case copy suite passed separately
in the initial replay. These are mocked query/React tests, not browser or live
permission evidence. Existing server membership checks remain the read authority.

Mutation record: mutations.json retains one harmless survivor, twelve intended
failures and one unexpected malformed-response survivor. That fixture lacked a
campaign ID, so the scope guard rejected it even with row validation removed.
The corrected fixture has the right campaign and an invalid status, reaching
the intended validation guard. mutations-selected.json records the repeated
harmless survivor and the now-failing validation removal. Both scripts restored
all four runtime files byte-for-byte; private recovery paths:
/tmp/openplan-m9b-read-mutations-gjmdli/state.json and
/tmp/openplan-m9b-read-mutations-X2p8G7/state.json.
No mutation remains active. The surviving first probe is not reported as a kill.

Next: run identified real navigation at desktop/390px, using the existing
synthetic local account and a temporary loopback HTTP proxy to the named
openplan-restore-target-2026091050 stack. Have the proxy refuse only this
campaign's staff-response reads, then restore them. Create the campaign and
retained draft through actual forms; demonstrate unavailable versus empty,
retry after continued failure and successful recovery of the unchanged draft.
Do not mutate/drop the schema to manufacture the failure and do not send live
subscriber messages. Preserve console and screenshots; follow with full QA and
shuffled tests. No new SQL/worker path is introduced by this read-only repair.

Still open: complete pagination/snapshot semantics beyond a single backend page,
retained response correction/publication history, source-to-decision/commitment
links, artifact/report continuity and full M9b. This repair does not establish
cross-navigation draft persistence or comparative human usefulness.

## Release still being finished independently

v0.55 main source c73b051095d59beb105cf9cb1570776d416676ec is fixed and already
pushed. RLS Isolation 34731133153 succeeded. CI 34731133158 has successful
Python worker, modeling, ops and shuffled jobs; QA is still running at this
checkpoint. Upgrade Path 34730331136 passed for the unchanged upgrade sources.
Poll that exact CI run; once it succeeds, tag c73b0510 explicitly, NOT this
branch's HEAD, and publish v0.55.0 using private v055-release-notes.md. The full
body is prepared under api-provider-research-2026-09-12. No draft PRs or human
review gate. Continue M9b after publication; the overall v1 goal stays active.

## Initial browser result and release completion

v0.55.0 was published after all exact-commit CI jobs and RLS passed. Its tag
peels to c73b0510; it does not include this M9b work. See the v0.55 verification
record and publication receipt. Do not repoll or recreate that release.

The M9b browser journey on f75baa29 passed at 1440px and 390px using a real
campaign/draft created in the UI and a local proxy refusing campaign-specific
PostgREST reads. Both failed retry 500 and recovered retry 200 were exercised
by keyboard. The recovered response JSON equalled the original byte-for-byte
under canonical JSON hashing; it remained a draft, and anonymous GET was 401.
No schema was changed or subscriber notified. Both widths had no horizontal
overflow or page errors. The desktop run also had Chrome network-change,
Fast Refresh and preload warnings. Mobile had preload warnings and the
deliberately injected failed-request console error. Full logs/screenshots are
preserved privately under m9b-f75baa29-initial. This is not a zero-console claim.

Visual inspection caught adjacent count/disclosure sentences without spaces.
The text now includes explicit JSX spaces. The browser script also reports
per-journey refused-read deltas instead of the proxy's cumulative counter.
The original assertions of 500 and 200 already tested actual failure/recovery;
this corrects the attribution of the extra counter. A final replay follows.
The proxy/dev supervisor 1360274 and its child were stopped intentionally;
handle 20287 is terminal. All sources were restored after mutations.

## Accepted browser replay and patch candidate

Both widths passed again on db165e51, including the explicit spacing fix.
The public synthetic browser folder contains scripts, identified checkout,
reports, accessible text, viewport captures and SHA256SUMS. Each journey
recorded 12 campaign-specific read refusals, failed retry 500 and recovered
retry 200, unchanged saved draft hashes, anonymous 401 and no page exceptions
or horizontal overflow. Screenshots and accessible text confirm readable
warning, retry, recovered draft and correctly separated count sentences.
Desktop console retained two Chrome ERR_NETWORK_CHANGED errors, eleven preload
warnings and the deliberate 500. Mobile retained six preload warnings and the
deliberate 500. These are successful functional journeys with disclosed console
noise, not zero-console runs or independent screen-reader acceptance.

The owned proxy/dev supervisor 1427427 was stopped after the final journeys;
handle 36410 is terminal, exit 0. No proxy, browser or app process from this
acceptance remains running. Prepared patch version 0.55.1 because this repairs
an existing workflow; 318 migrations are unchanged. Product metadata is aligned
without changing review dates/statuses. Full QA, shuffle and final CI remain
required before landing/releasing this patch.

## Read-error ratchet correction

Both full QA and shuffled seed 912557 failed the same obsolete exception:
close-loop.ts was still listed as discarding one read error, but the corrected
loader discards zero. Each application suite finished with 14092 passed, one
failed and 450 skipped. The shuffle runner's generic order-dependence text is
not evidence of an ordering defect here. Removed the obsolete exception and
its stale prose, including an already-removed public-photo allowance in that
comment. The remaining allowance is six sites across two files.

read-ratchet-mutations.mjs/json records the 36-test detector suite surviving
a harmless comment and rejecting a restored data-only read in close-loop.ts
for the missing exception. Source was restored byte-for-byte. This static
guard does not prove runtime recovery or catch every possible way of ignoring
an error; the separate runtime and browser evidence cover this changed loader.
Full QA and shuffle are being repeated after this correction.

## Corrected local release gates

Full QA and shuffled seed 912557 completed with exit 0 on d7030c37. Both
application runs passed 14093 tests, skipped 450, with 1258 passing files
and 43 skipped. QA also passed lint, dead-code checks with existing advisory
findings, 382 native connector tests with four skipped, TypeScript and the
webpack production build; dependency audit reported zero vulnerabilities.
local-release-checks.json retains terminal receipts and private-log hashes.

Browser SHA256SUMS was checked again and all eleven entries matched. The
runtime code remains the accepted db165e51 browser implementation. Subsequent
changes are release metadata, evidence and removal of the repaired exception.
SQL, migrations, workers and scientific scripts are unchanged from v0.55.0.
Local QA explicitly skipped live RLS; prior isolated SQL evidence remains in
the v0.55 record, and the final main commit must pass its own CI/RLS workflows.
No new upgrade migration is required or claimed by this patch.

## Published v0.55.1

v0.55.1 is published, not a draft or prerelease. The remote annotated tag peels
to 0f61c3728b4ace3cc562f07fc90087e9e848f703. All five final CI jobs in
34732984235 completed successfully, as did RLS Isolation 34732984209.
v0551-final-ci.json, v0551-final-rls.json and v0551-publication.json retain
the terminal and publication receipts. No pending historical observation below
or above overrides those final results. The next response-snapshot migration
is separate, unreleased work and was not included in this tag.
