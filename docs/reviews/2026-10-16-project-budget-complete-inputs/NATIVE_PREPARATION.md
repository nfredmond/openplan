# Native validation remains unexecuted

This packet prepares checks for KL-2026-09-04-023 under existing M11/A3.
No database, Docker stack, SQL session, browser or provider account runs in this
implementation lane. Migration 20261017000019 is a candidate only. Migration
20261017000018 belongs to A0 and is unchanged.

## Scope and prerequisites

Use a separately authorized disposable installation with migration 19 applied
in its real migration order. Record the installation identity, migration list,
Postgres/PostgREST versions, configured API row limit, caller JWT and source
commit without storing credentials. Preserve before/after inventories. Use only
synthetic workspaces and users. Do not target the shared demo, root preview,
frozen607 or the hosted installation. The ordinary authenticated RPC, rather
than a privileged direct SELECT, is the acceptance path.

## Above-cap rollback fixture

Prepare a transaction containing a synthetic project in workspace A, with a
stated budget of $9,999.00. Insert 1,201 deliverables at $1,000.00 each and 50
percent complete, with identical updated timestamps to exercise id tie-breakers.
Insert one $1.00 spend row for each deliverable, also sharing an entry date.
Insert 1,201 client invoices in sent/paid status, each with a distinct $2.00
line assigned to the matching deliverable. Add 1,201 further distinct $3.00
lines to the first invoice, all assigned to the last deliverable. Include draft
and void invoices with sentinel amounts. Retain exact source primary keys.

Expected independent totals are 1,201 deliverables, 1,201 spend rows, 1,201
eligible invoices and 2,402 eligible lines. Deliverable budgets total
$1,201,000.00. Direct spend and actual cost each total $1,201.00. Client billing
totals $6,005.00. Remaining against the stated budget is $8,798.00. The last
deliverable has $3,605.00 billed and $1.00 direct spend. Equal amounts on distinct
identities count separately. Billing does not increase incurred cost.

The transaction-local fixture can exercise the function directly under
`SET LOCAL ROLE authenticated` with a synthetic user's JWT claims, then roll
back. It cannot prove the HTTP row-cap boundary, because another API connection
cannot see uncommitted seeds. For HTTP validation, commit the synthetic fixture
only in a disposable clone, call the RPC through PostgREST with an API cap of
at most 1,000, and dispose of that clone after preserving receipts. Do not call
a transaction-local function probe API acceptance.

Independently reconstruct all counts and monetary sums with authenticated SQL
and compare the RPC JSON identities and amounts, then feed that JSON through the
real loader and budget builder. Compare the resulting financial panel and any
claimed exports separately. No export path changes in this candidate.

## Caller roles and failure states

Exercise owner, admin, member and viewer in workspace A, a user only in workspace
B, a user belonging to both, a revoked A member and anon. Match actual grants
and RLS. A nonexistent or inaccessible project must refuse without returning a
zero budget. Confirm function EXECUTE is revoked from PUBLIC and anon. Confirm
that no service-role path is needed. A visible eligible invoice whose workspace differs from its linked project
must make the invoice lane unreadable. It must not silently disappear from totals.
Confirm that case using the dual-workspace user.

Retain tests for denied table/column reads, a missing RPC, a missing spend table,
a missing project-budget column, missing assignee only, and both missing budget
and assignee columns. These destructive schema probes belong in rolled-back
transactions on the disposable target only. Never alter the working stack.
Verify that a missing assignee retains budget data, missing budgets retain the
legacy deliverable list, and ordinary read failures remain unreadable rather
than pending. Confirm zero financial numbers and pace verdicts are withheld
when any required financial lane is unavailable. A successful empty source must
still produce an honest zero. Query cancellation and transport failure must
refuse rather than accept partial data.

## Concurrent mutation fixture

Use two independently controlled sessions on a disposable committed fixture.
Record transaction IDs, snapshot/lock observations, start/finish times and exact
returned JSON. Run the production STABLE RPC while the writer commits an atomic
change to project budget, deliverable budget/progress, spend amount, invoice
status and invoice-line amounts. A deterministic probe can hold an ACCESS
EXCLUSIVE lock on the invoice table after the writer changes the earlier
sources, start the RPC, establish that its backend is waiting at the invoice
read, then commit the writer. Do not add a sleep or hook to the production
function. Investigate lock acquisition/plan behavior if that interleaving cannot
be established, rather than claiming concurrency from uncontrolled timing.

For every observed interleaving, the response must contain the entire old state
or the entire committed new state, never mixed financial bases. Separately
exercise insertion, deletion, invoice voiding and deliverable timestamp changes
around the RPC. Preserve failed attempts. A later RPC may correctly see a newer
state; there is no cross-request historical snapshot promise.

## Rollback and performance

Preserve pre/post relation, function/grant and source-row inventories for every
transactional probe. Roll back temporary schema mutations and verify exact
restoration before admitting the next case. Migration rollback first deploys a
compatible application, then removes only this function if required. Do not
remove source tables, financial rows or migration history. Test that recovery
separately; this document is not a verified restore recipe.

Measure HTTP response size, latency, database memory and client rendering on the
above-cap and larger real-size synthetic cases. The scalar aggregate avoids
PostgREST row limits but still has finite query, response and memory capacity.
A capacity/timeout failure must stay unavailable. This candidate does not prove
unlimited scale, installation recovery, native RLS, browser usability or human
finance acceptance.
