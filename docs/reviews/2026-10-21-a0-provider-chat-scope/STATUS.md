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
