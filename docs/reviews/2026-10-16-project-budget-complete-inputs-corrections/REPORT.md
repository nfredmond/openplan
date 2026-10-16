# Project budget source corrections after independent review

October 16, 2026. This implements the four P2 findings in independent review
`1dd66a5edc1c64ebda67537e7bc3e08b535ffa94`. It is a source correction candidate.
Fresh independent review remains required before integration or native admission.
No KL-2026-09-04-023, M11, A3, capability or v1 outcome is accepted here.

## Identity and ownership

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-2dcbde6f`,
branch `t3/project-budget-complete-inputs`. It starts clean at
`516ab4bc7551cf4cc4338e5f508571797722edc6`, app tree
`c499b7089021bb4d131319828f4e56740ce794b6`. The correction reads the independent
REPORT, VALIDATION, NATIVE_REVIEW and the reviewer's actual private probes.
The corrected candidate app tree is
`ef1674c66de60487c15c54a52b2e8e2f4e71d22e`. Their original files remain unchanged. The original 516 reports, private proof,
31 faults, cache incidents and failed trials remain preserved.

Ownership covers SQL19, budget-queries.ts, delivery-board read prefills and its
row type, the existing query/SQL/page tests, the transport fixture, a new focused
correction test, and this new review directory. The page's calculated-summary
availability condition remains unchanged. Its board now reads edit values from
the deliverable row rather than that calculated map. This is the narrowly
necessary consumer change; no write route, form touched-field logic, membership
authorization, accounting formula, existing action or module changes.

New private evidence lives at
`/home/nathaniel/.local/state/openplan/project-budget-complete-inputs-corrections-20261016`,
mode 0700. The local commit/app identity and all candidate file hashes appear in
its handoff manifest. No frozen607, root preview/source, A0/native/bootstrap,
roadmap, changelog, ledger or old migration changes. SQL19 remains unapplied.
No push, PR, integration merge, release, native DB/SQL, Docker, browser,
application service, network, provider/account, install, build, whole suite or
nested agent runs in this lane. Transient check units enforce the requested
resource bounds; they are not application services.

The direction check exits zero with the existing reminders. It changes no
product authority, review date or milestone. The prior V1 contract, sole roadmap,
CORE-PM-01 and financial source/meaning limits continue to govern this work.

## P2-1: Required amounts cannot enter arithmetic as absent or nonfinite

Spend and invoice-line amounts now use a required validator. Optional project
and deliverable budgets use its nullable form. The loader admits finite,
nonnegative per-row values within NUMERIC(14,2), at most 999999999999.99 and two
decimal places. Supported strings contain one to twelve unsigned integer digits
and an optional one- or two-digit fraction. It does not accept exponents, signs,
whitespace, empty/malformed strings or excessive serialized digits as strings.
Numeric JSON values use the same finite/range/two-decimal checks. Honest numeric
and string zero, one cent, ordinary decimals and the maximum remain supported.
Null optional budgets remain unknown, distinct from zero. Progress has a separate
nullable 0–100 boundary, within its source's supported decimal precision.

Null required amounts, a 400-digit string, nonfinite values, negatives, malformed
strings and unsupported range/precision cannot reach the budget builder as a
successful source. An invalid spend or invoice lane becomes unreadable with null
data and an explicit invalid-source failure. Readable deliverables remain
available for edit prefills. An invalid outer protocol identity/version still
refuses the snapshot. The page continues withholding all calculated financial
money and pace whenever any required source is unavailable. There is no empty
readable fallback and no amount-based deduction.

This is a per-row transport boundary. It does not change budget.ts, introduce
negative refunds, change the underlying SQL constraints or establish aggregate
cent precision. The unchanged JavaScript accumulation still needs a separately
bounded numeric method and independent aggregate-cent reconstruction before
that stronger claim. Passing maximum-per-row cases is not aggregate evidence.

## P2-2: Missing RPC guidance names the actual public function

Whole-RPC failure classification now requires a supported code and a recognized,
anchored missing-function message identifying the public snapshot RPC. It
accepts the named PostgreSQL UUID signature and the named PostgREST cache form,
including supported exact quoted identifiers and named parameter forms.
Unqualified names, other schemas/functions, different quoted case, unsupported
signatures, unnamed cache errors and ordinary failures stay unreadable. A bare
42883 or PGRST202 no longer establishes that this migration is missing.

The original message is retained in readFailures for unrecognized/dependency
failures. The known missing public RPC remains pending without capped table-read
fallback. The classifier is deliberately bounded. Unsupported/localized wording
remains an error rather than invented migration guidance. It changes no shared
global pending-schema helper or unrelated consumer.

## P2-3: Optional-column flags follow catalog facts independently

The deliverable SELECT no longer catches an arbitrary undefined column and
assumes the assignee is missing. It checks the target relation and then inspects
its pg_catalog.pg_attribute entries, requiring a positive attribute number and
excluding dropped attributes. Separate booleans track assignee_user_id,
budget_amount and percent_complete. The budget-group pending flag is the OR of
the two budget-field absences.

The fixed projection starts with the existing legacy columns and independently
appends each present optional column. Existing nonnull assignees survive missing
budgets; budgets survive a missing assignee. A single missing budget field does
not discard the other present field. Both groups absent produce truthful flags.
The aggregate still reads the full scoped source with deterministic id ties.
A missing deliverable table remains a distinct known pending relation.

An unrelated undefined-column/relation/function read failure is not reinterpreted
as an optional-column gap. The SQL ordinary-error handler retains the SQLSTATE
and message. The loader only recognizes this deliverable relation's known
missing-table form as pending; policy/helper failures remain unreadable and
retain their original message. Other lanes retain their existing source-schema
classification. Catalog-selected source checks and transport fixtures do not
execute this SQL or establish actual partial-schema behavior. That remains
explicit native preparation.

## P2-4: Readable edit values do not depend on calculated pace

The delivery board now prefills budget and progress from its readable deliverable
fields, using the existing optional-number reader. Its row type carries those
optional values. The page still suppresses the calculated-summary map when any
required financial input is unavailable, so pace and monetary summary chips stay
withheld. Edit prefills no longer depend on whether that map exists.

The real page/board/form regression checks budget 1000 and recorded progress zero
under both an ordinary spend read failure and an invalid required spend amount.
A paired readable-source case checks different nonzero values, 1250.25 and 12.5,
with the expected pace. The unchanged control tests continue covering status-only
and touched-field-only payloads. No control, role, route or write permission is
added. DOM role/prop tests do not establish native authorization or a browser
journey. The preexisting spend-only chip labelled “Billed + spend” remains a
separate retained copy mismatch, not a formula or a resolved presentation claim.

## Accepted design and evidence limits

The scalar JSONB, STABLE, SECURITY INVOKER, SELECT-only function design remains.
It aggregates all caller-visible rows and nested invoice lines before API row
limits. Project binding, RLS, schema-qualified relations, fixed search path,
transactional PUBLIC/anon revoke and authenticated grant remain. No new
service-role client or bypass appears. Existing/default direct grants, owner and
service_role ACLs still require native inventory; this is not a claim of an
exclusive authenticated ACL.

Stable identities, repeated-primary-key refusal, equal-valued distinct rows,
source order and full-source/no-offset/no-cap behavior remain covered by focused
regressions. Actual cost still equals direct spend in both budget calculations.
Client billing, internal cost, cash and funder reimbursement remain separate.
The original unknown-deliverable billing attribution and project spend semantics
remain. Other registers, exports and aggregate numerical precision do not gain
acceptance from this correction.

VALIDATION.md records terminal checks, retained failed fault trials, exact source
restoration, original-custody and donor observations. NATIVE_PREPARATION.md adds
all seven requested protocol cases and form/auth checks from the independent
native review, without running them. Replays of the reviewer's probes are author
checks, not the fresh independent review required for the next stage.

## Isolation and parent handoff

Every dependency command, starting with the first one, runs through the new
literal bwrap recipe under the shared compiler flock and bounded check unit.
Mount order is read-only host root, writable assigned checkout, writable NEW
private directory, then an explicit final read-only donor mount. Networking is
unshared. HOME, temporary directories, XDG and npm configuration/cache/log paths
and Vite cacheDir are private. The donor's kernel read-only flag is observed
without attempting a write. No donor permissions, host mounts, donor caches or prior proof files change to
make checks run.
The earlier cache incident's original bytes remain unknown and are not restored
or rewritten here.

Return this source correction for a NEW independent review round with the
original brief, 516 candidate, review 1dd66a5, all four findings, the corrections,
actual check receipts, failed trials and remaining native objections. Do not
reuse the first review as acceptance of changed source. Integration and native
admission remain held. No roadmap/ledger/known-issue status change is requested
from author tests alone.
