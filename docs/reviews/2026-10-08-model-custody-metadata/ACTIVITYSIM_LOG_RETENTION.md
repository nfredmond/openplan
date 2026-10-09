# ActivitySim log retention, October 8, 2026

ActivitySim previously buffered command stdout and stderr in the runtime owner.
Its log did not exist until the command returned. Killing that owner lost already
flushed output. Reading a 4,000-character tail also loaded the whole log; the
regression fixture measured 18,332,254 bytes of Python allocation.

The runtime now directs stdout and stderr into one binary log before starting
the command. Output follows merged stream order. The tail reader reads at most
four bytes per requested character and retains the final decoded characters.
Missing and empty logs return no text; invalid limits fail. This does not force
the child to flush or guarantee disk survival after power loss.

## Evidence

All 48 ActivitySim worker tests passed with the isolated ActivitySim CI Python.
The 18 runtime tests include a real runtime subprocess with a synthetic command.
It flushes both streams, waits, and exposes its process ID. The test verifies the
log before command exit, kills its own runtime owner, then verifies retained
bytes and absence of a completed runtime summary. Cleanup releases the synthetic
command and waits through a pinned Linux process handle.

The tail test limits measured Python allocation to 256 KiB. Mixed UTF-8 text,
empty and absent files, and invalid limits have separate assertions.

`prototype/verify_activitysim_log_controls.py` records seven cases in
`prototype/activitysim-log-controls.json`: harmless and restored cases pass;
buffered output, dropped stderr, whole-file reads, invalid-limit acceptance, and
incorrect tail selection each fail their intended assertion. The report includes
the tested runtime source SHA-256. Container execution uses a mocked CLI in the
unit suite. Allocation measurements exclude kernel caches and other processes.

## Remaining execution work

Process supervision remains open. The host CLI needs an independently supervised
process group, durable identity, and owner-loss evidence through the actual
runtime. Existing AequilibraE owner guard work provides a candidate mechanism,
not ActivitySim acceptance.

Container execution currently starts `docker run --rm`. Killing its client does
not establish that a daemon-owned container stopped. Container identity and
lifetime require separate retention, inspection, and termination verification.
Host process-group evidence cannot substitute for that work.

Managed dispatch, recovery authorization, real ActivitySim execution under owner
loss, independently validated outputs for every published use, and practitioner
acceptance remain unfinished. This change alters no solver, coefficients,
observations, acceptance thresholds, or scientific claim tiers.

## Host supervision prerequisite: zero swap

Reviewing the shared supervisor found that engine scopes set RAM and task limits
but omitted a swap limit. The owner guard already requested zero swap. Engine
scopes now request `MemorySwapMax=0`, query that property, and refuse execution
before authorization when it differs. This prerequisite does not connect the
supervisor to ActivitySim or extend its control to daemon-owned containers.

All 13 supervision tests passed with live Linux user scopes enabled. New tests
observe zero swap on a live scope and refuse an injected unlimited-swap response
before command authorization. `prototype/verify_scope_swap_controls.py` records
harmless and restored passes and detects two faults: unlimited swap requested,
and policy verification bypassed. The results and source hash are retained in
`prototype/scope-swap-controls.json`. These checks use small synthetic commands;
they do not exhaust memory or establish native-model or scientific acceptance.

The subsequent [host supervision checkpoint](ACTIVITYSIM_HOST_SUPERVISION.md)
adds an opt-in CLI/HTTP host path and synthetic owner-loss evidence. Its stated
limits supersede only the earlier unconnected-host status in this note.
