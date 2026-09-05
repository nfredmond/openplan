# Browser-only tester startup and release continuation

This supplements the September 5 release records. No v0.44 tag exists yet and
the complete twelve-job outcome gate is still outstanding.

## Application proof before the harness correction

Clean `fe17ad3d147fcfcf172d21cec30c62ac1ecbf8db` passed local `qa:gate`: 12,848
app tests, 132 live-RLS tests, production dependency audit, lint, dead-code
policy, and build. CI 33944133632 and live RLS 33944133630 passed. The prior
v0.43 populated-database upgrade rehearsal 33943434653 passed on `1775c472`;
no migration has changed since that rehearsal.

The actual Oregon plan created by the interrupted outside-California journey
was reopened through sign-in and visible Land Use Plans navigation. At desktop
and 390px, the no-source-review-established warning is visible and the false
dated claim is absent. Console errors were zero and document width matched the
viewport. Main-agent screenshots are retained under
`~/.local/state/openplan/release-checks/v044-2026-09-05/plan-source-review/`.
The public-page no-source branch has component regression coverage but not yet
an independent browser journey. No existing published neutral exercise was
available to reuse. Do not claim that branch is browser-verified.

## Infrastructure failure, not a product outcome

Run `2026-09-05T04-22-32-440Z` ended its first job after 38 seconds without
opening a browser or creating the shared test account. The agent explicitly
reported unavailable browser tools and saved `outcomeReached: no`. Its wording
escaped the narrower infrastructure classifier, which called execution
completed. The outcome gate still failed closed; this was never a pass.
The run was stopped during its second job because later jobs depend on that
missing account. Evidence was preserved. The following correction changes
tester startup and infrastructure classification, not the twelve planner tasks
or any outcome requirement.

The installed CLI is Codex 0.150.1. Current official documentation says optional
MCP servers receive a one-second initial catalog grace period, while required
servers use their startup timeout and fail session startup if initialization
fails. The harness now marks its browser server required. See
[OpenAI's MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

A live probe with an intentionally nonexistent required browser executable
failed before `turn.started`, naming the browser initialization failure. A
ready-server probe with only the startup correction still reported unavailable
tools. Startup timing alone therefore did not explain every failed attempt.
The prompt now explicitly directs discovery of deferred browser tools before
declaring them absent, including code-mode catalog discovery when available.
It still forbids shell, web search, and repository access, and supplies no
OpenPlan routes, UI labels, or implementation knowledge beyond the existing
task. Two subsequent ready-server probes actually completed browser navigation
to `about:blank` and returned snapshots. The repeated check inspected successful
MCP call events and tool results, not merely tool names in agent prose.

The classifier now recognizes the observed unavailable-tools wording and the
actual required-server startup error. Browser page text containing those words
does not become agent infrastructure evidence. Required startup is a mechanism;
the discovery instruction is still model-dependent and must be judged by the
subsequent real journeys, not assumed reliable from two probes.

## Check controls and remaining work

The new startup and classification tests failed against the old harness. A
harmless comment survived. Making the browser optional failed the startup
configuration assertion; restoring the old classifier failed the observed
unavailable-tools case; removing deferred discovery instructions failed the
prompt contract. Every mutation was restored. The discovery, evidence,
regression-outcome, and independent model-download verifier suites passed.
These tests cannot establish actual planner completion or universal MCP
availability. The complete clean-build twelve-job run remains required.

Live probe evidence is preserved in `/tmp/openplan-v044-browser-required-proof-CKqG54`
for missing startup, `481Ahz` for the first unsuccessful ready-server attempt,
and `kEsXkL` and `SiZUux` for successful browser calls. Logs and the probe script
remain under `/tmp/openplan-v044-browser-startup-*`.

To collect useful evidence without repeatedly restarting setup, subsequent
discovery may finish the twelve jobs before non-destructive findings are fixed.
A confirmed blocker still prevents release. Data-loss or isolation risks still
require immediate interruption. No result is relabeled from partial or missing
to reached. Scientific defaults, frozen studies, and holdouts remain unchanged.

## Correction to mutation restoration

After this record was first committed, the final test exposed a restoration
error. The mutation replaced the discovery instruction with an empty string;
its reverse patch matched an earlier empty string in the exercise-only adoption
fixture. The final test correctly failed because the actual prompt still lacked
the instruction. My command sequence nevertheless made local commit `f1cf0148`.
Nothing was pushed and no journey consumed those bytes. I disclosed the error,
restored both exact locations using surrounding context, and reran the checks
before continuing. The earlier statement that every mutation was restored was
premature. Future mutations use a unique replacement marker, not an ambiguous
empty line. No generated or stored adoption record changed.
