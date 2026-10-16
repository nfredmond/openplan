# A finite prerequisite builder, with native admission still absent

October 16, 2026. This packet prepares nine synthetic actors and their caller
contracts inside existing M11/CORE-PM-01. It creates no product module or queue.
The full v1 contract, all jurisdictions, practitioner acceptance and separate
AequilibraE/ActivitySim scientific requirements remain binding.

## The source and proposed data are fixed

The assigned checkout is t3-46ffa082, branch
`t3/budget-native-caller-builder-prep`. It starts clean at 05dd3e8 and takes the
expressly authorized local fast-forward to documentation root
`da3d95304e36e539af154aeff610d2909b29e119`. Both that root and source
`d0d12c406df8b8fd29bd2611a9cb29d8c3168ab8` have application tree
`44e638d6d79378042343bf5b18408f09ee991d57`. No upcoming M11 fee source is bound.
SQL19 remains candidate SHA256
`ed2784b2b1623eb34340480d84dc72e5ce8d226c70532a5062495a1565df181d`.

`ordered-source-history.sha256` records the actual 422 source migration files
in lexical version order. SQL15 is ordinal 418, SQL16 is 419, SQL17 is 420,
SQL18 is 421 and SQL19 is 422. This is source inventory, not installed history.
The retained 419 archive ends at SQL16. Its exact installation and subsequent
17→18→19 sequence require a separately reviewed native body/history runner.
SQL19's own BEGIN/COMMIT must not escape a purported surrounding transaction.
This packet supplies no migration runner or fabricated history row.

`relevant-source.sha256` pins the base workspace tables, latest named signup
body/trigger, own-membership SELECT policy, viewer roles, owner-floor, direct
and child writer restrictions, time-zone trigger, cutoff history and search-path
changes, SQL19 and the old fixture reference. The old native_proof.py fixtures
are read as source patterns only. No old helper, emitter or proof is imported,
invoked, changed or copied into executable inputs.

`manifest.json` proposes `openplan_budget_native_9c47bd610f2a49e8a35c706d` and
fresh UUIDs. Its status is **UNALLOCATED_NOT_AVAILABLE_UNADMITTED**. This is
not a database-existence or availability claim. It contains no credentials,
accounts, JWTs, helper settings or operational admission.

| Actor | Explicit A | Explicit B | Purpose |
|---|---|---|---|
| a_owner | owner | none | Ordinary owner, A only |
| a_owner2 | owner | none | Second owner preserves the owner floor |
| a_admin | admin | none | Ordinary admin, A only |
| a_member | member | none | Ordinary member, A only; deliverable assignee |
| a_viewer | viewer | none | Ordinary read-only A caller |
| b_only | none | owner | Ordinary B-only caller |
| dual | admin | admin | Ordinary A/B seed writer and exclusion reader |
| outsider | none | none | Outsider to A/B, still owns an automatic workspace |
| revocable | member | none | Separate nonowner revocation case |

The R2 `owner` input is a creator-field alias for **dual**, an actual admin in
A and B. It does not confer or describe an owner role. `assignee` maps to
**a_member**. In exact R2 source, that creator input populates the main A
project and client. Several other created_by columns are omitted or null,
including foreign-project/client rows, spends and invoice parents. Do not
attribute those null fields to a fictitious owner or silently rewrite R2.

## Retained triggers add real fixture rows

Migration 20260225000003 installs enabled AFTER INSERT on_auth_user_created
on auth.users. Migration 20260225000004 replaces handle_new_user with its
SECURITY DEFINER body and public search path. Its latest named body trims
org_name, normalizes lower-case slug text, appends the first eight user UUID
characters, inserts a workspace and then its owner membership. Source search
finds no later named replacement. Actual catalogs still govern admission.

The fixed auth insert shape follows the retained fixture pattern:
`id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at`.
Emails end in `.invalid`; names begin `SYNTHETIC`. app metadata is empty.
User metadata carries an organization label only, never authorization. No
password, auth identity, confirmation, login, session or JWT is created here.
Future inserted auth rows alone would not prove working Auth authentication.

The explicit workspace insert uses only id/name/slug. Membership uses
workspace_id/user_id/role. Existing columns, defaults and enabled triggers stay
in force. No home geography, jurisdiction, adopting authority, law, agency or
time zone is selected. A retained stage-gate default is a database default,
not a synthetic agency's legal choice. Capture its actual returned value.

Expected additions are nine selected auth rows, nine automatic workspaces,
two explicit workspaces, nine automatic owner memberships and nine explicit
memberships. The automatic workspace UUIDs remain unknown until native return
and independent readback. Record ID, name, slug and every public workspace and
membership field. Never report only two workspace writes.

The owner-floor BEFORE UPDATE/DELETE triggers remain active. This builder
inserts memberships; it does not revoke owners. Later owner tests must retain
a_owner2. A sole-owner loss must retain actual OP409, while an ordinary member
cannot directly edit memberships under the retained SELECT-only policy. A
privileged membership test proves the trigger boundary, not ordinary user
permission to manage members. Revocable removal is a later authorized stage,
not part of this insert transaction or an automatic successor.

The membership AFTER trigger retain_contract_mutable_change can add
contract_source_changes when a baseline exists in the workspace. Its later
schema adds transaction_id and pins search_path to pg_catalog,public,pg_temp.
The prerequisite SQL captures complete bounded before/after rows from
contract_source_changes and contract_source_deletions, plus actual selected
baseline queries before/after. Native absence must be observed. Fresh IDs alone
are insufficient evidence. Unexpected baseline or cutoff effects stop admission.
The comparator expects unchanged cutoff rows under the declared absence.

Later R2 invoice composition retains draft-first lines, totals and legal status
changes. Invoice/project revision triggers can change project timestamps and
revision fields. Contract guards, closed-assignment rules, cutoff triggers and
source history stay enabled. The later financial recorder captures all parent,
line, project/revision and cutoff rows, including unchanged pre-existing rows.
None of those financial writes is supplied or executed by this builder.

## Stage 0 requires a separately verified root allocation record

Root still supplies all of these concrete facts before any native use:

1. A NEW target, exact cluster system identifier, positive typed database OID,
   database owner and exclusive lease/window. No concurrent new allocation may
   occur during an actual exclusive catalog window.
2. Ordered installed predecessor version/name/statement rows and digests,
   archive custody if applicable, reviewed upgrade body/history handling,
   complete relevant catalogs and actual cluster role/inheritance/default ACLs.
3. Explicit admitted administrator session/effective role OIDs for prerequisite
   inserts. No cluster role, grant, policy or trigger change is authorized.
4. Ordinary authenticated effective role, actual nonbypass session/transport role,
   exact actor identity, source privileges and legitimate A/B writer context.
5. Helper custody, finite stage resources/deadline, durable intent/acknowledgement
   recorder and independent connection readback. None exists in this packet.

The allocation shape accepted by build.py is deliberately
`SUPPLIED_FOR_TEXT_ONLY`. It validates positive integer OIDs (rejecting bool),
a positive bounded system-identifier string, fixed target, exclusive boolean,
canonical UUID lease, SHA256-shaped bindings and exact source/application pins.
It authenticates none of them. The root recorder must separately verify the
allocation record's identity, bytes, authority, current lease and actual target.
No operational admission file is produced or consumed here.

The three fixed SQL templates contain no arbitrary relation-name or raw-SQL
input. The builder reads only its named bounded templates and returns text in
memory. The SQL checks exact target name, OID, system ID and admitted admin role
OIDs before writes. The initial identity transaction is READ ONLY. A future
runner must finish and independently compare that identity/catalog receipt
before dispatching the write transaction. The repeated write guard is additional
protection, not permission to skip that read-only stage.

The four transaction-local `openplan.budget_*` values bind lease and verified
root/history/catalog record digests. Those values do not authenticate their
own contents or prove exclusivity. Setting arbitrary matching strings cannot
replace the separately verified external root record. No setting is applied here.
If identity access itself lacks privilege, record refusal; never add a grant.

Stage 0 fences failed R5 target
`openplan_a0_limit_c2e1f4598374c1bf439baa3b`, source419 anchor
`openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up`, every retained DB,
archive and helper, demo3000, `~/apps/openplan`, frozen607 and current215.
None may become this target, donor, caller or writable source. The new R6
observation proposal and its terminal/release notices belong to root. They
supply no budget allocation or test grant.

## Commit custody requires real acknowledgement and independent rows

A later runner first records a durable intent containing exact allocation,
source/template/emitted-SQL hashes, actor, stage, deadline and expected row sets.
Flush the file and parent directory before dispatch. Retain before rows and
credential-free catalog output with lengths and SHA256 digests. Preserve all
returned IDs and SQL errors immediately. SQL timeouts are 10 seconds per
statement, lock timeout three seconds, and idle transaction timeout 30 seconds.
The proposed whole prerequisite stage requires its own finite runtime admission.

The SQL refuses a baseline census above 4,096 rows in each selected complete
public table. Record every row below that bound, with no LIMIT or truncation.
Capture selected credential-free auth columns only. After writes, save actual
transaction ID/PID, full selected rows and returned auto identities before
COMMIT. Retain the real COMMIT acknowledgement separately. A SELECT before
COMMIT is not evidence of committed visibility.

Open a distinct admitted connection after acknowledgement. Repeat exact target
identity before any query and independently select the same rows. Feed complete
selected before/after records into readback.prerequisite_rows. Its six sections
are users, workspaces, members, cutoffChanges, cutoffDeletions and baselines.
Users contain only the eight columns named above. Public rows retain all native
fields. Baselines contain the actual selected new-workspace query results.
The reader compares exact IDs/roles, auto names/slugs, all added public rows,
unchanged prior rows and empty selected baselines. Record and hash full raw rows
before comparison. Do not discard unexpected fields or effects to pass it.

A lost COMMIT acknowledgement, partial capture or failure stops the stage.
Retain the intent, returned identities, bytes and failure. Do not retry inserts,
allocate another target, repair grants, delete rows or start a helper. Root
must reconcile the existing transaction on the same exact target under a new
explicit recovery admission. No automatic cleanup or successor is supplied.

## Ordinary caller expected sets and privilege boundaries

Run ordinary.sql only in each actual authenticated ordinary context. It creates
no claims or role switches. It checks exact database name/OID, effective and
session role OIDs, auth.uid, row_security, no super/bypass roles and no table
ownership bypass. A separately trusted recorder binds the connection to the
verified cluster before ordinary access. Ordinary roles need no new privilege
to call pg_control_system; that function appears only in admin identity guards.
The recorder must compare auth.uid to the specific intended actor, not merely
accept any actor in the manifest.

Own membership SELECT yields the actor's automatic owner row plus exactly the
explicit rows listed above. A member cannot enumerate other members' rows.
Workspace SELECT yields that same actor's automatic workspace plus A and/or B
according to the table. The outsider still sees its own automatic workspace.
For A/B only, workspace_member_can_write yields true for owner/admin/member,
false for viewer; inaccessible workspaces yield no row in this selected query.
The supplied-row comparator checks exact membership/workspace/eligibility sets.
It does not establish input origin, native query execution or connection identity.

After a separately admitted revocation, revocable keeps only its automatic
workspace and membership; A and A-project RPC access refuse. The baseline reader
here deliberately requires the original membership, so it must not silently
accept a revoked dataset as this baseline. Later revocation/owner-floor stages
need separately reviewed old/new oracles and commit/readback receipts.

ACL evidence must retain raw null/direct ACL and acldefault expansion, PUBLIC
OID zero, grantor/grantee/grantability, owner and inherited roles, global/schema
default ACL and effective table/column privileges. Ordinary effective EXECUTE
must be true for SQL19, workspace_member_can_write and workspace_role_rank.
SQL19 explicitly removes PUBLIC/anon execute and grants authenticated. A service
role's direct/default grant remains observed, not presumed absent. Trigger
SECURITY DEFINER ownership and direct/default ACLs remain recorded separately.

The native recorder must compare the entire wanted projection set with catalog
rows, including missing columns. An inner join that silently omits an attribute
is insufficient. SQL19's exact SELECT requirements are:

| Relation | Required columns, including joins, predicates and ordering |
|---|---|
| projects | id, workspace_id, budget_amount |
| project_deliverables | id, project_id, title, summary, owner_label, due_date, status, created_at, updated_at, budget_amount, percent_complete, assignee_user_id |
| project_spend_entries | id, project_id, deliverable_id, entry_date, amount, description, vendor_label, created_at |
| client_invoices | id, workspace_id, project_id, status |
| client_invoice_line_items | id, invoice_id, deliverable_id, amount |
| workspace_members | workspace_id, user_id, role |

The seed writer additionally needs actual effective privileges for each exact
R2 INSERT/UPDATE column and the policies those writes evaluate. No source comment
about historical Supabase default grants is proof that the allocated target has
them. Direct and child restrictive writer policies AND with retained permissive
policies. The dual writer must read A and B and successfully perform the actual
ordinary financial seed with all triggers active. Inability to see/write either
workspace is admission refusal, never a grant repair or privileged seed fallback.

Later caller RPC expectations are exact A/B visibility for owner/admin/member/
viewer, A-only/B-only/dual/outsider and revoked contexts. Anonymous execution
refuses; null, nonexistent and hidden projects refuse instead of returning zero.
The same dual ordinary caller must first read B sentinels, then observe their
exclusion from the A RPC. SQL19 remains SECURITY INVOKER/STABLE. Service and owner
bypass inventories are separate from ordinary evidence. No RPC runs here.

## Later stages remain separate

The raw PostgREST/RPC capture enforcing eight MiB and a deadline before unbounded
allocation, actual Supabase parser/loader/math, live ACL/RLS and failure-origin
trials, numeric typmods, observed MVCC locks/commits, upgrade/history handling,
representative restore and ordinary editor/browser/artifact journeys need later
separately owned stage implementations. This builder supplies none of those
transports or controllers. It does not complete native budget proof, M11,
independent finance/practitioner acceptance, scientific validation or v1.
