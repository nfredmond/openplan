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

TypeScript and changed-file ESLint passed before the final full campaigns. Full
QA, shuffled seed 912055 and full isolated RLS are running; inspect their handles
and logs before claiming those passed. No upgrade result is claimed yet.

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
