# Independent review of the frozen native-budget preparation packet

October 16, 2026. Review subject: exact commit
`7c07549714f5b2afdd5816557fedd697bf743adc`, author checkout
`/home/nathaniel/.t3/worktrees/openplan/t3-7c2ee45c`, directory
`docs/reviews/2026-10-16-project-budget-native-proof-preparation`.

## Disposition

One bounded preparation finding prevents admitting the original generated fixture
against its declared predecessor. The generator creates issued invoice parents
before their lines. The predecessor's existing lifecycle trigger rejects those
line inserts. This review establishes a source incompatibility, not an observed
native error, application defect, or financial acceptance result.

The original packet and private proof remain unchanged. Root acknowledges the
finding and assigns the author a separate r2 preparation packet. That future
revision is outside this exact-commit review. It requires its own identity,
source review and validation. Do not erase this finding when reviewing r2.

The separately granted PURE TEST01 reaches terminal success. Seven emitted-text
cases, the authored controls and independent literal/identity checks complete.
A harmless mutation survives, five broken readbacks fail their named assertions,
and exact private working bytes restore. These results do not cure PREP-1.
[VALIDATION.md](VALIDATION.md) records limits and blind categories. No database,
SQL, helper, role, account or native transport action runs.

## Ownership and evidence identity

This review starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`, branch
`t3/project-budget-native-prep-independent-review`, checkout
`/home/nathaniel/.t3/worktrees/openplan/t3-4e951d3a`. It owns only this NEW report
directory and NEW private
`/home/nathaniel/.local/state/openplan/project-budget-native-preparation-independent-20261016`
with mode 0700. It creates no nested agent.

Read-only metadata matches all 10 packet pins and 33 private pins. The eleventh
packet file, `evidence.json`, is 6,488 bytes with SHA256
`ba84ef6ee24c0661ec94d62099a7cd72bf13005a0666ab4c8945b26f5a3b1293`.
Every frozen and money source-file pin in `source-pins.json` also matches. The
full packet, including README, DESIGN, NUMERIC_BOUNDARY, VALIDATION, FINDING,
generator, controls, catalog, receipt template and both manifests, is read.
Hashes establish identity and custody. They do not establish runtime behavior.

The frozen source checkout remains clean at
`825b34a549fbd424d4148815cfa6bdb7c23f2f5c`, application tree
`f520e01ef084e78f1bde90cbe4d6941facd2dae2`. SQL19 SHA256 is
`ed2784b2b1623eb34340480d84dc72e5ce8d226c70532a5062495a1565df181d`.
The loader SHA256 is
`30c5133a27cfb723c9ea1fdbe45cf6a19a5fb9c156d0804565105ba14b9b63ab`.
No migration execution is inferred from either hash.

The packet's pending combined-application identity describes its historical
preparation state. The task supplies later money approval and combined-source
history. That history does not silently rebind this frozen packet. Future
execution still needs the approved final application and a newly sealed packet.
Classification candidate `8e1cc91a78040c91328d91f8200015570052defb` belongs to
another independent review and is not joined or accepted here.

## PREP-1: compose invoice lines before issuing their parents

The generator's invoice INSERT assigns `sent` or `paid` before its line INSERT.
Its excluded sentinels similarly insert a `void` or foreign `sent` parent before
the corresponding line. This affects ordinary and all six maximum-row cases.
See original `generate.py` lines 77–117.

The declared frozen source includes
`openplan/supabase/migrations/20261017000005_money_integrity_corrections.sql`.
Lines 459–479 define `guard_client_invoice_line_lifecycle` and install
`retained_client_invoice_line_lifecycle` before INSERT, UPDATE or DELETE on
`client_invoice_line_items`. On INSERT it reads the new parent status. A parent
outside `draft` raises SQLSTATE `23514`, with the line-immutability message.
The function has no postgres or service-role escape for this branch. The older
contract-line guard does not cancel this later lifecycle trigger.

Consequently, the first eligible line encounters a non-draft parent under that
source history. A seed transaction cannot reach its planned commit without
changing the fixture sequence or weakening the predecessor. Disabling triggers,
changing session_replication_role, dropping the guard, skipping migration05, or
using another caller privilege would invalidate the declared proof boundary.
This review does none of those things.

A revised preparation should create draft parents, insert their complete lines,
then use legal draft-to-sent and sent-to-paid transitions. The void sentinel also
needs its line before voiding. Preserve final statuses, IDs, cents and exclusions.
Capture actual trigger definitions in the later allocated catalog; source
inspection is not current-cluster truth. Stage 5's proposed line insertion/deletion
interleavings must likewise use draft/new/replacement invoice lifecycles rather
than edit issued lines. Its finite old/new oracle must specify those identities.

This finding is a preparation blocker. No P1/P2 application defect is established.
The generator's mathematical oracle can agree with its emission while this
trigger incompatibility remains. Its existing equality controls cannot detect it.

## Other bounded review conclusions

The relevant base schemas, money typmods, required columns, foreign keys,
assignment FK, update triggers, workspace membership policy, owner floor,
restrictive viewer-write policies, invoice child join and later invoice lifecycle
are inspected. The budget loader, pending-schema helper, frozen budget math and
SQL19 are inspected directly. The ordinary required-field/default choices and
foreign-client linkage fit those inspected declarations, subject to PREP-1 and
the deliberately missing allocation/catalog/role prerequisites. This is not a
complete migration replay or a broad schema audit.

The declared NUMERIC(14,2) maximum is `99999999999999` cents per row. Every SQL19
money leaf stays within that declared storage bound. The packet correctly
requires native refusals, separately for each money column, for
`90071992547409.91` and `.92`. Both exceed the actual per-row typmod. It does not
invent a native beyond-safe per-row record. Valid 101- and 1,001-row totals can
exceed safe aggregate integer cents and need downstream exact arithmetic. Null,
entered zero, rounded sub-cent storage, invalid transport and absent schema are
separate cases. A wider allocated typmod requires a drift stop.

The literal ordinary distinctions are coherent: deliverable budgets 120100000
cents, direct cost/actuals 120100, billing 600500, stated budget 999900 and
remaining 879800. Billing does not become incurred direct cost. The generator's
last-created deliverable receives 360500 billing cents. Equal-valued records
have separate primary keys; ties require UUID ordering, not insertion order.

The generated foreign project carries an invoice sentinel, but no foreign
spend or deliverable. This leaves a bounded blind category: this fixture alone
cannot expose a missing project filter in those two sources when a dual-member
caller can see both projects. Later Stage 3 needs explicit caller-visible
cross-project rows and exact expected exclusions for those lanes. This is a
preparation coverage observation, not a demonstrated SQL19 filter defect.

The packet preserves function ACL/default/PUBLIC distinctions, exact table and
column projections, caller/child RLS, owner/service bypass boundaries, project
move and revocation. Those are designs, not measured privileges. The catalog
projection JOIN can omit an absent attribute, but its explicit recorder contract
requires comparing the wanted list against pg_attribute; no working recorder is
claimed. Do not treat the SQL file alone as that guard.

Optional-attribute trials require actual catalog absence, independent surviving
fields and rollback/restore. Generic `42883` or `42703` wording is not native
origin evidence. Query cancellation can escape OTHERS. SQL19's BEGIN/COMMIT does
not nest; atomic history admission still needs a reviewed migration-body runner.
The proposed STABLE snapshot experiment requires real commits, observed locks
and independent old/new tuples. Text emission and tuple comparison do not prove
MVCC. Representative upgrade/restore needs exact nonempty predecessor/history,
roles, archive and restored rows, on separately admitted new targets. Whole
installation recovery is a separate obligation, not this fixture's prerequisite.

## Historical diagnostic and product boundaries

TEST01's reader failure remains retained and separate. TEST02 reports 15 supplied
loader-error cases and five counterfactual control records. The packet correctly
limits these to synthetic errors, not native origin or a P2 application claim.
This review matches the retained files and inspects the production classifier;
it does not rerun those cases or promote their claim tier.

AGENTS, planner-writing, prove-it, Supabase and Postgres skill guidance inform
this review. The explicit offline restriction overrides network documentation,
CLI, advisors and native-query steps. The relevant contract, sole roadmap,
capability matrix, latest direction review, known issues, architecture and
CORE-PM-01 retain the full planning-management obligation. Direction command,
application tests, types, lint, build, services and browser are unrun here.

No target, exact installed history, admitted role builder, helper custody, final
combined source or operation admission is supplied by this review. Root's A0
allocation is not a budget target. Protected demo, retained databases, eight
helpers, frozen607 and other proof roots remain immutable and unqueried. No
emitted SQL is parsed by a database or dispatched. No native helper or real CLI
subject executes. No source fix, push, PR, main update or release occurs.

Raw RPC bytes, actual Supabase parsing, production-loader/math readback, financial
precision, RLS/ACL, optional-schema failures, MVCC and upgrade/restore remain
unproved. Editor writes, desktop and 390px identified-build journeys, console and
usable artifacts remain later work. Practicing-planner usefulness, M11, agency
finance, scientific acceptance and v1 remain separate and open.
