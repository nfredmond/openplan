# Engagement summary completeness is acceptable at the source boundary

October 16, 2026. New independent final review. GPT-6.1 Sol, high reasoning.

## Bounded verdict

I accept exact candidate `6ca955851ba53437c68a171d523c2539184971e4`
at the independent source-review boundary. Its parent is
`95f46dc506b85e83bcbf84146f6cf8dafa4c5a65`; its application tree is
`2b1916349d7379c96bf97b1708b3e4016d37384d`. I find no P1 or P2 source defect
within this patch. This conclusion follows the SQL, reader and consumer trace,
not an inference from passing checks. One nonblocking metadata finding remains.

The implementation removes the identified dependence on an incomplete invoice
register and gives the other summary consumers an explicit complete-source
contract. Actual SDK truncation of the old uncapped queries remains
unestablished. This review does not establish that SQL20 parses, installs or
executes correctly, that deployed permissions work, or that financial totals
agree with an accounting system or agreement. No native admission, source join,
main change, publication or release follows this verdict.

I execute no subject, application dependency, test, compiler, lint, direction,
manager, lock, application import, SQL, HTTP, socket, browser, provider, build,
database or hosted operation. I request no new runtime window. Existing source
and retained metadata are sufficient for this bounded review.

## Exact ownership and evidence identity

The reviewer checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-ccc9b1b9`,
branch `t3/engagement-summary-completeness-independent-review`. Its initial
clean HEAD is `05dd3e8da4a4572437f06e771b0a2477873e681f`, application tree
`1e0b6522002b2485d37086790808c0217ff77cfe`. I do not move this checkout to
the candidate. Exact Git objects and the separate author checkout identify
the reviewed source.

I own only this new directory and the new mode-0700 private directory
`/home/nathaniel/.local/state/openplan/engagement-summary-completeness-independent-20261016`.
The author checkout `t3-80bd5760`, branch
`t3/engagement-summary-invoice-completeness`, is clean at the candidate when
inspected. Live T3 metadata identifies separate reviewer and completed author
tasks under root `1401bb6a-70e4-42eb-a1f1-98045485f8cc`, using provider
`codex` and model `gpt-6.1-sol`. No nested agents run.

I read the complete final author STATUS, NATIVE-PREREQUISITES, VALIDATION,
evidence, faults, selection, mutations, source diff, pins and metadata-error
records. I also inspect actual private grant, intent, harness/configuration,
runtime, manager stream, terminal, all selected test reports, transforms,
restoration and three focused-check terminal records. The postcommit handoff
is read separately because it sits outside the frozen private manifest.

All 14 public manifest entries match current files and exact candidate blobs.
The public manifest SHA-256 is
`921d91982ea11d4c2e6a7fc0d242c884faaa8fc038c78bda30b8414c76e77a69`.
The 2,879-entry private manifest SHA-256 is
`de1a15f30ef246a8a85eebd33f7680b85dbb3bef26b8040f994e9e088606e7e2`.
I rehash 130 selected entries from that private manifest, not all 2,879 files.
All selected entries match. No recursive copy or replay of old proof occurs.

All 22 source/configuration/test pins, seven preservation pins and 14 prepared
runner pins match current bytes. Source and preservation pins also match exact
candidate Git blobs. The saved source.diff equals the exact parent-to-candidate
Git diff for CHANGELOG and openplan with zero context. All 423 ordered migration
hashes match current source and candidate blobs. See [source pins](source-pins.json),
[evidence](evidence.json) and [validation](VALIDATION.md).

## SQL scope, absence and security

SQL20 adds one `jsonb` scalar function. It does not add a module, dependency,
actor argument, row cap or offset. The membership predicate uses `auth.uid()`
and the requested workspace. A supplied engagement must be visible in that
workspace before aggregation. A hidden, foreign or nonexistent requested
engagement raises `42501`; it cannot become an authorized zero summary.
An authorized visible engagement with no contributing invoices has zero gross
and draft buckets. The workspace snapshot can legitimately contain no visible
engagements; a separately requested missing summary still becomes unavailable.

The function states `STABLE SECURITY INVOKER` with a fixed search path. It
qualifies base relations and auth identity. EXECUTE is revoked from PUBLIC,
anon and service_role and granted to authenticated. No exception handler
rewrites permission or internal errors. No definer privilege, role switch,
base-table grant, policy repair, trigger disablement or existing function edit
appears in SQL20. Installed owner, role inheritance, default privileges, ACL,
SELECT permissions and RLS remain native questions.

I follow the source chain through the original workspace and receivable schema,
the workspace-members recursion correction, write-role restrictions, contract
access, retained invoice lifecycle triggers, SQL19 and function-grant precedent.
`members_read_own` exposes the caller's membership. Original engagement and
invoice SELECT policies use workspace membership; later viewer restrictions
apply to writes. A contract consultant grant alone does not satisfy this RPC's
membership requirement. SQL20 changes none of those mechanisms. Existing
single-workspace and engagement indexes support its predicates, but source
index presence does not measure runtime cost.

Both aggregate scopes constrain engagement workspace and invoice workspace.
A visible contributing invoice linked across workspaces causes refusal.
RLS-hidden records remain outside the caller-visible snapshot. The function
does not claim access to hidden money. Null engagement attribution is outside
an engagement's position. The explicit excluded invoice applies before sums
and is echoed; its value never authorizes another workspace read.

One aggregate statement constructs nested JSON inside PostgreSQL before API
row-set pagination. Amounts, invalid/missing counts and the legacy ceiling
travel as text. Sent and paid use gross subtotal; draft stays separate; void
does not contribute. Negative and nonfinite contributors receive invalid counts;
missing contributors receive separate counts. PostgreSQL numeric SUM avoids a
JavaScript per-row accumulation boundary. STABLE expresses snapshot intent for
the function's reads. Neither lexical review nor mocked fixtures verifies that
intent on an installed database or establishes whole-artifact atomicity.

## Reader and consumers preserve the distinctions

The reader receives `unknown`, validates the envelope, binds workspace,
engagement and excluded-id echoes, rejects duplicate/foreign identities and
requires the specifically requested engagement. A complete false envelope
retains its original error and stays unavailable. A malformed envelope cannot
produce complete zero money. Only narrowly qualified missing public RPC errors
become pending. Missing dependencies, permissions, internal errors and unknown
messages stay unavailable with their original code/message where supplied.

Aggregate text reaches the existing exact-money primitives without passing
through Number first. Counts use BigInt. A missing or invalid bucket stays null
with its reason while a readable peer survives. Entered zero, no legacy ceiling,
invalid ceiling and unavailable retrieval remain distinct. The small extracted
position composer reuses the existing arithmetic and does not fabricate invoice
records. Shared money, formatting, SQL19, project-budget readers and unchanged
exact-money tests retain their pinned bytes.

The dashboard starts a workspace RPC separately from its ordered 500-row invoice
register. Each engagement obtains its summary from that snapshot. An RPC failure
or absent entry becomes unknown, with no fallback to visible rows. The register
and its cap notice remain. This improves engagement positions; it does not make
every dashboard list or receivable headline complete.

POST keeps its existing authentication, workspace/client/engagement checks and
write authorization. It requests the prior summary before insert, with no
excluded id because the new invoice does not yet exist. It adds the new gross
subtotal once for the projected warning. Failed retrieval preserves the original
audit code/message and source state while authorized creation continues. The
successful response exposes pending/unavailable state, and the actual composer
discloses unknown prior/projected gross and no available ceiling comparison.
Bucket-invalid states remain separately audited. A complete source flag refers
to retrieval, not to valid money or approved agreement terms.

The shared PDF resolver now reads the position even without an entered ceiling.
It constrains the engagement to the invoice workspace. It passes no excluded
invoice, so recorded current status determines whether that invoice contributes
to billed or drafts. No synthetic invoice is appended and no second addition
occurs. Both the standalone PDF route and project evidence assembly reach this
resolver. Existing project/workspace constraints and invoice identity remain.
The HTML builder discloses pending/unavailable positions while retaining the
invoice artifact path. Actual renderer layout, generated bytes and delivery are
unobserved here.

The NTE bar receives null currency in its actual dashboard call. PDF and composer
retain the reviewed engagement formatter and unassessed-currency disclosure.
Actual invoice currency does not become aggregate or ceiling currency. Gross
sent/paid, drafts, retention, net receivable and cash stay distinct. Agreement
meaning, cross-invoice currency agreement, legacy ceiling basis, financial
reconciliation and concurrent-creation authority remain unassessed.

## Prior findings and remaining objections

| Finding or question | Independent response |
| --- | --- |
| Original 45-row nine-cent drift; correction 89237c0 | Existing exact-money behavior remains. This candidate changes retrieval and extracts composition; it does not repeat the original campaign or claim native arithmetic acceptance. |
| P2 currency objection at ab4a9f2; response 2b39558 and review 9876a97 | The original rejection remains historical. The corrected formatter/disclosure chain stays intact, and no current invoice currency is inferred for aggregates. |
| Dashboard's definite 500-row summary dependency | Removed at source. Its detail register remains capped and labelled. |
| POST/PDF retrieval completeness without an explicit cap/count contract | Replaced with scalar aggregation and validated scope/completeness. Actual prior SDK truncation remains unknown. |
| Hidden/nonexistent requested engagement becoming zero | SQL explicitly refuses it; the reader also rejects an absent requested identity. Installed RLS behavior still needs native evidence. |
| Current invoice counted twice or omitted | POST reads before creation; PDF reads recorded status with null exclusion. No extra invoice records are manufactured. Native status transitions remain unobserved. |
| Green guards overstating evidence | Retained controls establish the named assertions only. SQL guards are lexical; mock scalar corpora are not native retrieval trials. |
| Metadata timestamp precision, new `META-01` | P3, nonblocking for source. The public evidence terminal time is rounded; the exact sealed raw terminal remains authoritative. See VALIDATION. |

No unresolved P1/P2 source objection requires a new pure probe. Native SQL,
scalar SDK/HTTP precision, role/RLS/ACL, query cost, upgrade/restore, full configured
TSC on this candidate, identified-build browser and native PDF acceptance remain
open. Prior joined-base 420 selected tests, full configured TSC and lint do not
establish those tiers for this changed candidate. The separately preserved
512 MiB heap failure remains a failure.

SQL20 is source ordinal 423 and stays unapplied/unreleased. The existing SQL19
controller remains bound to its 422-file source and application
`44e638d6d79378042343bf5b18408f09ee991d57`. No implicit advancement or allocation
occurs. The budget target remains UNALLOCATED/UNADMITTED. R6 OID 6227945 stays
protected; failed R5 OID 6212363 stays fenced. Source419 OID 6072103, demo3000,
frozen215607, archives, canonical3 and inherited404 are not operated or edited.
These are custody constraints carried forward, not newly surveyed live states.

## Product and onward ownership

The full V1 contract, ROADMAP M11 and CORE-PM-01 remain binding. The review uses
planner-writing, prove-it and Supabase source guidance. Explicit source-only
scope controls over generic runtime/network skill steps. The memory registry
search returns no relevant entry. No memory supplies a finding.

All fifty states and DC, California depth, explicit territories, Tribal and
overlapping authorities, worldwide extensibility, free independent installation,
portability and responsible human money authority remain required. OWP/UPWP,
complete RTP updates, task/employee/deliverable management, engagement, capital,
grant/local-tax administration, procurement, provider choice and separate
AequilibraE/ActivitySim scientific acceptance are not narrowed by this patch.
No milestone, capability grade or release claim changes. Practicing-planner and
independent finance acceptance remain open.

Root owns all implementation follow-up, any exact-source native preparation,
runtime admission and later integration. This docs-only local checkpoint grants
none of them.
