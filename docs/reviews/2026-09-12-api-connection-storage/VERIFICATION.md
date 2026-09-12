# API connection storage, September 12, 2026

This is ongoing roadmap A0b implementation. It does not expose a selectable API
provider in the Planner Agent yet. The transport/credential foundation is on main
at `57a7b6ae`; CI 34716932357 and RLS 34716932401 completed successfully for that
exact commit. This storage increment has separate evidence below.

## Behavior implemented

One additive migration creates connection identities, immutable configuration
revisions and a separate credential table. Members can read workspace metadata;
only authenticated owner/admin routes can manage configuration. Database RPCs
repeat that check under membership locks. Browser mutations require the addressed
origin. All direct ordinary-user credential access and management RPC calls are
refused. Credential values are absent from metadata tables and response projections.

Edits name an expected predecessor and create a fresh revision. Exact retries
preserve the original revision, author, configuration and key. Application retry
recovery compares decrypted keys because randomized ciphertext cannot establish
plaintext equality; the RPC subsequently locks and compares the exact stored
ciphertext. A competing identical save can read the winner once and recover.
Changed request identity remains a conflict. Revocation is monotonic and version
checked. Historical actor UUIDs remain immutable after account removal.

## Executed evidence

- Eight live storage cases exercise history, duplicate delivery, stale edits,
  revocation, member/nonmember access, credential denial, foreign references,
  protocol/model/capability configuration and key mode.
- Twenty route cases exercise actual route/crypto/helper code with mocked database
  calls. They assert query projections and workspace/connection filters, owner/admin
  authorization before private reads, origin checks, retry keys, concurrent-save
  recovery and returned revision/revocation identity.
- Four actual two-session database cases exercise edit, revoke, role change and
  identical save. The second session is observed waiting on a database lock before
  the first commits. Changed/stale work is refused; identical save remains one revision.
- Storage mutations: one harmless SQL comment survived, 18 faults failed named cases.
  Every mutation is inside a fixture transaction and rolls back.
- Route mutations: one harmless comment survived, ten faults failed named cases.
- Concurrency mutations: one harmless manager-function comment survived. Removing
  `FOR SHARE` allowed the role-change competitor to save using its old role, and
  the test failed with `Concurrent unauthorized or stale save accepted`. The exact
  original function was restored in `finally` before full RLS began.

The first concurrent fixture failed during cleanup because auth-user creation
also creates a personal workspace. It also lacked a second owner for valid role
demotion. The corrected fixture gives the test workspace a custodian and removes
only its own synthetic workspaces/users. Four earlier committed synthetic fixtures
were identified, checked and removed from the disposable stack; their failure log
is retained. This was a fixture defect, not evidence of passing concurrency.
The immutability case was strengthened to change recorded authorship directly;
its original checksum-breaking input could have been caught by another constraint.

TypeScript and changed-file ESLint passed before the final full campaigns. The first full QA and shuffled seed 912055 each reported 13,923 passed, four failed and 413 skipped. Full isolated RLS completed with 442 passing tests across 48 files. The first QA failures are described below. No upgrade result is claimed yet.

## Scope limits and next work

The new database does not reference generation turns yet. The connection routes
have no model side effects. Generation, selected revision binding, queue claim,
edit/revoke cancellation of active turns, durable worker completion and visible
controls remain to be implemented before release. Existing Anthropic/native rows
are untouched. Browser desktop/390px, recovery, console and exact approval journeys
remain required for the integrated workflow. No external account or paid service
was used. A compromised service role/operator secret is outside ordinary RLS and
credential-envelope protection; mocked route queries do not substitute for live
SQL or browser evidence.

Private logs: `/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
Disposable DB: `/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`,
container `supabase_db_openplan-restore-target-2026091050`, API 29821, DB 29822.
It now has migration 20261012000001, for 317 migrations total.

## First broad-check findings

Shuffled seed 912055 reported four failures: one orphan-route guard, two outdated
policy/relation inventory counts and the missing migration name in Unreleased.
The remaining 13,923 tests passed; 413 live/opt-in cases were skipped. The catalog
has 752 policies and 239 RLS application tables, with a separate PostGIS system
table outside the source inventory. Inventory expectations now account for the
three new tables and two SELECT policies, and Unreleased names the migration.
The no-caller guard stays intact. Real configuration controls and their browser
evidence must precede landing this increment; no route exception is justified.

## Settings implementation checkpoint

Workspace setup now mounts an API configuration panel alongside existing integration
keys. Owners/admins can save, revise and revoke; members can inspect permitted
metadata and paginated revision history. The history route uses the ordinary
user client with explicit workspace/connection filters and metadata projections.
No model call occurs when settings are opened or saved. The UI explicitly says
Planner Agent generation is not wired to these connections yet.

Unconfirmed writes retain the exact serialized request and freeze edits until
retry or an explicitly confirmed local discard. A successful save clears the key.
A workspace change remounts the form. Failed refreshes preserve earlier metadata
with an error rather than claiming an empty workspace. Server authorization and
expected-revision checks remain authoritative for stale or revoked records.

Focused source checks: TypeScript, changed-file ESLint and 81 cases across the
settings, routes, caller guard and migration inventory/release-ordering passed.
The settings suite has 15 cases and route suite 22. Their first run exposed four
accessible-name mismatches caused by adjacent text nodes; explicit action labels
now name the relevant connection.

Settings mutations retain one harmless control and 21 targeted failures. Removing
one inner duplicate-click lock survived because the form handler and disabled
button still block re-entry. An actual second dispatch failed the request-count
assertion. Do not claim each redundant lock was independently necessary. Tests
also reject leaked local keys, changed retry IDs, editable uncertain drafts,
foreign returned identities, wrong predecessors, keyless credential leakage,
erased metadata, wrong history scope/projection, missing-connection success,
unconfirmed revocation, duplicate model IDs and lost pagination records.

These component tests mock HTTP and cannot prove RLS, browser layout or actual
server commit recovery. Identified desktop/390px browser evidence and final broad
checks are still pending at this checkpoint.

### Identified-browser correction

The first full QA and corrected shuffled seed 350666 passed with 13,944 tests,
413 skipped; the local connector suite passed 382 with four skipped, audit found
zero vulnerabilities and the webpack build completed. The settings RLS run
passed all 442 cases. The shuffled wrapper ignores the attempted environment seed;
350666 was its actual printed seed and the successful replay explicitly used it.

Build identity initially failed because the launch used an eight-character SHA.
Restarting our own server with the full SHA produced a matching identity. The
first browser driver also used `Email` where the product says `Work email`; that
selector was corrected. The actual save committed, then its response was aborted.
Retry returned the same revision with `created:false` and one historical revision.

Browser editing exposed a real labeling defect: implicit labels around a select
and populated textarea included option/content text in their accessible names.
Controls now have explicit labels and help text uses `aria-describedby`. Unit
checks name populated controls exactly; detached model/authentication labels each
fail mutation checks. The browser journey must be repeated on this corrected
build before claiming the settings workflow accepted. Our acceptance server was
stopped before editing; no other app or database was stopped.

## Corrected settings acceptance

Accepted product code `92b927fc`, identified serving checkout `908b576c` with
only the resume/design documentation added. Full `qa:gate` and shuffled seed
350666 again passed: 13,944 tests, 413 skipped; 382 native connector tests passed,
four skipped, dependency audit zero and production webpack build successful.
The separate 442-case RLS run covers the unchanged migration/route source.
The Python worker implementations are unchanged from the verified foundation.

Desktop 1440x1000 and 390x1000 journeys entered through the public homepage,
real sign-in and Workspace setup navigation. A synthetic account was created by
Supabase Auth, whose actual producer created its workspace. All connection and
revision writes used the product UI. A local provider listener observed zero
model requests in either journey.

Both journeys committed a save, aborted its response, and retried the identical
serialized body. Exactly one original revision remained. A keyed correction
created a second revision with the original as predecessor; the original complete
metadata object remained equal. Revocation preserved the two-revision history
with identical before/after hashes. Saved credentials were absent from history,
cleared from the password input and absent from local/session storage. Direct
ordinary-user credential reads returned 403; foreign-workspace history returned
404. A failed list refresh preserved its visible prior settings and displayed an
error. These checks do not certify provider compatibility or generation.

The only browser console errors were the intentionally aborted save response and
refresh in each journey, both ERR_FAILED; there were no page errors. Keyboard
navigation opened setup/history, submitted the save and confirmed revocation.
A further viewport inspection selected keyless authentication using End and
confirmed Tab reached the timeout field. The 390px panel measured 293px client
and scroll width; the document width equaled the viewport at both sizes.

The first element-sized screenshots included clipped portions of the app's
scrolling container and blank space. They were not adequate layout evidence.
The retained viewport captures were subsequently inspected at both widths,
including history, expanded revision evidence and keyboard focus. The capture
script's first homepage selector matched header and footer links; its final
version selects the header's real Sign in link. This was a driver correction.

Browser scripts, metadata/hash receipts and inspected viewport screenshots are
retained here, with `BROWSER_SHA256SUMS`. Credentials, account bootstrap secrets,
raw server logs and failed preliminary captures remain private. The named
acceptance server was stopped after both journeys; the separate demo is untouched.

GitHub Upgrade Path 34720213220 completed successfully for source `92b927fc`,
upgrading populated v0.54.0 state. Final main CI/RLS still need separate inspection
after this evidence checkpoint is pushed. No release tag or completed A0b claim
is made; joining saved connections to the retained Planner Agent task/worker is
next, as specified in `EXECUTION_JOIN.md`.
