# Independent R2 review approves conditional proof preparation

October 16, 2026. Reviewer: GPT-6.1 Sol, high reasoning. No nested delegation.
Subject: exact author commit `0e8b59d59523cdae67451e18df8965b333d684d3`,
`docs/reviews/2026-10-16-project-budget-native-proof-corrections` in
`/home/nathaniel/.t3/worktrees/openplan/t3-7c2ee45c`.

## Disposition and retained findings

Approve this exact R2 packet for **conditional source/preparation use**. No new
preparation blocker or P1/P2 application finding is established within this
review's scope. The revised source addresses the original invoice lifecycle
incompatibility and foreign delivery/spend coverage gap. This is independent
source review, without a new execution campaign. It does not accept a native
fixture, financial result, migration, role builder or operation.

Original independent review `02c7c6d6756dcafcb22f5aee91ff1a36cadb924d` remains
valid against original packet `7c07549714f5b2afdd5816557fedd697bf743adc`.
Its PREP-1 still blocks that original emitter. R2 does not repair or replace those
historical bytes. The prior pure reader and its successful controls did not cure
PREP-1. R2's author-owned adapted reader likewise supplies author validation,
not independent execution evidence.

The failed cached diff check and original R2 commit
`bc70cfa8f031021ab8661c34003793f0820bd964` remain retained. The final authorized
EOF follow-up is acceptable as an explicit metadata exception. TEXT01 does not
establish final public reader byte identity. Details appear below and in
[VALIDATION.md](VALIDATION.md).

## Checkout, ownership and source identity

This review starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`, branch
`t3/project-budget-native-r2-review`, checkout
`/home/nathaniel/.t3/worktrees/openplan/t3-9839caf0`. Ownership covers only this
NEW review directory and NEW private directory
`/home/nathaniel/.local/state/openplan/project-budget-native-r2-independent-20261016`
with mode 0700. The author checkout is clean at exact final `0e8b59d`. The prior
independent checkout remains at exact `02c7c6d6`. Active-session inventory identifies
root and the separate M11 money lane. No browser, worker or checkout belonging to
another lane is changed.

The full original brief, full prior independent REPORT/VALIDATION/evidence,
final 15-file R2 packet and retained author resource/control receipts inform
this review. Direct source reads cover relevant base schemas, required fields,
foreign keys, parent/child RLS, workspace owner floor, retained lifecycle,
contract source/closeout guards, revision triggers, SQL19, production loader,
budget math and money helpers. Original README, DESIGN differences, diagnostic
FINDING/VALIDATION and original seals preserve the older evidence boundary.

Read-only metadata establishes these identities:

- All 14 listed final packet pins match; the fifteenth file is evidence.json,
  SHA256 `d1262afba86aff29ee047bf423fa0fc6e46a4b71284b198a531b5fe11595fba1`,
  8,669 bytes. Final REPORT SHA256 is
  `e4225120c3ab8572d89b7146a91ff37c3627145b5b6e2b932b77996e5d7c4618`.
- All 35 author private pins and 34 entries inside the private seal match.
  The 11 original packet files and 33 original private files match their retained
  before-inventory hashes, lengths and modes. The prior independent evidence
  and its three listed report/reader pins and 30 private pins match.
- All 13 R2 source pins match both the named working files and exact Git objects
  at `d0d12c406df8b8fd29bd2611a9cb29d8c3168ab8`. Its application tree is
  `44e638d6d79378042343bf5b18408f09ee991d57`. The packet's observed documentation
  HEAD `87b18feb30b6989757c2b36592418881dd5443da` is historical. This review
  observes later docs HEAD `04841834d31755d3d618a6ea3c300fb9b0b1414b`, with the
  same app tree. No forthcoming M11 source is substituted.
- SQL19 retains SHA256
  `ed2784b2b1623eb34340480d84dc72e5ce8d226c70532a5062495a1565df181d`.
  The current loader is
  `c763dfe4041b9f6390f93b2329312a539a2d13796a74719d84f9630413bf9743`.
  Frozen `825b34a549fbd424d4148815cfa6bdb7c23f2f5c` and app
  `f520e01ef084e78f1bde90cbe4d6941facd2dae2` remain historical and unchanged.

Matching hashes establish file identity. They do not establish PostgreSQL state,
error origin or runtime behavior. [evidence.json](evidence.json) records the
source and metadata receipts. Private metadata snapshots retain exact comparisons
without recursively copying proof roots or exposing credentials.

## R2 addresses PREP-1 under the inspected retained rules

Final generate.py lines 39–55 and 100–154 compose invoice parents as draft with
zero totals, then insert their lines. Only afterward does finish_invoices reconcile
subtotal, retention and total while draft. Eligible invoices move draft to sent;
the paid subset then moves sent to paid. The draft sentinel remains draft. The
void sentinel moves draft to void after its line and totals. The foreign sentinel
moves draft to sent after composition. Each maximum-row case uses the same order.

Migration `20261017000005_money_integrity_corrections.sql:434–479` retains both
header and line guards. Its INSERT line branch has no postgres/service exemption.
The revised emission avoids that refusal by changing the fixture sequence. It
neither changes the guard nor relies on privilege. Header reconciliation happens
before financial fields become immutable. The sent-to-paid update changes status
and paid_date, fields that the retained header guard permits for that transition.
The timestamp trigger's updated_at change is also explicitly released.

The older `guard_contract_invoice` retains source-attributed invoices and lines.
The fixture carries null engagement, no contract billing source and no time link.
The closeout guard selects no attached assignment on those inputs. The cutoff
trigger has no matching baseline under the declared new fixture prerequisites.
These absences must be established on the allocated target. They are not grounds
to bypass a guard if its actual state differs. Invoice revision triggers touch
project state, so native receipts must retain those side effects.

Base required fields, status choices, per-workspace invoice-number uniqueness,
workspace/client/project/user foreign keys and nullable delivery links fit this
prepared sequence. Header amounts stay within their own typmods. No inspected
line trigger reconciles header totals automatically; R2 supplies them explicitly
and still requires native line/header reconciliation. This is a bounded source
trace, not an ordered migration replay or a current trigger catalog.

The 1,202-line parent is a direct synthetic table seed. The retained
replace_client_invoice_lines API accepts at most 200 lines and assigns line IDs.
R2 acknowledges this distinction. This fixture does not prove ordinary API
creation of the large parent or editor write acceptance.

## The foreign sources now make project exclusion observable

The ordinary fixture adds a B-project deliverable with budget 777.77 and progress
25, and a B-project spend of 888.88 linked to that delivery. The existing foreign
invoice uses a B client and B project. The foreignExclusions oracle records exact
UUIDs and 77,777/88,888 excluded cents. Main-project result counts remain 1,201
deliverables, spends and eligible invoices, with 2,402 eligible lines and 1,202
under one parent. Raw delivery/spend fixture counts rise to 1,202 each.

The visibility prerequisite matters. The SAME ordinary dual A/B caller must
first read those foreign rows separately, then receive exact A-project exclusions
from the RPC. Hiding B with RLS would conceal a missing project predicate. R2
states that prerequisite explicitly. SQL19 source currently includes project
predicates for both direct sources. The author's last two controls deliberately
omit a predicate in supplied text readback. They do not execute or mutate SQL19.

Original UUID namespace, eligible IDs, tied timestamps/dates and UUID ordering
remain unchanged. The ordinary literal cents remain 120,100,000 delivery budget,
120,100 direct spend/actual, 600,500 billed, 999,900 stated and 879,800 remaining.
The final-created delivery has 360,500 billing cents. Billing remains separate
from direct incurred cost. No native foreign-caller or monetary result is measured.

## MVCC preparation now uses legal replacement records

MVCC_LIFECYCLE supplies separate small literal identity maps for zero-to-nonzero
and two-nonzero cases. Writers delete and replace lines only while their parent
is draft, reconcile that draft, then issue it. The two-nonzero case voids the old
issued invoice by status alone and retains its old physical line. No issued line
is edited or deleted and no issued parent returns to draft.

The planned old/new tuples distinguish a removed excluded draft line from an old
eligible line retained under a newly void invoice. The source trace supports
those sequences under the stated no-contract fixture context. Project-move and
membership variants retain caller-specific refusal or source-failure oracles.
A dual caller can observe the A-invoice/B-project mismatch as invoice lane 22000;
a caller hidden from a source cannot supply a service census as ordinary evidence.

The actual production STABLE call, three connections, observed blocker/lock/PIDs,
real commit acknowledgement and postcommit readback remain required. A comparison
of old/new literals or a text lifecycle model cannot establish snapshot isolation.
No concurrency experiment or deliberate VOLATILE negative control runs here.

## The remaining native stages keep their boundaries

NUMERIC(14,2) permits at most 99,999,999,999,999 cents per source row. Both proposed
90071992547409.91 and .92 dollar inputs exceed that typmod. Later savepoints must
record actual refusals, separately for each money column. They cannot become
invented native beyond-safe rows. Valid 101- and 1,001-row aggregates can exceed
safe integer cents. Null, recorded zero, storage rounding, invalid transport and
absent schema remain different cases. Wider installed types require a drift stop.

R2 keeps raw HTTP/RPC bytes before parsing, actual Supabase parsing of the original
response, independent parsing of the same retained bytes and the exact production
loader/math. Response.clone alone does not enforce a bound; the later capture
implementation must enforce the declared 8 MiB bound before unbounded allocation.
No implemented capture adapter is claimed here. Decimal strings substituted before
the SDK parse would not establish native transport. Exact helpers cannot recover
lost incoming digits.

The ACL/RLS plan separates direct and default function ACLs, PUBLIC OID zero,
ordinary/anon/service/owner callers, table and exact column SELECT, direct-source
and child-join policies, move/revocation and failure instead of zero. The retained
restrictive writer policies require legitimate write membership, in addition to
permissive membership policies. Root must admit an actual ordinary writer for
both A and B. The UUID manifest does not allocate users, grants or membership.
The catalog query's inner attribute join can omit a missing column; its recorder
must compare the full wanted set to catalog results as the packet directs.

Root's additional source observation is retained as a builder/recorder boundary.
Migration 20260225000003 installs on_auth_user_created after auth.users INSERT;
20260225000004 replaces public.handle_new_user with the inspected SECURITY DEFINER
body. That body creates a workspace and owner membership for each new auth user.
The bounded source-name search finds no later override. Earlier native_proof.py
lines 197–203 inserts six users before manually adding two fixture workspaces
and their memberships. Those auto-created rows are additional fixture state,
not evidence that the A/B builder only creates two workspace rows.

R2's generator inserts no auth user and DESIGN already requires actual builder
trigger effects and complete catalog/row receipts. Later admission must capture
the returned auto-workspace identities, slugs and owner memberships as well as
explicit A/B memberships, second-owner and revocable-member contexts. Record
all such side effects in before/after and cleanup receipts. Do not disable or
suppress the signup trigger. No generator defect, new application finding or
extra campaign follows from this prerequisite observation.

Optional-column trials preserve independent surviving fields and require actual
catalog absence and restoration. Generic 42883/42703 text does not establish
origin. The current loader deliberately leaves p.budget_amount ambiguous and
unreadable. Even verified absence does not invent a catalog-origin flag in that
protocol. Query cancellation can escape OTHERS. The separately approved classifier
`5685550274a5a3682eafc45cfe549e58da394ed6` and root's 309 joined checks are external
source receipts, read here without rerun or claim promotion.

SQL19's own BEGIN/COMMIT does not create nested transactions. Its later migration
runner still needs reviewed transaction-body/history handling. Representative
upgrade requires real nonempty predecessor preservation. Representative restore
requires a separate new target, archive/history/role/catalog/row reconciliation
and ordinary readback. Whole-installation recovery remains separate; it is not
an invented prerequisite for this representative fixture.

## EOF exception and author test custody

Original R2 commits after cached diff --check exit 2 for a redundant EOF blank
line. Root authorizes a separate correction and preserves that failure and commit.
The private tested reader is 18,993 bytes, SHA256
`26c899a676d597b6cf8a952101c3df925d6265ce2ab5cb745b72da7f910b78e0`.
The final public reader is 18,992 bytes, SHA256
`91c7463be3d1cbfb8aa66bd3e3ec5e84510726cc75b7075c9f56749bc280a6bc`.
Independent metadata comparison finds tested bytes equal final bytes plus exactly
one newline. Both AST dumps without attributes are identical, SHA256
`263141173fe4ce8cf8ee9193fca802f0440de4e46e6d7dcd1b1d5cfa164c136c`.
No reader or generator is imported or executed for that comparison.

EOF_METADATA SHA256 is
`3aee8b3991496d254e6d91d6c21e69df459e1b9b166a9b66e9ebe1d572e4b853`.
The older private final-source-readback.json still records its pre-EOF identity.
It remains historical and is superseded for the reader by the explicit EOF
exception. Do not repeat its old final-byte-equality label as a current result.
AST equality supports unchanged executable syntax, not execution of final bytes.

The existing author TEXT01 receipt reports seven cases, a harmless survivor,
11 named assertion failures and exact private restoration. It reaches exit 0 in
4.893 seconds, peak 45,481,984 bytes, within its recorded 512 MiB, zero swap,
CPU50 and Tasks32 limits. Named root/private mounts and distinct network namespaces
are recorded. Inherited submount writability remains unassessed. This review
reads those terminal/resource/control receipts; it does not rerun or independently
reproduce them. The original 15 supplied-loader-error cases and failed TEST01 /
successful TEST02 remain synthetic historical evidence, without native origin
or P2 promotion.

## Admission, blind categories and handoff

No new test, guard, generator or controller is written or executed. No manager,
flock, dependency or donor is used. There is no nonduplicative pure campaign
needed to support this source-only verdict. Author 7/11, old 15 loader cases,
564 classifier matrix and root 309 suite are not repeated. Metadata comparison
could expose mismatched bytes; it cannot expose native behavioral failure.
Two missing filenames during read-only source inspection are retained in metadata;
file inventory identifies each correct migration before it is read. No subject
operation fails or retries.

AGENTS, planner-writing, prove-it and Supabase/Postgres guidance inform this review.
The explicit offline restriction overrides network, CLI/advisor and query steps.
Direction command, types, lint, builds and application tests remain unrun here.
The contract, M11/CORE-PM-01, capability, current direction and known-issue
boundaries retain complete v1 scope. This report adds no queue and narrows no
planning, geography, scientific or financial requirement.

Before native use, root still supplies a NEW exclusive budget target, exact
predecessor and ordered history, real role-builder and caller contexts, helper
custody, concrete bounded runner and stage admission. All result fields remain
empty. Root's A0 target is not a budget target. A changed future M11 application
requires explicit new binding and applicable review. This approval does not
silently apply to it.

No original source, old packet or proof artifact is edited. The canonical three
unrelated staged files retain their original status and file pins. Demo3000,
retained databases/helpers, frozen source anchors and other lanes are untouched
by this review. No database/catalog/socket/Docker/HTTP/provider/account/service,
browser, native CLI, hosted, push, PR, main or release action runs. No installation
or role allocation occurs. Native financial, raw JSON, actual loader transport,
ACL/RLS, optional-origin, MVCC, upgrade/restore, editable API, desktop/390px,
console/artifact, practitioner, scientific, M11 and v1 acceptance remain open.
No automatic next operation follows this local documentation commit.
