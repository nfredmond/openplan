# Retained context execution

September 30, 2026. This verified checkpoint follows main `bf9f0b89`.
Published and installed v0.65.0 remains unchanged. Migration
`20261014000039_engagement_synthesis_context_execution.sql` is installed in the
owned isolated stack `openplan-restore-target-2026091050`. It is not installed in
the demo. The additive upgrade preserves counts and sorted-row hashes across
11 retained tables. The isolated stack now has 358 migrations.

The candidate reuses retained generation authorizations, attempts, dispatches,
outputs and selections. A private immutable input table preserves each dynamic
task and its predecessor attempt, selection, original capture hash and proposed
result hash. A native dispatch checks the complete selected predecessor chain,
current requester membership, provider configuration, cancellation and resource
authorization. An old dispatch receipt does not authorize another provider call.
Original output delivery remains available after cancellation or access loss.

Native code preserves opaque task bytes. It does not establish that a task follows
the frozen context recipe, reproduces its original source or correctly derives
the previous result. Application reconstruction checks those separate boundaries
before the worker claims or dispatches a context task.

## Fixed parent history

The service reader obtains a parent's retained selection snapshot through the
child's current requester authority. The immutable child request fixes the parent
and selection sequence. Parent cancellation or author departure does not renew
parent execution or erase its retained inputs. Each page checks current child
authority. The reader does not impersonate an authenticated staff member.

Application readers keep the original parent receipt actors, exact response
captures and existing grant, dispatch and source checks. The same private join
supports current segment reads, authenticated staff history and child-scoped
parent reads. Native access and application reconstruction protect separate
boundaries.

## Worker input reconstruction and transport

`loadSynthesisContextWorkerInputs` reads the child request, obtains current child
scope through the native plan command, and reads its fixed parent snapshot. It
checks original parent responses through the existing grant, dispatch and capture
reader. It then rebuilds the complete context content and staging chain from the
retained source. Every original frame must equal its reconstructed bytes, hash
and byte count. Every safe reference must name that exact frame and match the
reconstructed chain and cumulative size. Reference hashes describe reference
JSON; frame hashes describe original content. Cancelled or unsealed plans refuse
execution preparation.

`createSynthesisContextApiAttempt` uses the separately frozen context recipe
through the existing response-retaining transport. Context and segment adapters
reject each other's recipes. Context task identity must name the bound request
and continuation header. The transport retains the original HTTP response before
interpreting it and permits one invocation per freshly constructed attempt.
The adapter tests use a local synthetic HTTP provider and constructed dispatch
receipts. A separate native HTTP journey joins the worker to PostgreSQL,
PostgREST and Kong, as described below.

## Predecessor replay and durable execution

`loadSynthesisContextWorkerJob` replays every preceding frame from its selected
original response. Selection pages retain one sequence anchor. Each replay checks
the original grant, attempt, exact dynamic task, dispatch limits and original
capture. Predecessor pins include both the selection identity and original capture
hash. A new selection of unchanged bytes still changes the dependency. The pure
continuation processor checks response completion, complete frame coverage and
preservation of earlier notes and uncertainty before constructing the next task.

The shared worker records context mode before claiming a task. Segment and context
entry points reject each other's pending and recoverable temporary journals.
Context execution uses its own claim, dispatch and current-status commands and
frozen recipe. Original response retention uses the existing delivery command.
An unknown dispatch stays unobserved. An observed response resumes delivery with
the same bytes and no fresh provider call.

The native HTTP journey executes every frame through the context worker. It loses
the first successful output acknowledgement, resumes the original and completes
the continuation. It then cancels the request, revokes staff access and redelivers
the last saved response without a new provider call. The local synthetic model
supplies deterministic structural output; this does not assess interpretation
quality. The single-task context function has no CLI selector yet, and the
segment scheduler does not schedule dependent context frames.

## Retained evidence and next work

The recovery checkpoint and private logs under
`~/.local/state/openplan/approval-resume-2026-09-27/` retain test outcomes,
source hashes and initial failures. The two reader files pass 93 tests. A harmless
source mutation passes, and ten targeted faults fail for the asserted reasons.
The initial 30 native execution cases pass after recovery. Additional parent
snapshot probes cover nonempty pagination, later choices, parent departure,
child revocation and scope corruption. Their first run exposed a fixture that
tried to remove the workspace's last owner. The corrected fixture transfers
ownership before testing child revocation, preserving the owner-floor guard.
The corrected suite passes all 43 native cases, including both harmless controls
and eleven parent-reader faults. These structural fixtures do not establish the
validity of provider interpretations.

The input-loader suite passes 34 cases. Its harmless control passes and all
30 targeted mutations fail. The original-frame replacement probe initially
changed no text because it selected a frame without the named string. The
corrected fixture locates an actual retained string before replacing it. A
combined fault removes byte equality and its checksum backstop to test a
self-hashed replacement. The API suite passes 39 cases, including eight context
cases; its harmless control and nine targeted faults behave as expected.
The final related run passes 301 tests across eight files, including existing
segment workers and process recovery. TypeScript and focused lint pass.
[Candidate proof](context-execution-proof.json) retains source and log hashes.

The predecessor loader passes 53 cases. Its initial mutation run exposed a
masked dispatch-expiry probe: a later frame's dependency rejected the altered
capture even when the expiry check was removed. The corrected probe changes the
last predecessor, isolating the asserted limit. Worker recovery passes ten cases.
A harmless worker mutation survives, while 12 routing, journal-mode, task-pin and
current-authority faults fail for their stated reasons. Initial schema mutation
selection tested policy counts instead of relation counts and survived. The
corrected selection exercises the relation inventory; both runs remain retained.

Installed native execution and parent-history probes pass 43 cases. Trusted
function paths and release ordering bring that run to 55 cases. The initial
release-ordering failure identified the missing migration39 changelog entry,
which is now present. The native HTTP journey passes separately. Fresh TypeScript
and 97 focused schema, loader and worker checks pass after the crash report.

Full candidate QA passes, including lint, dead-code checks, 16,563 tests,
provider-connector checks, zero reported dependency vulnerabilities and the
production build. Shuffle seed `650939` also passes 16,563 tests. Both ordinary
runs skip 1,165 tests, including opt-in live checks. All 52 Python worker suites
pass. The full isolated database run passes 1,069 tests, with 125 skipped, across
77 files in 1,705.96 seconds. It includes the native HTTP journey and mutation
probes. Exact checkpoint CI and its populated previous-release upgrade remain
pending. Recheck them before any new release. No current result proves
interpretation quality, billing, browser usability or physical power-loss
recovery. Context CLI scheduling, staff proposal import and the complete M9b and
V1 requirements remain open.
