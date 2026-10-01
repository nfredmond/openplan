# v0.66.0 context execution release candidate

September 30, 2026. Candidate package version is 0.66.0. Published and installed
v0.65.0 remains unchanged. This document does not declare publication. The final
release commit, passing exact-commit CI and tag still need to be recorded.

## Release scope

The increment joins retained selected responses to bounded context frames and
executes dependent context tasks through the local CLI. It preserves original
source bytes, selected predecessor identity, exact provider responses and explicit
resource authorization. Staff history can read retained parent results after the
original requester leaves, without renewing that requester's execution permission.

The context coordinator saves its task list, respects grant allowance and explicit
retry scope, and reuses single-task journals. An unknown dispatch stops before a
successor. An acknowledged response can recover its original database custody
after cancellation, expiry or access loss. Current permission remains necessary
for every fresh claim and dispatch. The operator sees retained outputs,
unobserved dispatches and tasks left outside or unprocessed within the schedule.

Use the [runbook](../../../openplan/docs/ops/RUNBOOK.md) commands with an existing
native resource authorization. This remains an internal operator workflow. It
adds no staff generation interface, automatic grant, machine-draft import or
public publication. Retaining all scheduled responses does not establish a valid
interpretation or complete campaign synthesis. Source records and scientific
claim tiers remain unchanged. The pending reminder constraint remains untouched.

## Upgrade boundary

Apply all migrations before using the commands. Four follow v0.65.0:

- `20261014000036_engagement_synthesis_generation_history.sql`
- `20261014000037_engagement_synthesis_context_requests.sql`
- `20261014000038_engagement_synthesis_context_plans.sql`
- `20261014000039_engagement_synthesis_context_execution.sql`

The candidate contains 358 migrations. Preserve database backups, configuration
and the private synthesis worker directory. Use additive migration up. The
isolated migration39 upgrade preserved counts and sorted-row hashes across all
11 existing synthesis tables. Exact main `eecdeadd` also passed the populated
v0.65.0-to-main upgrade with unchanged seed counts. The final release commit's
upgrade run remains required.

## Engineering evidence

[Context execution](CONTEXT_EXECUTION.md) and its retained proof describe original
frame reconstruction, selected predecessor replay, native access checks and the
shared durable worker. Main `eecdeadd` passed full local QA, shuffle, isolation
and Python worker suites. Its exact GitHub CI `36803171400`, isolation
`36803171399` and populated upgrade `36803171402` all passed.

[Context scheduling](CONTEXT_SCHEDULING.md) describes the follow-on candidate.
The authority reader passes 41 focused cases and its harmless control plus
18 targeted faults. The scheduler passes 34 focused cases and its harmless
control plus 23 targeted faults. Native CLI tests cover complete processing,
lost output acknowledgement, single-task recovery followed by saved-schedule
resume, whole-schedule redelivery after revocation, and unknown dispatches that
leave one attempt without a provider call or successor claim.

The native harmless control passes both output and dispatch cases. Disabling the
context selector fails the assertion that the intended acknowledgement was lost.
Removing the unknown-dispatch stop changes the required partial exit into a
refusal when the next worker checks its missing predecessor. The worker's own
predecessor check remains a separate protection. All mutation sources are restored.

The Python worker run passes all 52 suites. Initial full QA and shuffle both
found a missing environment example for the synthesis work directory. The
example now includes it, and all six documentation-reference checks pass.
The isolated database run reached the unchanged five-minute native output
recovery limit after retaining 103 of 124 frame outputs. Investigation remains
open. Corrected full QA passes 16,641 tests with 1,166 skipped, plus lint,
connector checks, dependency audit and production build. Shuffled and full
isolated database checks remain pending.
The existing GitHub isolation and populated-upgrade workflows will also check
the candidate without a PR. Local runtime failures remain in the evidence record.
The final release commit must pass GitHub checks before tagging. No new browser
interface is claimed by this increment. The local synthetic model proves
structural custody and recovery; interpretation quality, real provider billing,
practitioner usefulness and physical power-loss recovery remain unproved.

## Remaining work

Complete staff generation and explicit proposal import into a new review revision.
Retain source-to-theme-to-response-to-decision evidence and preserve conflicting
and minority input. M9b and the complete V1 contract remain open, including all
required jurisdictions and independently validated AequilibraE and ActivitySim
uses. The release does not narrow those requirements or impose a human gate on
software publication.
