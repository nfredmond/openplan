# Native synthesis request custody

September 30, 2026. Internal M9b preparation, following the complete input,
record, field, task and result protocols. This does not release or enable a
generation interface.

## Retained request and cancellation

Migration `20261014000033` adds immutable private request and cancellation
ledgers. A request binds its campaign, workspace and original staff actor to
exact intent bytes, a retained source and checksum, a saved compatible API
connection revision and configuration checksum, the selected model, and a task
byte limit. The request contains references rather than copied source text or
credentials. The small intent has a 4096-byte limit; retained source content has
no new cap. Task limits preserve the previously checked 4096 to 1048576-byte
range and do not assert tokenizer or complete HTTP-envelope fit.

Native creation checks current staff access, source scope and checksum, and the
current unrevoked API revision and configured model. Exact retries return the
original request before checking changed configuration. Cancellation also leaves
the original request intact. Neither operation reads a key or calls a provider.
The request records preparation intent only. It is not spending authorization or
a complete dispatch budget, and no worker claims these rows.

A cancellation retains its original actor, reason, whether the request existed,
time and checksummed receipt. It can precede creation. The shared request lock
serializes creation, cancellation and recovery reads; a prior cancellation blocks
late creation. Current staff may inspect a retained campaign record, while only
the original requester may retry or cancel it. A different cancellation identity
or changed reason cannot replace the receipt.

The new tables deny direct authenticated and anonymous reads and writes. Service
access is read-only. Staff use the scoped native functions. All new functions
place `pg_temp` after the trusted application schema. Foreign keys retain the
source and API revision referenced by a request; immutable record triggers refuse
updates and deletion. No existing source, review or approved export is rewritten.

## Checks and observed failures

The first candidate run passed 27 checks and exposed one surviving fault.
Removing the connection workspace condition alone did not bypass the independent
revision workspace condition. The final suite retains that survivor and also
removes both conditions in a targeted failure. It does not count the surviving
fault as caught. Permission fixtures grant access to their temporary helper table
so anonymous and service probes reach the native function permission being tested.

The next candidate run passed 32 checks against the named isolated database,
including a harmless function-comment control and a separate PostgreSQL lock
holder. An unrelated held request permits the normal fixture. A held matching
request refuses creation, cancellation and reads with the retryable busy result.
Removing that fence fails the concurrent-creation assertion. Every native fault
and synthetic fixture rolls back.

Migration application advanced the isolated target from 351 migrations to 352.
The final suite adds four explicit anonymous/service permission faults and two
absent-cancellation scope/actor faults, followed by two retained-reference faults,
for 40 checks, and joins `npm run test:rls-live`. The existing trusted-search-path suite
now includes all four new functions and weakens each setting individually.
Installed full RLS passed 772 tests across 69 files, with 125 skipped. Full QA
and the shuffled run each passed 16022 tests, with 868 skipped. The production
build and dependency audit passed. [Verification](NATIVE_VERIFICATION.md) and
[checksums](native-checks.json) retain the terminal results and limits.

The first separate TypeScript invocation exceeded Node's default 4 GB heap.
That process failure is retained. A separate rerun with a 6144 MB heap passed.

Broader checks caught three integration omissions: the old relation count, four
unexplained SQL-only columns and the missing operator-facing migration name.
Their correction passed all 40 relevant checks. A harmless comment control
survived; reverting each of three counts, removing each of four reader entries,
and removing the migration name produced the corresponding assertion failures.
The source was restored. These inventory guards cannot establish native access,
complete application reachability or generation usefulness.

A subsequent native probe found that another requester reusing an absent,
cancelled request received the cancellation conflict instead of the access-denied
code. Creation remained blocked. A new regression assertion failed against the
old installed function for that exact mismatch. Creation now checks the retained
cancellation actor, campaign and workspace before reporting its status. Tests
include another actor, another workspace and the original actor with membership
in both workspaces. The isolated function was replaced without recreating tables;
the unreleased migration file matches the corrected definition. The superseded
RLS run was explicitly stopped, and cannot be counted as passed.

## Unfinished boundaries

These fixtures establish native custody, private access and request serialization.
They do not establish provider authenticity, credentials at dispatch time,
concurrent access/configuration revocation during a provider call, charge limits,
long-job planning, uncertain-call recovery, output redelivery, complete context
consolidation, useful generated proposals or explicit staff import into retained
review history. No UI or browser-generation claim follows from these checks.

Native request cancellation must fence every future planning and dispatch claim.
An already returned provider receipt must remain recoverable after cancellation.
Future execution needs explicit bounded dispatch authorization and cannot treat
request existence as permission to charge. Saved compatible API request custody
does not remove installed Codex, Claude Code or OpenCode support from the V1
contract. Manual preparation and review remain usable without a model.
