# Engagement invoice-summary completeness candidate

October 16, 2026. Implementation lane within ROADMAP M11 and CORE-PM-01.

## Source boundary and ownership

The isolated checkout is `t3-80bd5760`, branch
`t3/engagement-summary-invoice-completeness`. It starts clean at `05dd3e8da`
and advances by local fast-forward to
`95f46dc506b85e83bcbf84146f6cf8dafa4c5a65`, application tree
`3e85cdc3916a81260bebc96c86ced4fd2c76b168`. The root combined checkout stays
frozen and read-only. Root owns independent review and any later join.

This candidate owns the new engagement-summary reader and SQL20; the
receivables position composer; the client-invoice POST route and composer;
the receivables lane and NTE bar; shared invoice PDF/evidence assembly and
HTML context; two new completeness/caller test files; direct route/PDF fixture
adaptations and composer disclosure cases; this review folder and the
Unreleased changelog entry. Shared money/formatting, SQL19, project budget
readers and prior proof files remain unchanged.

## Actual caller findings

`ReceivablesLane` reads workspace invoices with the full existing projection,
orders by `created_at DESC` and limits the register to 500. Its cap notice
remains. Previously the engagement helper consumed this same register.
The API GET register also has an explicit 500 cap and `hasMore`; it is not the
POST warning source. The POST warning independently selects invoice id,
status, engagement id, gross subtotal, retention percent/amount and total,
filtered only by engagement id. It requests no count or completeness marker.

`resolveInvoicePdfBytes` previously uses the same invoice projection and
engagement-id filter when a legacy ceiling is entered. It requests no count
or completeness marker. The shared resolver serves the standalone invoice
PDF route and `invoiceBytes` in project evidence assembly. Neither the POST
warning nor PDF query has an explicit source cap. Their actual SDK maximum
and any native truncation are unestablished here.

The retained helper correctly computes exact gross sent/paid subtotals,
separate draft subtotals and legacy numerical ceiling comparison for supplied
rows. Correct arithmetic does not establish complete retrieval.

## Smallest coherent implementation

SQL20 adds `engagement_billed_summaries_v1(workspace, engagement, excluded_invoice)`.
It returns one JSON scalar and aggregates inside PostgreSQL before API row-set
limits. STABLE supplies statement snapshot intent. SECURITY INVOKER retains
underlying SELECT privileges and RLS. Explicit caller membership, workspace
and optional engagement filters refuse an unavailable scope. Anonymous and
service execution are revoked; authenticated callers receive EXECUTE. The
migration changes no table grant, policy, trigger or existing function.

The inspected 422-file source history includes the original receivable tables,
NUMERIC(14,2) gross subtotal and ceiling columns, membership SELECT policies,
later write-role restrictions, grant restoration/revocation history, contract
commands and SQL19. Contract PM/finance/consultant grants do not replace the
workspace membership required by these current callers. Existing engagement
and workspace indexes support the predicates. Native installed roles, ACLs,
policies, cost and results remain unproved.

Aggregates, invalid/missing contributor counts and ceilings travel as text.
The reader validates unknown DTOs, scope echoes and unique engagement identity.
It composes the existing public number|string position from aggregate buckets,
without synthetic invoice records or a new money framework. A source-invalid
bucket does not erase a readable peer. Missing, malformed, entered zero and
an absent ceiling remain distinct. SQL catches no permission/internal errors;
the SDK error retains its original code/message. A missing exact public RPC
can be pending; dependency, permission, incomplete or malformed responses stay
unavailable. An incomplete envelope retains its original error.

Dashboard totals use a separate complete workspace snapshot, while the register
stays capped. The POST warning reads before insertion and supplies no excluded
id because the new invoice does not exist. Projected gross adds the new amount
once. The optional excluded-id argument supports an explicit prior-position
read and is echoed/validated. The PDF uses no excluded id: its recorded position
includes the current invoice according to its actual status. This does not
implement a concurrent-creation gate or whole-PDF transaction snapshot.

Failures leave gross totals, remaining and comparison unknown. The API audits
the original error and returns source state while preserving authorized
warn-only creation. The composer, NTE bar and PDF disclose pending/unavailable
positions. Actual invoice currency remains separate. Aggregate currency,
legacy ceiling currency, cross-invoice currency agreement and agreement terms
remain unassessed. Gross fee consumption, retention, net receivable and cash
are distinct.

## Reuse and validation boundary

The implementation reuses the existing scalar SQL19 snapshot pattern, Zod DTO
validation, exact-cent money primitives, display/context corrections, source
roles and indexes. PostgreSQL's existing SUM/JSON primitives fit this bounded
operation; no new OSS dependency or module is needed. No network research,
dependency, direction, test, compiler, manager, lock or probe runs before a
single finite root grant. Supabase/Postgres skills supply source guidance only.

Prepared tests include finite 501/1201 supplied contributors, exact aggregate
text beyond safe integer cents, bucket-local failures, zero/absence, explicit
scope/excluded id, complete/incomplete/missing/failed boundaries, actual caller
RPC arguments and list projections, audit/warn-only behavior and SQL source
intent. Mocked scalar fixtures do not execute PostgreSQL aggregates or prove
actual SDK serialization. SQL text guards cannot establish installed semantics,
RLS, runtime cost, concurrency or recovery. UI state and HTML do not establish
native PDF or browser usability. The single granted trial ends at terminal zero.
Baseline46, harmless46 SURVIVED, all 16 targeted faults and restored46 execute.
Focused types, lint and direction exit zero. The direction check retains its
existing review reminders. See [validation](VALIDATION.md),
[saved summary](evidence.json) and [exact failures](fault-observations.json).

## Migration and later native prerequisites

SQL20 is ordinal 423 only in this new source candidate. SQL16/17/18/19 remain
419/420/421/422. SQL20 is not installed or released. Existing budget controller
binding at app `44e638d6d79378042343bf5b18408f09ee991d57` and 422 source files
does not silently advance. A future native packet must bind the exact final
donor, all 423 migration bytes and installed history separately.

Native preparation must cover each real caller as owner/admin/member/viewer,
foreign member, nonmember and anon; direct scalar SDK and HTTP with raw payloads;
RLS-hidden/nonexistent scopes; permission/internal errors; an absent SQL20;
legacy schema behavior; 501/1201 rows, exact legal NUMERIC(14,2) inputs and
above-safe-cent aggregates; status transitions and stable snapshot behavior;
current-invoice inclusion/exclusion without duplicates; missing/invalid source
semantics; and 422-to-423 upgrade/restore with retained data and exact history.
Per-caller native results, whole-artifact consistency and source cost remain
separate. No native target is allocated here. Proposed budget target stays
UNALLOCATED, A0 R6 OID 6227945 is PROTECTED and failed R5 OID 6212363 fenced.

Full M11, reconciliation/source identity, contractual hard gates, forecasts,
practitioner usefulness, scientific validation and complete V1 remain open.
All states and DC, California depth, territories, Tribal and overlapping
authority, free independent installation, portability and human money authority
remain binding. No build, service, browser, provider, hosted operation, spending,
admission, main update, source join, push, PR or release is authorized here.
