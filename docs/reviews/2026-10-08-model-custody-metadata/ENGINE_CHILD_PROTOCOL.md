# Engine child protocol decision

Date: 2026-10-08. Inspected implementation: bc753e52.
Status: implementation decision; protocol not connected or accepted.

This develops M3 attempt ownership and recovery within the current roadmap. It
changes no scientific acceptance rule, geography scope or v1 requirement.
`product:direction:check` passes with existing expired-registry and intervening
change reminders. This document does not reset those reviews or create a queue.

## What the current code requires

The subprocess helper proves a launch reservation and observed exit, not a
complete assignment boundary. `main.stage_assignment` still needs the following
operations after the managed predecessor copies have been prepared:

| Operation | Current implementation | Required owner |
| --- | --- | --- |
| Project and package paths | `project_work_directory`, `package_work_directory` consult the bound writer | Parent verifies identities; child receives the declared paths |
| Fresh output directory | `create_assignment_output_directory` calls the writer's exclusive creation method | Parent reserves it once |
| Run configuration | `sb_get_run` performs a direct service-role read | Parent validates same run/workspace and returns the necessary fields |
| Count acquisition | `auto_ingest_counts` starts `build_expanded_aadt_counts.py` with a timeout | Supervised preparation, before count manifest confirmation |
| Count retention | `retain_assignment_counts` copies files and registers `model_count_inputs` through the writer | Parent confirms the manifest before engine computation |
| Progress | `sb_patch_stage` calls `writer.patch_stage`; uncertain writes must propagate | Parent performs the retained command; child waits for its acknowledgement |
| Numerical assignment and diagnostics | AequilibraE project, graphs, matrices, calibration and select-link calculations | Child operates on the declared working copies |
| Result and completed files | Current function returns a dictionary and writes output files | Parent may inspect only after confirmed child termination and file checks |

This table follows direct calls and the count-acquisition/retention helpers. It
is not a complete transitive inventory of every optional provider or library
side effect. That inventory remains necessary before claiming a no-egress or
sandboxed engine profile.

Two source facts rule out shortcut designs. `AttemptWriter` belongs to one
invocation thread and checks its command journal; a background thread must not
receive an unfenced substitute. Importing `main` loads local dotenv files, so
merely deleting credentials from a subprocess environment does not establish
credential isolation. `auto_ingest_counts` also starts another process; observing
only the engine leader's PID is insufficient for completed-file capture.

## Selected implementation boundary

Keep the single authoritative managed writer in the parent invocation. Use one
private, inherited live channel for the admitted child. Do not implement a
saved-request CLI that can reconstruct computation from an exit or claim receipt.
The launch reservation precedes process creation, and a lost parent or broken
channel leaves the attempt requiring reconciliation.

The first channel implementation must permit only assignment-specific operations:
read the claimed run configuration, resolve the already confirmed paths, request
count preparation, and append stage progress. The parent derives run, workspace,
stage and attempt from its bound context, not from identifiers supplied by the
child. It must reject arbitrary table names, URLs, SQL, filesystem paths and
terminal-state updates. Each message needs a bounded frame, protocol version,
monotonic sequence and one matching response. EOF, malformed data, duplicate or
out-of-order messages stop execution. Error responses must not include credentials
or provider response bodies.

Parent processing stays on the writer's owning thread. Engine callbacks wait for
a confirmed response before continuing. The parent stops accepting later child
requests after uncertain delivery. Receipt recovery remains the existing command
recovery operation and never reopens computation. A result message is provisional:
it cannot mark the stage succeeded, register completed output or bypass pending
commands and ownership checks.

Extract the engine entrypoint so it does not load operator dotenv files or call
legacy database transports. Pass explicit resolved numerical settings and retained
inputs. Preserve original source metadata, source availability distinctions,
calibration opt-in, separate demand methods and the same network/settings evidence.
Do not silently disable count acquisition, optional calibration or the ActivitySim
assignment to make the child easier to run.

A private channel is not an operating-system sandbox against same-user code.
Before completed capture, the supervisor also needs an owned containment boundary
covering descendants, including count-fetch processes. A child that creates a new
session must not escape the completion check. The existing process-group probe
cannot establish that. Evaluate the existing Linux service/cgroup supervision
patterns; require explicit owned handles and avoid terminating unrelated work.

## Required evidence before dispatch activation

Use a real child and parent handler to demonstrate ordered requests, exact context,
normal progress, response loss, malformed frames, replay refusal and parent loss.
A database write committed before response loss must retain its command and receipt
recovery path, without a second computation or contradictory terminal write.

Then exercise the actual assignment entrypoint with the channel, retained inputs,
a native synthetic network and separate-process output reopen. Confirm that a
provisional result followed by failed exit cannot publish success. Test surviving
and detached descendants, engine interruption, changed working paths, changed
output bytes and supervisor restart using owned disposable processes.

Finally run setup, assignment, artifact extraction and the separate ActivitySim
handoff against the isolated native stack. Verify both normal dispatch entrypoints,
restart/cancel, long-running liveness and retained local-byte recovery. These checks
remain distinct from untouched scientific acceptance and planner/public-participant
acceptance. No existing green helper test closes those requirements.
