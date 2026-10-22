# Provider scope remains narrower than broad Planner Agent chat

October 21, 2026. Source base: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
This note supports roadmap A0. It changes no capability grade, milestone,
provider permission, application behavior or release status. The full provider
choice and platform-wide agentic outcomes remain in the
[V1 contract](../../product/V1_PRODUCT_CONTRACT.md) and
[sole roadmap](../../ROADMAP.md).

## Source boundaries to preserve

The broad chat route at `openplan/src/app/api/assistant/chat/route.ts` still
checks Anthropic access, selects an Anthropic model and uses Anthropic cost
estimation. Its user-session tools share a per-turn budget and return proposals
through existing action validation. A provider change must preserve that
resource access and exact approval path. Existing project-task evidence does
not establish broad chat provider parity.

`provider-server.ts` defines the saved provider scope as workspace and project.
`provider-project-task.ts` version 1 exports only that selected project's own
fields. Its comment explicitly excludes unrelated workspace records, document
contents and chat history from implicit permission. Its output schema permits
an answer and a bounded project submittal proposal. Reusing that connection for
broader chat would require an explicit task and disclosure boundary. This note
does not authorize such an extension.

`provider-api-generation.ts` binds the saved API configuration revision, model,
packet digest, connection, attempt, charge acknowledgment and lease. It consumes
the invocation before calling the selected provider. The saved API transport
rejects streaming requests, tools, functions and tool choice. It requires a
single structured result and rejects returned tool calls. Those checks protect
the existing task. Removing them to reuse its fetch function for broad chat
would change that contract.

The connector selects its backend from the saved setup. It journals a running
attempt before generation, stores completed output before delivery and checks
returned provider, model and account mode. Broader installed-CLI work also needs
its existing interruption, same-attempt recovery and account boundaries. A new
transport must not introduce automatic provider fallback or another paid call
after an uncertain result.

## Current synthetic connector check

A private copy of all 51 tracked connector MJS and JSON inputs matches this
source base. `CONNECTOR_SOURCE.sha256` binds those bytes. The retained commands
invoke `/usr/bin/node` on Linux. A later root readback reports v24.22.0; its
version during these runs is not independently attested. The test file is
unchanged. Model execution uses the
file's synthetic callbacks. Its HTTP test uses an owned loopback server. No
installed provider, account profile, credential or external model is used.

| Stage | Result |
| --- | --- |
| Pristine full file | 27 pass, zero fail or skip |
| Harmless appended comment | 27 pass, zero fail or skip |
| Restored pre-fault file | 27 pass, zero fail or skip |
| Remove only returned-provider comparison | One intended failure |
| Separately admitted restored final file | 27 pass, zero fail or skip |

The fault removes only `generated.provider !== adapter.provider ||` from the
result check. The selected existing case is `Claude refuses another provider
result without saving its answer`. Its strict-equality assertion at test line
244 expects `failed` and receives `succeeded`. The failure is `ERR_ASSERTION`;
there is one selected case, no skip and no stderr. Root reviews that raw failure
before the final restored full run. Later assertions in that test are not
credited as additional mutation failures.

The first four-command controller returns zero in 3.075 seconds. The final
restored run returns zero in 1.015 seconds. Requested bounds are 1 GiB, zero
swap, one CPU, affinity 0, Tasks64, Node768 and private network/home/tmp. The
first unit has 120 seconds; the restored unit has 30 seconds. Reported peaks
are 52.5M and 45.5M, with zero swap. Both later units are collected, so final
resource counters and effective-property samples are unavailable. Expected
cgroups are absent, no owned process remains and all source bytes/modes/sizes
restore exactly. No shared compiler lease or dependency operation occurs.

This establishes the selected synthetic provider-identity refusal. It does not
establish live CLI or account operation, every provider protocol, complete
connector fault coverage, arbitrary failure safety, broad-chat permission,
actual model quality, browser reachability, hosted operation or A0 completion.

## Follow-through under A0

Before implementing broader selection, map each chat context and tool result
to an explicit provider disclosure and task version. Preserve old project-only
connections and tokens. Reuse the existing action registry and approval server;
do not copy their write rules into a backend adapter. Retain the selected model,
authentication mode, configuration revision, packet and attempt identities.
Unavailable price or capability evidence must remain unavailable rather than
zero or a silent fallback.

Streaming and tool-loop support need a purpose-specific protocol that preserves
network policy, source custody, cancellation and error frames. Existing strict
project-task request and response checks remain intact. Installed CLI adapters
need their own supported protocol and recovery evidence. A matching answer
schema alone does not establish tool parity. This is unfinished engineering
scope within A0, not a new roadmap or module.

Relevant later checks include harmless and wrong-behavior controls for changed
guards, actual database access/custody, supported API and native-account cases,
interruption recovery, unchanged exact approval enforcement, identified desktop
and 390px journeys, and usable artifacts. Keep technical, browser, hosted and
scientific claims separate. No existing V1 requirement is closed by this note.

## Retained local evidence and reproduction

Raw TAP, source descriptors, admissions, terminal and post-terminal records:
`/home/nathaniel/.local/state/openplan/a0-provider-identity-control-20261021-01/`.
The raw result and local paths are retained evidence, not an independently
available public artifact bundle.

For the unchanged file, from a separate checkout at the source base:

```sh
node --test --test-reporter=tap workers/planner_agent_connector/test/connector-worker.test.mjs
```

Run mutations only in an owned private copy. Save original bytes and mode,
observe the harmless full-file survivor, apply the single comparison fault,
select the named case with `--test-name-pattern`, inspect its exact assertion,
restore the saved bytes and mode, then rerun the full file. Preserve failures
and confirm source digests and owned process termination. This recipe does not
supply real-provider credentials or authorize external spend.


## R62 prepares current-head CI census repairs and stops at private accounting

October 22, 2026 UTC. The isolated repair checkout fast-forwards from canonical
05dd3e8 to exact PR365 head 2ab80e0, using a local read-side fetch from the R57
checkout. Completed jobs 119668675514 and 119668675563 are fetched once each and
sanitized before private retention. Both test merge 95bbd864 against main945a78b;
its tree equals the current head tree. Both report the same two stale census
assertions, 302 expanded policies against 286 and 290 permissive write policies
against 278. Each reports 24,161 passed assertions and 1,722 skipped assertions.
The shuffled seed is 239440. These matching failures do not establish order
dependence. Historical R49 logs are read locally and are not fetched again.

Only the two maintained offline guards change. They preserve the predecessor
286 expanded policies and 278 permissive writes, compare every retained
predecessor policy record, and account for migration430's exact additions by
policy identity, command, kind where applicable, and addressed role. The totals
remain equalities, 286 + 16 and 278 + 12. Existing workspace/role classifiers,
writer gates, refusals, source parser and all production bodies remain exact.
All 430 SQL bodies, original authority bodies and package/lock remain protected.
No production/security authority repair is inferred from these stale assertions.

The focused serial Vitest invocation exits zero with nine passes, three live
cases skipped and no failed, pending or todo case. The private result reader
then asserts the wrong status category, expecting those skips as pending. It
fails after the subject run. The phase stops without retry. The finally block
records exact byte/mode restoration; no temporary mutation has run. The failed
driver, reports, initial raw index, source pins and proposed private accounting
correction remain in a0-current-ci-repair-20261022-r62. Harmless-survivor,
named-fault, restored cohort and scoped lint checks remain unrun. No completed
CI repair or configured-typecheck acceptance is claimed.

Private exact-lock npm ci completes in this checkout with 969 packages and the
existing install-script restrictions. Direction check passes with its existing
review reminders. No compiler, build, DB, native/HTTP, browser, worker, model,
provider command, commit, push, PR-body change, CI rerun or watch/poll occurs.
Root owns review, correction admission, compiler coordination and the eventual
exact-head join and push. Release preparation61 remains separate. R60's named
synthetic 1440/390 journey retains its two unread reconcile bodies and 161 abort
limits. Full A0, all 19 contexts, real APIs, installed backends, science and v1
remain open; broad/production profiles stay CLOSED.


## R62 continuation 01 completes admitted source controls and configured types

October 22, 2026 UTC. Root accepts the R62 three-file census repair at source
tier and admits this continuation in the same isolated checkout at exact
2ab80e0. The original R62 packet, driver and post-test skip-classification
failure remain unchanged. The private reader now expects the actual three
skipped live cases and zero pending cases. Readback validates the retained
nine-pass baseline without another baseline invocation. No live skip receives
pass credit.

The harmless source comment survives. Removing the parsed seventh source
policy fails the exact expanded-policy roster. Removing the parsed chat usage
INSERT fails the exact permissive-write roster. Substituting authenticated for
the parsed turns custody role, with both counts unchanged, fails both named
rosters. These temporary output mutations affect only the maintained source
inventory helper in this owned tree. Each restores exact bytes and modes.
No SQL, installed policy, role or production body is mutated.

The restored five-file ordinary cohort passes 51 cases with three live cases
skipped, no failures, pending or todo cases. Scoped two-file ESLint and diff
checks pass. The three fault invocations exit one for the intended named
assertions; they are sensitivity evidence, not passing product baselines.
The predecessor counts remain 286 and 278, with exact 16 and 12 additions.
All source classifiers and protected contracts remain unchanged.

A fresh immediate census finds no competing compiler/build. The one admitted
configured typecheck runs from this checkout's openplan package with
node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit
--incremental false -p tsconfig.json --pretty false. It starts at
07:03:39.880655 UTC and exits zero at 07:04:39.917524 UTC, after 60.037 seconds,
with empty stdout and stderr. The exclusive compiler slot releases immediately
at its terminal. next-env.d.ts and generated .next types remain absent, valid
inputs for this configured check. No declaration is generated, copied or
borrowed. This result does not replace a later final Next build with its actual
generated declarations.

No install, new baseline repeat, compiler repeat, build/typegen, DB, gated
native/HTTP, browser, worker, model, provider, CI, commit, push or PR-body action
runs. Original R62 failures and all source pins remain preserved. Root owns
final review, source/index joining, separate committed metadata017fa89c, the
final identified build and the corrected PR365 head push. Metadata is not
integrated or released here. Offline source controls do not establish installed
SQL/RLS or runtime authorization, provider, scientific or release acceptance.
R60 keeps its named synthetic journey and unread-body/abort limits. Full A0,
all 19 contexts, real providers and installed backends remain open. Broad and
production profiles remain CLOSED.


### Root R64 source admission and exact-head push

Root reviews the two census repairs, retained predecessor records and exact new
policy identities/roles, harmless and intended fault frames, restored51 passes
with three live skips, and the single configured typecheck pass. Production,
all430 SQL and original authority bodies remain unchanged. R62 raw-index cached
timestamp failure remains recorded; root separately restores its captured raw
preimage after staged-entry equality. The writer remains unassessed. This is a
new source checkpoint for fresh CI, not a relabeling of failed2ab jobs or a new
R60 browser run. R60 retains its original build/transport limits.
