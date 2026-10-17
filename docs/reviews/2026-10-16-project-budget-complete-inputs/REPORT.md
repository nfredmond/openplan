# Project budget complete-inputs source candidate

October 16, 2026. This bounded repair addresses the source-established input
completeness part of KL-2026-09-04-023 in existing M11/A3. It does not close M11,
A3, native financial acceptance, or v1. The roadmap remains the sole queue.

## Source and ownership

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-2dcbde6f`,
current branch `t3/project-budget-complete-inputs`. Initial inspection reports
`t3/2dcbde6f`; the reflog records its rename before the fast-forward. This lane
issues no branch-rename command. It started clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwarded locally, without a
fetch, to `f8a571bb0a18b8b6501870acb5ef1e760d487e1c`, also verified at the supplied
`t3-e04f0f77` checkout. The base app tree is
`d577a9cd955018b3253f42b3d9af2a96a9a10b53`.
The verified implementation checkpoint is
`3ff0474afe89465ed33a1d163364b2c2d51ca334`, with app tree
`c499b7089021bb4d131319828f4e56740ce794b6`. The following identity correction
changes this report only. Both checkpoints remain local.

Ownership covers `budget-queries.ts`, the source-identity fields in `budget.ts`,
the financial panel and its page wiring, their focused tests/transport fixtures,
new migration `20261017000019_project_budget_complete_inputs.sql`, and this new
review directory. The private evidence directory is
`/home/nathaniel/.local/state/openplan/project-budget-complete-inputs-20261016`,
mode 0700. No root source/preview, frozen607, A0/native/bootstrap work, old
migration, roadmap, changelog, requirement ledger or known-issues record changes.
Migration 18 remains owned by A0. No services, build, database allocation, native
SQL, browser, provider/account operation, dependency install, push, PR, merge,
tag or release runs here. There are no nested agents.

The product direction check exits zero at the base with its existing jurisdiction,
capability, release-version and intervening-change reminders. This candidate uses
the V1 contract, existing M11/A3, the capability matrix's financial basis limits,
CORE-PM-01, the current direction review, the source-established issue, and the
architecture's shared source and caller-permission requirements. It adds no
module, milestone or accounting basis.

## Complete sources share one snapshot

The old loader independently caps deliverables at 200, spend entries at 500 and
sent/paid client invoices at 200. Its embedded line relation has no independent
completeness proof under backend limits. Sorting by mutable dates and paging
those separate reads cannot establish a coherent financial snapshot.

The new `project_budget_inputs_v1(uuid)` returns one scalar JSONB object. SQL
aggregates the caller-visible deliverables, stated project budget, spend rows,
invoices and every nested line before the API applies a result-row cap. The
function is `STABLE`, `SECURITY INVOKER`, and contains SELECTs only. It binds the
project argument, uses schema-qualified relations and a fixed search path, and
revokes PUBLIC/anon execution while granting authenticated execution. It changes
no table policy or grant. Inaccessible and nonexistent projects both refuse.
A visible eligible invoice with a mismatched project workspace makes its lane
unreadable instead of silently removing that invoice from totals.

PostgreSQL documents that all commands in a STABLE function share the calling
query's snapshot. This avoids movement, insertion, deletion, invoice-status and
line-amount hazards across independent requests. It is a design basis, not a
native concurrency result. See [PostgreSQL volatility](https://www.postgresql.org/docs/current/xfunc-volatility.html),
[function security](https://www.postgresql.org/docs/current/sql-createfunction.html)
and [Supabase function guidance](https://supabase.com/docs/guides/database/functions).
This candidate follows existing repository STABLE JSON snapshot patterns while
retaining caller RLS rather than adding a definer bypass.

Deliverable display order remains updated date descending, with a primary-key
tie-breaker. Spend order remains entry date descending, also with an id
tie-breaker. Invoice and nested-line arrays use primary-key order. No row limit,
mutable offset, deduplication by amount or separate continuation request exists.
Successful lanes carry `complete: true`; failed lanes return null data and the
original SQLSTATE/message. Errors cannot publish partially accumulated arrays.

The server preserves the full, budget-only and legacy deliverable projection
ladder. Missing assignee columns do not discard budgets. Missing budget columns
retain the legacy list and disclose the missing basis. The existing shared
pending-schema classifier still distinguishes missing relations/columns from
permission and ordinary read failures. A missing new RPC marks the snapshot
migration pending; it never falls back to the old capped loader. Deployment must
apply migration 19 before the dependent application code.

The loader validates the response version, project binding, complete/error/data
shape, required projected fields, monetary shapes and distinct primary keys.
It preserves invoice and line identity when flattening billing. Malformed,
wrong-project, repeated-identity, rejected transport and ordinary RPC failures
return unavailable flags. Repeated source IDs cause refusal, not silent monetary
deduction. The project page withholds panel totals and delivery pace when any
required financial lane is pending or unreadable. Missing assignee alone does
not suppress financial data. The financial panel preserves migration disclosures
and withholds empty-input zeroes, missing-budget claims and pace judgments.

## Accounting evidence and remaining limits

Current `budget.ts` already assigns `actualToDate = spendToDate` in both the
deliverable and project calculations at the base. Client billing is a separate
measure. The old mixed-cost lead in KL-023 is superseded for this consumer;
there is no reproduced spend-plus-client-billing double count here. This repair
changes no formula. The equal-valued distinct-source regression keeps two $1
spend rows and two $1 invoice lines, reports $2 direct cost and $2 client billing,
and does not combine them or deduct one from the other.

The source has separate spend row, invoice and line primary keys. Time entries
also have `billed_line_item_id`. The contract reconciliation code separately uses
`time_entry_id`, `spend_entry_id` or `sourceKey` and refuses repeated physical
sources. None of those facts authorizes inferring a shared physical cost merely
because a project spend amount equals an invoice-line amount. This candidate
preserves identifiers and the existing internal-cost/client-billing/cash/funder-
reimbursement distinctions. It does not invent a cross-register allocation or
expand the project spending measure to labor or cash.

Existing budget math still excludes billed lines attributed to an unknown
project deliverable and reports that condition in attention text. All project
spend rows still count at project level even if deliverable attribution is
missing or stale. These are existing semantics, not new accounting decisions.
The six-row delivery-board display window remains, while budget math sees the
complete source. Other independently capped registers and portfolio loaders
are outside this repair. No financial export consumer uses this loader today;
this candidate makes no new export-completeness claim.

## Checks and evidence limits

`VALIDATION.md` records terminal results, targeted faults, exact restoration and
command/resource settings. SQL checks inspect executable source text; they do
not parse or execute PostgreSQL. RPC tests use explicitly synthetic envelopes;
they prove the loader and math over complete supplied input, not server-side
aggregation, backend cap behavior, RLS or concurrency. DOM tests prove conditional
rendering and page wiring, not a browser journey or financial usefulness.
[NATIVE_PREPARATION.md](NATIVE_PREPARATION.md) holds the unexecuted native,
rollback and concurrency protocol. Every unrun boundary stays open.

The scalar response still has finite database memory, HTTP size, timeout and
client rendering capacity. Capacity failures must stay unavailable. Custom RLS
can intentionally hide rows, so completeness means the full source visible under
the caller's policies. The current named read policies cover workspace members;
this source inspection does not verify a live installation's grants or policies.

## Dependency and cache custody incident

The permitted donor is reused through an owned local `node_modules` symlink;
there is no install. Its full lockfile differs from the base lockfile. The ten
checked relevant installed package versions match this checkout's lockfile,
including Vitest 4.1.11, Vite 7.3.6, TypeScript 5.9.3, ESLint 9.39.3, Zod 4.4.3
and Supabase JS 2.110.7. The private dependency manifests preserve exact hashes
and all checked versions. The Node runtime is v24.22.0.

The first npm invocation uses private npm cache/log paths with notifier, audit
and funding requests disabled. However, the first two Vitest runs did not set
Vite's cacheDir. They wrote the donor's
`.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`.
That violates the requested cache isolation. The observed write time is
2026-10-16 11:20:06.344992322 PDT. Original bytes before these runs are unknown.
No donor cache is deleted, replaced or claimed restored. The private incident
record preserves observed size, hash, time and corrective steps. An owned waiting
rerun is canceled before dispatch; no other session is stopped.

Later checks use a private copy of the canonical Vitest configuration with an
explicit private Vite cacheDir, unchanged test options and alias, and the runner
config loader. The first private-config attempt fails on canonical `__dirname`
under runner mode. The next fails because an absolute plugin import is treated
as source and Vite cannot resolve `vite/internal`. The corrected private copy
replaces `__dirname` with the assigned app path and resolves package imports
through a private dependency symlink. These configuration failures remain in
private logs and are not counted as killed mutations or test failures in source.
No repository configuration or donor dependency files change to resolve them.

## Exact parent-join notes

Do not mark KL-2026-09-04-023 closed from this source candidate. Suggested dated
known-issue note after parent review: “The October 16 source candidate replaces
Projects budget caps and embedded API line reads with a caller-RLS STABLE scalar
snapshot, validates complete input identity, and withholds financial totals and
pace when unavailable. Native aggregation/API-cap/RLS/concurrency and identified-
build browser/artifact reconciliation remain unproved. Current project actuals
already use direct spend only; the old billing-plus-spend lead does not describe
this consumer.”

Suggested roadmap M11/A3 evidence note: “Bounded source repair for reliable
Projects budget reading, with above-cap supplied-input tests and fault controls.
Migration 19 remains unapplied in this lane. No milestone status changes.”

Suggested CORE-PM-01 note: “Projects' direct-spend/client-billing inputs have a
complete-snapshot source candidate. Financial basis formulas stay unchanged;
native caller-role and coherent-snapshot acceptance and practicing-finance
reconstruction remain outstanding.”

Suggested future changelog entry, only when the parent lands an eligible
increment: “Projects budget reading uses a complete scoped financial snapshot
and withholds totals when required inputs cannot be read.” Align any release
version and migration rollout under the parent release process. This local
candidate neither selects a release number nor authorizes a deployment.
