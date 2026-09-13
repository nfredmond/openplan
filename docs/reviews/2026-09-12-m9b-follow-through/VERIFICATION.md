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
