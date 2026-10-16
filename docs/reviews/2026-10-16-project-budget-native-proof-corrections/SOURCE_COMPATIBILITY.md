# R2 composes draft invoices before issuing them

This is a source correction to preparation, not a native result. Independent
review 02c7c6d6756dcafcb22f5aee91ff1a36cadb924d establishes PREP-1 against
original 7c075497. Its full REPORT, VALIDATION, evidence and text reader inform R2.
The original fixture remains blocked under that review. R2 neither rewrites nor
regrades that result.

## Retained source rules

The inspected source checkpoint is d0d12c406df8b8fd29bd2611a9cb29d8c3168ab8,
app44e638d6d79378042343bf5b18408f09ee991d57, observed at docs HEAD87b18feb.
The original frozen825 checkpoint and original source pins remain historical.
R2's explicit source-pins.json records each current file's match to d0d12.
The approved568555 review conservatively accepts the 8e classifier source. That
approval and root's later joined checks are external receipts, not runs here.
No source is imported into this worktree. No allocated/native identity exists.

Relevant source paths below are relative to openplan/supabase/migrations/.

| Source | Rule and consequence for this synthetic fixture |
|---|---|
| 20260727000010_receivable_invoicing.sql | Header status defaults to draft. Header workspace/client are required FKs; optional engagement/project/user links use their declared delete actions. Lines require an existing invoice, amount NUMERIC(14,2), nonnegative/non-null. Deliverable/milestone FKs allow null. Invoice numbers stay unique per workspace. |
| 20261017000005_money_integrity_corrections.sql:434–479 | Header UPDATE permits draft to sent/void and sent to paid/void. Issued financial identity stays immutable. Line INSERT/UPDATE/DELETE requires draft parent except narrow FK-clearing/cascade cases. The INSERT branch has no postgres/service bypass. |
| 20260911000002_contract_billing.sql:59–74 | Additional guards retain contract-attributed invoice identity and lines. R2 creates no engagement, contract source attribution or time-entry link. Native admission must establish those absences, not exercise a postgres exception. |
| 20260915000003_contract_closeout_relationships.sql:19–33 | Closed assignments refuse changing their source. New fixture invoices carry null engagement and new IDs. No closed contract is attached, altered or reopened. |
| 20260911000008_contract_source_deletions.sql | Updates/deletes may create retained cutoff history when relevant baselines exist. Fixture workspaces/projects have no contract baselines. Capture any actual trigger effects; do not assume count-only restoration. |
| 20260728000006_workspace_write_role_gate.sql | Restrictive parent policies require workspace_member_can_write in addition to permissive membership policies. Viewer is read-only. No grants or roles are fabricated. |
| 20260728000007_workspace_write_role_gate_children.sql | Restrictive line writes resolve the invoice's workspace through the parent. The same dual A/B ordinary writer must legitimately write both fixture workspaces. |
| 20260827000003_evidence_dependency_freshness.sql | Invoice INSERT/UPDATE touches project revision. Reconciled/status updates change that revision. Capture actual project row state after commit; no literal project-updated timestamp is assumed. |
| 20260313000012_project_subrecords.sql plus search-path corrections | Header/line update triggers set updated_at. The lifecycle guard permits that revision change. Deliverable updated_at and spend date ties remain their original explicit values. |

No inspected table trigger recomputes invoice totals from line rows. The retained
replace_client_invoice_lines function validates totals, but caps a replacement
payload at 200 lines and does not preserve explicit caller line IDs. R2 therefore
prepares direct synthetic table seeding under an admitted ordinary A/B writer,
with all lifecycle triggers active, explicit draft totals and final native
reconciliation still required. This does not claim the ordinary authoring API
can create the 1,202-line parent. Its API journey remains separate.

## Prepared ordering

For every ordinary and max-N parent, INSERT draft with zero header totals,
INSERT all its lines, then update matching draft headers to their literal line
sum and zero retention. Only after every line exists, update eligible parents
draft to sent, including sent_date. The odd-index paid subset then transitions
sent to paid, including paid_date. The sent subset stays sent. No issued line
is appended, edited or deleted.

The draft sentinel remains draft after its line and 900.00 header reconciliation.
The void sentinel receives its line and 900.00 totals while draft, then goes
draft to void. The foreign sentinel receives its line and totals while draft,
then goes draft to sent. Issued parent dates/financial fields are not rewritten.
No role changes, superuser bypass, session_replication_role, disabled trigger,
missing migration or altered retention rule appears in emitted SQL.

The final primary keys, original namespace, ordinary eligible counts and cents
remain the original literal oracles: 1201/1201/1201 sources, 2402 eligible lines,
1202 under one parent, 120100000 budget cents, 120100 direct cost/actual cents,
600500 billing cents, 999900 stated and 879800 remaining cents. Maximum-row
literal cent cases and per-row NUMERIC limits remain unchanged.

## Added foreign coverage and admission

The ordinary case adds one foreign deliverable, UUID5 ordinary/foreign-deliverable/0,
with budget777.77 and progress25, and one foreign spend, UUID5 ordinary/foreign-spend/0,
amount888.88 tied to that deliverable. Both belong to the existing foreign B
project and are individually caller-visible to the same dual A/B reader. They
must be excluded from the A-project RPC. Raw table fixtures now contain1202
spend and1202 deliverable rows, while each A-project result remains1201.
The exact IDs and excluded77777/88888 cents are in foreignExclusions. Draft/void/
foreign invoice exclusions remain unchanged. No foreign row is hidden merely
to make a missing project predicate appear safe.

Root must supply a NEW exclusive DB, exact installed history and retained trigger
catalog, ordinary authenticated seed writer with legitimate write membership in
A and B, owner/admin if exercising the authoring API, real table/column privileges
and helper ownership. The generator does not establish that context. If the writer
cannot see/write either workspace, stop as a fixture admission failure. Do not
substitute a service/postgres bypass, create grants, or weaken RLS. Seed writes
and later ordinary caller proof have separate identities and receipts.

The R2 reader checks emitted INSERT/UPDATE order and literals only. It recognizes
this emitter's narrow grammar and evaluates a bounded lifecycle model from the
inspected rules. It is neither PostgreSQL nor a migration replay, and cannot
establish trigger order, owner/security behavior, RLS, locks or capacity. Final
catalog/source/row receipts and all native stages remain required.
