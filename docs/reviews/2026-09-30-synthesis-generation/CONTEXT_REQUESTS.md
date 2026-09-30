# Context-stage request custody

September 30, 2026. Verified internal checkpoint after main `d7888144`. The
additive migration is installed in the named isolated verification stack.
Combined QA and shuffled tests pass 16,426 tests each, with 1,073 skipped.
The production build passes and the dependency audit reports zero vulnerabilities.
The complete isolation suite passes 976 tests, with 125 skipped. The subsequent
native worker suite includes the new authenticated HTTP case and passes all
12 tests. Final main CI remains pending. This increment retains request custody;
contextual execution and a staff browser capability remain unfinished.

The new authenticated command creates a separate generation request and retains
its context binding in the same transaction. The binding names the parent segment
request, selection sequence, selected-result checksum, dependency checksum,
content checksum, target contribution identity and frame byte limit. The base
request retains the new actor, exact source, provider revision and model choice.
Only current campaign staff may create or read the record. An earlier request
cannot be converted into a context request.

The original requester may have departed, and the parent may be cancelled.
Neither prevents current staff from retaining a new context-stage intent. The
new request does not renew the parent's execution authority or alter its source,
choices, actor or cancellation. Child and parent request locks fence creation.
The parent must be an existing segment request in the same campaign/workspace,
and the child must use its source. A future selection sequence is refused.

Exact retries compare both the original base intent and the context bytes. They
return the saved record after cancellation or provider revocation. Current staff
can read another staff member's record, but only the original writer can replay
that write. The existing cancellation command remains available for the new
request. Private table access, anonymous RPC access and service-role impersonation
of authenticated request commands remain denied. Original context rows refuse
updates and deletion.

The version-one segment plan scope explicitly refuses a context request with
SQLSTATE `0A000`. This refusal also protects preparation and authorization paths
that use that scope. A context request cannot be sent through the old frozen
recipe. Ordinary segment requests retain their existing behavior.

## Engineering evidence

The installed candidate passes 31 native context-request tests, including a
harmless control, targeted mutations, retained parent identity and live
child/parent lock contention. The first fixture used
the wrong error code for the existing immutable-history trigger. The expected
code is `P0001`; no trigger change was needed.

Four initial privilege mutations survived because membership checks still
refused the calls. The corrected fixture also inspects actual function grants,
so it distinguishes denied execution privileges from a later membership denial.
It now catches all four grant mutations. The lock test seeds its parent without
taking the contested advisory lock during fixture setup, then exercises the actual
context command. Removing its parent lock makes the contention probe fail.

The additive upgrade preserves 138 existing requests, 614 attempts, 582 outputs
and 614 selections. Sorted request-intent, output-capture and selection-receipt
fingerprints match before and after. The demo database is not the test target.
The initial full QA run also caught the unchanged schema inventory counts. The
installed catalog confirms the intended addition: one ordinary table, RLS enabled
and zero policies. The exact relation/table/RLS counts are now updated, and the
three schema/census suites pass 40 tests. The failed run is retained.

The two new commands are included in the trusted-search-path inventory; the new
native suite is included in `test:rls-live`.

## Required continuation and limits

The retained hashes are requested identities. These native commands do not
reconstruct provider bytes, prove complete source processing or approve a model
call. In particular, the structural fixture deliberately uses proposed synthetic
hashes and a zero selection sequence. A future executor must reconstruct the
saved source, anchored results, dependency inventory and exact content, compare
every requested checksum and target, and refuse incomplete or empty model work.
It must not trust the stored hashes merely because a staff request retained them.

The application service now loads authenticated historical results, rereads the
original immutable source through its authenticated RPC, and reconstructs the
source, original task plan, dependency inventory and exact content. It accepts
only complete retained results and an actual selected contribution. It derives
all three manifest checksums before writing through the current staff client.
The native write rechecks permission in its transaction. Interrupted writes
remain unconfirmed until an authenticated read or exact retry resolves them.

The initial eight service tests pass. A harmless comment control survives, and
24 of 25 initial targeted mutations fail the intended assertions. Removal of the
receipt workspace check initially survives because the test omits a foreign
workspace receipt. That case is now added; the corrected probe catches the removed check, and its
harmless control still passes.
These tests mock the history loader and RPC transport, so they do not establish
the real authenticated database join. The separate native HTTP test passes
through real Auth, PostgreSQL, PostgREST and Kong. Its synthetic local provider
returns complete part coverage. Current staff create and replay a context
request after the parent is cancelled and its requester loses access. Another
staff reader can inspect it but cannot replay its writer identity. Incomplete
results and revoked access are refused, the old executor refuses the context
request, and no context attempt or further provider call is created.
The HTTP test also passes a harmless comment control and fails when the service
substitutes a zero result checksum for the reconstructed manifest. The original
source bytes are restored. [Recorded evidence](context-request-proof.json) retains
the initial survivor, correction, source checksums, upgrade comparison and final
local checks. These checks cover request custody and reconstruction, not model
interpretation or physical power-loss recovery.

The service receipt reader verifies request and context identity, but does not
verify a cancellation receipt or grant execution authority.

Next add an explicit versioned context recipe, plan and authorization path,
preserving the old segment recipe and explicit retry behavior. Complete
resumable contextual processing, machine proposals and staff acceptance into a
new review revision. Staff controls and identified desktop/390px browser evidence
remain open. This increment neither completes M9b nor changes the full V1 scope.
