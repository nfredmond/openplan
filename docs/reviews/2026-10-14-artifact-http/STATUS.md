# Original retained artifact HTTP candidate, October 14

This candidate connects an explicitly supplied download adapter to the existing
worker HTTP handler. It resolves the original admission from its private journal,
then serves the original retained product under its saved token and expiry.
The default worker does not supply the adapter. No production setting or migration
changes here. The preceding delivery-authority migration remains a dependency.

## Behavior

Reference lookup reloads the complete original admission and started context.
The route accepts the canonical original reference, token and filename. It
requires the saved lease, typed completion receipt, retained product descriptor,
private regular file, original size and hash. It never falls back to the legacy
in-memory token registry when an explicit adapter is supplied.

The lease selected for response headers must match the lease used by the retained
reader. The reader checks current original actor access before output. The
adapter checks authority, ownership, expiry and deadline again after headers,
before the first body byte. Socket writes have a finite timeout. A refusal after
headers closes an incomplete response. The retained reader withholds the final
chunk until original checksum and current access checks pass.

Request logs retain the method and status. They omit raw URLs, private tokens
and raw error messages. An unavailable journal receives a bounded generic
refusal. A copied private runtime resolves the original admission and bytes
without the legacy memory registry.

## Local checks

The ordinary 33-case lookup and HTTP run passes. A separate real non-reading
client test passes with an eight MiB synthetic raster product retained through
the original archive and product chain. Its reduced real socket buffers force
backpressure. The handler returns before the whole-stage deadline, leaving the
product incomplete. Independent review rejected an earlier assertion based on
one capped read. The current check drains to EOF and compares the entire body
with its declared original length. Application reads in this test are fixtures, not native RLS.

Diagnostic fault probes cover all 34 cases and detect 35 intended faults.
Four full positive cohorts on each of Python 3.14 and Python 3.11 now pass
all 34 cases, with 35 intended faults detected on each interpreter. Existing
artifact-reader and admission regression pass on both interpreters: four
47-case cohorts detect 50 faults on each, and 164 related cases pass on each.
The first native run passes its behavioral cohorts but checks source selection
by row count. It does not establish exact restored-source identity. The corrected
runner checks every migration version, the recorded restore capture and exact
authority body before replacing any function. Four three-case native cohorts
and three SQL faults pass on this corrected runner. Completed originals serve
exact bytes; canceled or revoked originals receive no product.

Four restored-source preflight cohorts survive. Five wrong inputs fail at the
named restore variant, database identity, capture, version census or authority
body check. A full native rerun on the current script then passes. Cleanup AST
controls use fake container operations: four four-case cohorts survive and four
faults fail. They check continued PostgreSQL cleanup after a REST failure,
refusal of foreign identities and retention of both failure diagnostics. These
controls make no actual Docker-failure or operational-recovery claim.

The three related documentation, direction and migration-order files pass 19
cases from the actual nested application directory. Source-binding records
match the restored worktree. The owned test services keep a one GiB limit and
zero swap. Source controls peak at 65 MiB; native runs peak near the limit,
without a recorded owned PostgreSQL OOM. This is not a capacity qualification.
Fresh GitHub CI remains required after publication. Diagnostic probes omit positive cohorts
and do not establish acceptance. Earlier failed trials remain in the private
proof directory and do not count as passing evidence.

## Limits and next work

SQLite uses its existing bounded transaction wait. A shorter HTTP stage deadline
can expire while that wait finishes. The handler checks the deadline before
output afterward; this is not a hard whole-request deadline guarantee.

No public DNS/TLS, hosted account, default worker, planner browser journey,
photogrammetry quality, map placement, practitioner, independent-host or V1
acceptance follows from these checks. The next integration work connects the
original worker coordinator, handles local failures without inventing engine
observations, and verifies complete callback and Storage recovery.

## Exact-head admission controller correction

The first318 worker CI stops because the older admission mutation controller
expects the previous server assignment line. The explicit adapter keeps that
assignment through `resolved_admissions`. The controller now targets that line
and still deliberately removes the actual runtime from the server. Four
30-case cohorts and45 faults pass on each of Python3.14 and3.11 with the
corrected anchor. Fresh exact-head CI remains required. No production behavior
changes in this correction.
