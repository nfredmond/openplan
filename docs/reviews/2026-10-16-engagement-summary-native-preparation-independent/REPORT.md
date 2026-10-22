# Revise the preparation controls and narrow one reader claim

October 16, 2026. Independent reviewer: GPT-6.1 Sol, high reasoning.
No nested agents. Exact subject: `20aed930a35cfd8e993bf283e37908d380ab531a`.

## Verdict

**REVISION REQUESTED for the preparation packet.** PREP-1 is a P2 preparation
control-definition mismatch. PREP-2 is a P3 claim correction. Neither finding
establishes a new P1/P2 application defect. The prior SQL20 source review remains
separate. This report accepts no executable, application, native operation,
allocation, integration, M11 milestone or release.

The invoice composition and literal arithmetic fit the inspected source. The
packet correctly leaves every executable unrun and native prerequisite pending.
Correct the two bounded discrepancies before presenting this exact packet as
ready for an executable request. This review runs no control to resolve them.
It edits neither the author packet nor application source.

## PREP-1 [P2 preparation]: the proposed failure contract disagrees with the code

Subject `CONTROLS.md:27–32` requires actual `AssertionError` failures with the
named messages for the following table. Its allocation controls at line 50
belong to `emit_fixture.py`, whose lines 39–49 explicitly raise `ValueError`.
With earlier fields valid, a boolean database OID reaches
`ValueError('target-not-allocated:databaseOid')`, a protected OID reaches
`ValueError('target-protected-or-not-exclusive')`, and equal A/B workspaces reach
`ValueError('workspace-distinct')`. The pending manifest reaches a target-field
`ValueError`. None meets the documented `AssertionError` requirement.

There is a second mismatch in the same control table. Line 47 names
`line-parent-must-be-draft` for issuing a parent before its line INSERT. The
reader first requires every invoice INSERT to be draft at `readback.py:147–149`.
Changing the initial status to sent therefore reaches `draft-parent-insert`.
Moving the ordinary draft-to-sent UPDATE before its existing line instead
reaches `one-line-per-parent` at lines 166–175. There are no children at that
point. Neither simple mutation reaches the advertised line-parent assertion.
These are source traces, not observed mutation outcomes.

The discrepancy matters because the proposed campaign expressly rejects an
unrelated nonzero exit. A future wrapper following this table cannot accept
these refusals as its specified controls without changing the contract or
misclassifying the failures.

Minimal correction: document `ValueError` and exact message/prefix expectations
for emitter allocation refusals, while retaining `AssertionError` for reader
assertions. Define each lifecycle mutation precisely. To target
`line-parent-must-be-draft`, a possible finite mutation inserts a second,
previously unused line ID under an already composed and sent parent. To test
initial issued-parent emission, name `draft-parent-insert` instead. Any future
execution still needs its own exact pins, harmless survivor, intended failure,
restoration and baseline. No guard change or test run is requested here.

## PREP-2 [P3]: foreign-ID rejection depends on the requested scope

`DESIGN.md:272` says supplied duplicate/foreign IDs cause the production reader
to refuse the whole invalid envelope. That statement needs a scope qualifier.
The production implementation is
`openplan/src/lib/invoicing/engagement-summary-queries.ts:63–89`.
Its lines 70–74 validate the scope echo and completeness. Lines 76–86 reject
duplicate IDs, but reject a foreign ID only when `scope.engagementId` is defined.

A workspace request with no engagementId, a matching workspace/null engagement
echo, and one well-shaped foreign engagement row passes that identity branch.
The reader inserts that row into its map and reaches `state: 'complete'`.
By contrast, an explicit E0 request containing E2 fails the foreign-ID condition.
The fixture comparator at `readback.py:54–63` checks the independently expected
identity set for either scope. Its broader assertion is not production behavior.

Minimal correction: specify foreign-ID refusal for the engagement-scoped
production-reader case. For workspace requests, assign exact expected-set
comparison to the independent fixture readback and scope correctness to native
SQL/RLS evidence. Duplicate-ID and echo-mismatch refusal remain supported in
both scopes. This finding does not propose application changes. SQL20 retains
its workspace predicate, and a missing requested summary separately becomes
unavailable through `engagementSummaryFor`. No cross-workspace disclosure is
established by this supplied-envelope source trace.

## Checkout and exact source identity

T3 confirms this assigned worktree as
`/home/nathaniel/.t3/worktrees/openplan/t3-2873bd16`, branch
`t3/engagement-summary-native-prep-review`. Configuration reports provider codex,
model `gpt-6.1-sol`, reasoningEffort high. Git starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. No checkout movement, source join or
parent mutation occurs. The first shell read catches T3's initial branch-name
transition from `t3/2873bd16`; subsequent T3/Git reads agree on the review branch
and unchanged HEAD.

The author checkout `/home/nathaniel/.t3/worktrees/openplan/t3-c02aa002` is clean
at exact subject HEAD. The subject commit adds only its 13 preparation files.
Every working packet file equals its exact subject Git blob. All 12 entries in
its public SHA256SUMS match. All 22 selected source/guidance hashes match.
The ordered migration manifest matches all 423 working source hashes and the
exact ordered migration path set at the subject commit.

Subject, documentation base `cddcccde756ec8103175d32a0d9a554ba50bb13c` and source
candidate `6ca955851ba53437c68a171d523c2539184971e4` share application tree
`2b1916349d7379c96bf97b1708b3e4016d37384d`. Both source comparisons have empty
openplan diffs. SQL20 SHA256 is
`ee43c84154afb357a048b3035eb7d09939cd75c38b024c30700f574853d393e7`.
These are source identities, not installed-history or application approval.

Ownership covers only this NEW public directory and NEW private root
`/home/nathaniel/.local/state/openplan/engagement-summary-native-preparation-independent-20261016`,
created mode 0700. Both paths are absent before creation. No old corpus is copied.
The author private root is mode 0700. Its two named private metadata seals and
public packet seal match; this is a bounded metadata read, without recursive
private-proof inspection. `CANDIDATE_PINS.sha256` and `SOURCE_PINS.sha256` identify
the exact reviewed files. The candidate manifest pins the remaining checked
source hashes without duplicating that corpus.

## Independently checked literal construction

This review follows the literals and loops directly, without importing or running
the emitter, reader, oracle or production helpers. Agreement between their
outputs is not assumed to prove arithmetic or source compatibility.

- ordinary501 has 501 eligible primary rows at 101 cents. Multiplication gives
  50,601 gross cents. Its 501 one-cent retentions leave 50,100 net cents.
  Even indices 0 through 500 give 251 sent; odd indices give 250 paid.
  Excluding index zero leaves 50,500 billed cents. Ceiling 1,000 less 50,601
  gives remaining -49,601 cents. A new 203-cent draft projects 50,804 gross
  billed cents for the route warning. The already recorded draft is separate.
- maximum90 has 90 eligible rows at 99,999,999,999,999 cents. Multiplication
  gives 8,999,999,999,999,910 cents, below 9,007,199,254,740,991 safe integer
  cents. Removing one row gives 8,899,999,999,999,911 cents. There are 45 sent
  and 45 paid. Safe integer cents do not by themselves prove decimal Number
  roundtripping or actual SDK behavior.
- maximum1001 has 1,001 eligible rows at the same maximum amount. Multiplication
  gives 100,099,999,999,998,999 cents. Removing one row leaves
  99,999,999,999,999,000 cents. Even indices give 501 sent; odd indices give
  500 paid. This exceeds safe integer cents and the proposed 1,000-row detail
  cap. Neither fact establishes actual transport acceptance.

Every case adds four invoices and four lines. Primary draft is 203 cents,
primary void is 90,000 cents, second A-project sent is 777 cents and B-project
sent is 888 cents. Counts are therefore 505, 94 and 1,005 invoices and lines.
Including the two sent scope sentinels, raw status counts are respectively
(sent253, paid250, draft1, void1), (sent47, paid45, draft1, void1), and
(sent503, paid500, draft1, void1). Those raw counts differ from eligible primary
counts intentionally. Each line equals its header gross; ordinary eligible net
is 100 cents and retention one cent. All other retentions are zero.

The two independent ID spellings agree with the documented decimal recipe.
Kinds 0001/0002/0003/0010/0011 separate project/client/engagement/invoice/line.
Case digits 1, 2 and 3 keep cases distinct. First ordinary invoice is
`20261016-0020-4001-8000-001000000000`; final eligible ordinary is
`20261016-0020-4001-8000-001000000500`. Maximum90's last eligible index is 89;
maximum1001's is 1,000. Draft/void/second-A/B indices are respectively
501/502/503/504, 90/91/92/93, and 1001/1002/1003/1004. Every line uses the same
case/index and kind0011. Reverse emission does not change this independent set.

The reader checks exact invoice and child identities, status, scope, header
gross/retention/net, child gross and one line per parent in its seed model.
Its scalar mode separately checks engagement identity sets, zero missing/invalid
counts and the literal billed/draft cents. The 777/888 sentinels must first be
visible to the SAME legitimate dual caller. A caller-hidden value cannot prove
an exclusion. Separate observations do not establish one atomic artifact.

## Reachable retained source supports draft-first composition

Base `20260727000010_receivable_invoicing.sql:19–107` supplies the required
client, engagement, invoice and line fields and foreign keys. The four legal
invoice statuses are draft/sent/paid/void. Subtotal and line amount are non-null,
nonnegative NUMERIC(14,2). Each maximum row is 999999999999.99, within that
per-row typmod. No emitted per-row field stores an aggregate. Required-null,
negative, cancelled and overflow attempts remain separate expected refusals;
none becomes a fabricated valid contributor. Nonfinite behavior stays pending.

`20261017000005_money_integrity_corrections.sql:434–479` has no service/postgres
escape for inserting a child beneath an issued parent. The new emitter inserts
all draft headers, then all lines, reconciles draft amounts, then issues sent
rows and advances the paid subset from sent to paid. Void advances from draft
after composition. It changes no issued financial header or child. The paid
transition changes status/paid_date only; updated_at is trigger-owned.

The direct and child writer-policy migrations 20260728000006/000007 require a
writing membership, while retained SELECT policies permit workspace members.
The projects schema permits the emitted required fields and defaults. A dual
member can be an ordinary table writer under source policies; viewer cannot.
The distinct owner/admin/member/viewer and other caller recipes remain future
actor-builder work, not actors created by this packet.

The contract billing, closeout, source-deletion and evidence-revision migrations
remain relevant. No inspected new INSERT attaches a baseline, billing source,
time entry or closeout. The invoice carries a real synthetic engagement ID, so
native admission must establish the claimed absences for those engagements.
The source guards and revision side effects remain enabled. Source absence of
an INSERT into a related table does not establish its installed absence.

SQL20 retains STABLE, SECURITY INVOKER, no actor parameter, explicit membership
and engagement checks, workspace/engagement/excluded-ID predicates, sent/paid
gross and draft separation, text amounts/counts, and separate missing/invalid
buckets. Unknown scope raises rather than yielding complete zero. Its explicit
EXECUTE revocations/grant are source statements, not observed effective rights.
The prepared wanted-column census retains absent columns through left joins;
ACL selection retains raw null/default expansion. Actual roles, inheritance,
ownership, column rights, policies, definitions and current catalog remain open.

## Null, zero and unavailable remain distinct

Primary ceiling is 1,000 cents, second A ceiling null and B ceiling entered zero.
Authorized empty and recorded-zero phases use a new digit4 namespace and need
their own finite recorder and production-reader selection. Fixed main-case
reader modes do not accept those phases. Native required-null attempts cannot
stand in for a stored missing bucket. Supplied missing/invalid envelopes remain
explicitly nonnative where source storage forbids their construction.

Production reader source keeps missing/invalid buckets unknown, preserves a
readable peer, and makes named-RPC pending classification narrower than general
dependency, permission or transport failure. Scope echo errors and absent
requested summaries remain unavailable. `buildEngagementBilledPosition` computes
remaining only with readable ceiling and billed amounts. Money helpers retain
exact cents or strings; formatting keeps aggregate currency unassessed.
No USD invoice field establishes agreement or aggregate currency.

The Python comparator is a finite success comparator, not the production reader.
It rejects duplicate JSON keys but does not grade incomplete/error envelopes,
authenticate workspace labels, validate transport provenance or establish native
storage. Its line position comparison uses equality without an exact integer
type check, and its money regex uses Python digit semantics. Those checks do
not establish a general malformed-protocol validator. Its row mode receives
created_at but checks only invoice_date; the created_at tie assertion exists in
seed mode. Retain those limits when describing later controls.

Emitter OID validation uses exact int type, rejecting booleans, strings, floats
and nonpositive values. Exclusivity requires literal true. Known protected OIDs
are refused. UUID inputs are normalized through uuid.UUID; this is not a strict
original-spelling assertion. Cluster/database/receipt strings have nonempty and
pending-word checks, not authoritative ID/digest validation. The pending manifest
has null target fields and cannot pass. A caller-supplied nonempty manifest still
does not establish root authority, target identity or operation admission.

## Earlier evidence and current prerequisites stay separate

Original budget PREP-1 remains against original7c. R2 author0e8b and independent2822
correct its draft-first composition and foreign delivery/spend coverage; the
retained EOF exception and failed trials remain attached to those records.
Caller author700fc/independentc630 and controller91fb/fcf/independent7d remain
source-pattern references at 422/source3f/app44e, UNALLOCATED and UNADMITTED.
This review reads bounded source references, imports none, runs none and does
not rebind them to 423/app2b. Invoice sentinels replace neither budget sentinel.

The current native catalog attempt is FAILED and permanently fenced under the
latest task instruction. The author's earlier preparation-only catalog prose
does not describe a fresh successful observation. The separate catalog-source
fix child supplies no actual budget catalog, OBSERVE result or allocation here.
A0's actual SQL18 target OID6227945 is different and protected; root final audit
remains pending. The packet's earlier SQL17 label is dated context, not an
independently observed current target version. No M11 claim follows.

Prior author6ca/independentc9ed source dispositions and root145 cases, lint,
direction and full TypeScript at app2b remain dated external evidence. This
review reruns none and promotes none to native, SDK or browser acceptance.

Root still needs corrected exact packet bytes and independent disposition;
separately admitted source/history path and actual catalog; NEW exclusive
allocation with cluster/database/owner/lease custody; genuine actors and private
JWT provenance; installed helper and SDK/import closure; raw bounded HTTP/RPC
and ordinary committed row receipts; production-reader/format comparisons;
actual role/error controls; observed lock/commit MVCC; nonempty 422-to-423 upgrade
and separately allocated representative restore. Identified-build navigation,
desktop/390px, console and usable artifacts remain separate from source review.
Financial authority, agreement meaning and practitioner usefulness remain open.

Planner-writing, prove-it and Supabase/Postgres source guidance inform this
review. The explicit source-only restriction overrides runtime/network steps.
No test/guard is written or changed. No mutation, generator, readback, parser,
import, tests, dependencies, flock/manager, Docker, SQL, HTTP/Auth, helper/SDK,
browser, provider, build or direction dispatch occurs. No source metadata check
establishes runtime behavior. No push, PR, main integration or release follows.
The full V1 scope and sole roadmap remain binding; this lane selects no new work.
