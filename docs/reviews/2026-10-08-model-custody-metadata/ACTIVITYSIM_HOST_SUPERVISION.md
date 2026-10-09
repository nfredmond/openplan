# ActivitySim host supervision, October 8, 2026

The ActivitySim CLI and HTTP wrapper now accept explicit operator resource limits
for supervised host commands. Both limits are required and must be positive
integers. Linux process descriptors, cgroup v2 and a working user systemd manager
are required. An unavailable supervisor fails execution; it does not fall back
to an unsupervised command. Existing calls without these options retain their
previous execution mode. This is an opt-in host execution checkpoint.

## Operator configuration

For the worker CLI, add `--host-memory-bytes <bytes> --host-tasks <count>` to an
otherwise configured `main.py` invocation. For the HTTP wrapper, set
`ACTIVITYSIM_HOST_MEMORY_BYTES` and `ACTIVITYSIM_HOST_TASKS` in the operator's
environment. Request bodies cannot select or override those limits. Choose
limits for the actual installation and workload; the 128 MiB and 16-task values
in tests are synthetic fixtures, not native ActivitySim sizing guidance.

Host supervision refuses the configured container-image backend before bundle
access. The worker image does not supply a host user systemd manager. Operators
must not infer that a supervised Docker client controls its daemon's workload.
Unsupervised container execution remains a distinct existing mode, with its
lifecycle work still open.

## Execution and retained evidence

The shared owner guard runs in an independent user scope. The engine scope binds
its lifetime to that guard and enforces explicit RAM/task limits and zero swap.
The command waits at a startup gate while its runtime writes private, exclusive,
fsynced launch and scope records under the run stage's `host_supervision/`
directory. Records contain a command hash rather than raw command arguments.
Existing command logs remain in the runtime output directory.

Only then does the runtime authorize the command. Completion waits for the whole
scope, including detached descendants, to become empty. An observed-exit record
retains the return code and leaves scientific acceptance unassessed. No database
status or recovery authorization is inferred from that record. Owner loss stops
the scope through the independent guard; it does not manufacture a completed
runtime summary or graceful-close evidence.

## Verification and limits

The live tests launch the actual worker CLI and runtime with a synthetic command
and detached child. They verify normal completion after separately releasing the
child, retained log bytes, and owner termination that stops both processes with
no exit receipt or completed runtime summary. HTTP tests verify operator limit
forwarding and reject request attempts to override execution configuration.

`prototype/verify_activitysim_host_controls.py` and its JSON report retain
harmless/restored passes and four detected faults: missing owner binding,
ignoring live descendants, bypassing container refusal, and dropping the HTTP
operator's memory limit. The report hashes all three changed production files.
All 51 ActivitySim suite tests pass with live scopes enabled, and the six HTTP
boundary tests pass separately. The isolated test output remains outside the
repository.

This does not prove native ActivitySim execution under interruption, container
lifecycle custody, service restart/recovery, durable database attempt ownership,
scientific validation or practitioner acceptance. The poll worker still stages
preflight work; managed dispatch is not enabled by this change. Arbitrary
operator commands that delegate work to external daemons are outside the host
scope's descendant boundary. Follow-up must join these remaining boundaries
without promoting this synthetic case into a scientific acceptance claim.

## Native execution follow-up

A subsequent serial campaign ran installed ActivitySim 1.5.1 through this worker's
actual CLI and supervised runtime. It copied the retained development bundle for
Broomfield County, Colorado (08014) into private proof directories. The only
configuration change set the household sample from all households to 100.
Stock coefficients and the stock configuration digest remained unchanged. This
case did not read or reopen an acceptance holdout.

The baseline, harmless run-label control, and restored case each reached the
native `school_location` step before the proof runner killed its own runtime
owner. Each owned engine scope then became empty. Retained logs contained
15,523, 15,524 and 15,524 bytes respectively. None produced an observed-exit
receipt, runtime summary, or final trip file. A control omitting owner termination
completed every runtime stage and wrote 779 trip rows. An earlier owner-alive
pilot also completed with 779 trip rows.

The runtime verified a 1.5 GiB RAM cap, zero swap, and 32-task cap. Compute thread
environment settings were one. The successful control's native log reported
529.3 MB high-water RSS; that is a process report, not total host memory or an
ActivitySim capacity recommendation. The four scopes were observed empty after
cleanup. Hashes over every source-bundle file matched before and after the
campaign.

`prototype/verify_activitysim_native_owner_loss.py` and
`prototype/activitysim-native-owner-loss.json` retain the procedure, cases,
source/worker hashes and live scope identities. Private complete evidence is in
`~/.local/state/openplan/activitysim-native-host-controls-20261008a/`; the earlier
pilot is in `activitysim-native-host-20261008a/` under the same parent.

This supersedes the absence of any native interruption case stated above. It
proves one sampled development execution, with a logged native step before the
kill; it does not identify the exact machine instruction at interruption. It
proves neither full-population capacity nor restart, continuation, graceful
project closure, container custody, nationwide use-specific accuracy or human
acceptance. The 779 rows demonstrate runnable output, not plausible local travel
behavior or an independent acceptance result.
