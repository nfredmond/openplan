# Reconcile a planning contract

Open a project and its Planning contracts panel, or use Invoices & Reimbursements,
Client receivables, then Manage contract. A contract or task order remains an
engagement. Its internal tasks belong to its approved baseline.

## Establish the agreement

Upload the source agreement to Documents. An owner or administrator proposes a
baseline with scope, fee basis, internal cost and hours, tasks, staff allocations,
deliverables and agreed deadlines. Empty amounts mean unknown. A proposed
amendment leaves the approved budget unchanged. Record the responsible person's
approval evidence to approve the current proposal. Prior versions, document
checksums and retained agreement files remain immutable.

A confirmed gross-fee ceiling consumes gross issued billing before retention.
Unresolved terms stay unassessed. Rates for internal cost and client billing are
separate, effective-dated records. Their source references are required. Rates
cannot be retrospectively overwritten or silently carried across currencies.

## Enter and reconcile work

Link staff to their workspace accounts from the client-receivables staff register.
Members enter and correct their own draft time in the contract page. Owners and
administrators review valuations and allocations. Approval locks member edits;
later owner corrections retain earlier amounts, hours and source identity.
Private valuations, approval notes and management reports remain inaccessible to
members. Members see their original input and its current review state.

Enter manual sources, preview a mapped CSV, or retain a documented opening
balance. CSV intake accepts up to 200 rows per file. Stable source keys prevent
repeat imports. Task and staff columns accept a unique exact name or an ID;
ambiguous names fail. Download the original CSV from the intake panel. Imports
remain drafts until reviewed. Source allocation shares total 10,000 basis points,
equal to 100 percent, with rounding cents retained in the final allocation.

Use the existing source identity when mapping time, spending or OWP valuations.
Choose an unmapped time/spending entry or a current OWP valuation from the source lists. Advanced fields also accept retained IDs.
Shared OWP sources must use the current matching valuation in the same documented
currency. Correct the shared source in OWP first, then reconcile the contract
version. The physical source contributes once. New payroll on a staff/date that
already has other time needs explicit overlap reconciliation before approval.
Opening balances require coverage dates and their documented accounting basis;
possible overlap remains unresolved until its reconciliation is recorded.

Incurred cost, future commitments, gross billing, retention, documented payments
and credits have distinct totals. Billing an expense creates no second cost.
The project's older budget panel shows direct spending-ledger amounts only;
reviewed contract labor and cost belong in contract management. No approval or
accounting meaning is inferred for legacy rows.

Prepare invoices from reviewed billable sources, then review and mark them sent
in the existing register. Each split retains its task, deliverable, source and
rate attribution. Source-attributed invoice history cannot be edited into another
meaning. Record documented payments and gross-fee credits as separate sources.
They do not rewrite the legacy invoice's net receivable or its paid status.
The legacy receivable register continues its existing whole-invoice payment
calculation; contract management carries documented partial cash events.

## Review remaining work and issue a snapshot

Record remaining hours and internal cost for each task, with an estimate date and
basis. Include commitments within that estimate where appropriate; do not add the
same future work twice. Progress is an independent judgment. Agreed deadlines do
not become forecast finish dates based on expenditure.

An owner or administrator can issue an immutable dated management snapshot.
Actual-plus-remaining cost is available only when coverage is explicitly attested,
every task has a complete estimate, and no known draft, unvalued, unmapped or
unreconciled source remains. A historical cutoff affected by changed, moved or
deleted legacy sources is refused instead of reconstructing missing history.
Issue a current cutoff after reconciliation. Issued snapshots are never rewritten.

Prepare PDF or XLSX in the snapshot panel. The existing Documents worker renders
and retains the files. Refresh status and download. Failed preparation retries
the same job and document; stale worker leases cannot finalize them. A browser
save with an unknown outcome retains its exact request for retry, including after
reload. Browser storage must be available for that recovery.

This is internal planning management. It does not establish accounting revenue,
claim eligibility, external authority, funder forms, resource scheduling, forecast
finish dates, contract closeout or practitioner usefulness. M11 and the full v1
contract remain open.


## Development candidate: reviewed delivery calculations

Apply the unreleased migrations named in CHANGELOG before using this candidate.
From `openplan/`, run `npm run worker:contract-calculations` with this deployment's
local `.env.local`. It uses the same Supabase configuration as the app and needs
no paid provider. The existing `worker:document-exports` remains responsible for
PDF/XLSX documents. Keep these workers pointed at the intended database.

Forecasts, response comparisons, accounting imports and closeout submissions
return a durable job identity and HTTP 202. The management page polls scoped
metadata and reloads retained results after completion. Queued is not saved.
The worker runs calculations in a child process while its parent renews a
two-minute lease every 20 seconds. A terminated attempt is reclaimed after lease
expiry; the job and contract decision commit in one database transaction.
Explicitly failed jobs can be retried by their still-authorized requester. A
changed source or approval payload requires a new review, never silent rebasing.
Original accounting rows and private closeout payloads are excluded from the
metadata endpoint and authenticated table reads.

The browser still computes an optional preview locally. It is bounded to a
730-day horizon; large preview responsiveness remains an acceptance check.
Human agency PM and finance acceptance, reminders for contract work, final
mobile/artifact/recovery journeys and complete M11 acceptance remain open.
