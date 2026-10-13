# Validate SQLite companion retirement before reopening the original

PR264's aerial job fails before its new observer controls. The inherited
concurrent engine test reports the journal's private-path refusal while checking
a SQLite companion. The CI traceback records no mode, owner or link metadata.
Its exact failing field remains unknown. All seven required checks pass, but
that failed aerial job prevents this lane from landing the known defective stack.

A thousand ordinary concurrent-test repetitions with the original privacy
predicate do not reproduce the failure locally. That is not acceptance. A
separate deterministic lookup seam pins a real companion inode before its
actual final SQLite connection closes. SQLite unlinks it, and the descriptor
reports zero links. Returning that actual metadata at the pathname lookup
boundary reproduces the preceding private-path refusal for WAL and SHM. It
models lookup followed by concurrent unlink; it does not prove that CI observed
this particular field.

The correction catches missing-path or invalid-metadata observations only at
the companion check. It performs a fresh lstat. If the name is gone, it continues.
If anything still occupies the name, it rethrows the original error. It preserves
the existing owner, mode, file-type and single-link predicate. A dangling symlink
remains present under lstat. A name that reappears after a missing lookup also
refuses before SQLite opens. No new lock file, serialization, schema, deadline
or default behavior is introduced.

Five new journal tests and the changed observer parent-exit test pass on Python
3.14 and 3.11. The [controllers](verify_controls.py) pass 11 checks: baseline,
harmless and two restored controls survive; seven selected faults fail their
named assertions. Eight failure-oracle controls pass. Source restores exactly.
Both owned 256 MiB units stop, with zero max/OOM events. Existing 54 journal and
25 engine tests also pass in the preceding run.

The first classifier trial rejects its own claimed acceptance: a caught exception's
chained traceback can retain an error block after the assertion type is replaced.
The selected test now raises its specific assertion from None after catching
that known exception. The error type remains in its assertion. All deliberately
broken classifier inputs then refuse. That preceding controller trial stays
private and does not count as proof.

These checks protect cooperative private journal consumers. They do not fence a
noncooperative writer or malicious changes by the same filesystem owner. The
lookup seam supplies the timing boundary; native SQLite close/unlink and inode
metadata are real. Ordinary stress alone cannot establish this race. No worker,
engine, planner or scientific processing is accepted by this correction.

The first complete workflow stops at its legacy journal controller's obsolete
mutation anchor. The two selected companion controls now target the changed
exception block. The next run passes 29 stages, then a baseline observer test
reports ProcessLookupError while reading the proc stat of its exiting child.
That test previously handles only FileNotFoundError. Its observation now handles
both narrow disappearance errors. An injected ProcessLookupError verifies that
path; injected PermissionError still propagates. Removing the former handling
or swallowing all OS errors fails the named assertions. The original production
parent-lifetime control remains in the native observer controller. No production
observer code changes. Both incomplete workflows remain failed proof trials.

An initial control-service command also uses a relative script path from the
service's home directory and exits before running any test. The corrected
absolute-path invocation runs the controls above. That launcher failure does
not count as a test result.

The [third full workflow](evidence/workflow-results.json) passes all 31 actual
YAML run blocks. Its 22 unittest suites contain 565 cases, with seven separate
scenario programs. All 20 release/documentation tests pass. Product direction
passes with the existing review reminders. The [worker bindings](evidence/workflow-source-bindings.json)
match after exact restoration. The [owned unit](evidence/workflow-resources.json)
stops after 334.35 seconds, peaking at 1,007,960,064 bytes under 1 GiB. It reports
zero max, OOM and OOM-kill events and allows no additional swap. These are serial
verification workloads, not production capacity acceptance.

The separate [native follow-up](evidence/native-followup-results.json) passes
the adapted 59 journal controls on Python 3.14, [14 installed RPC cases](evidence/native-rpc-controls.json)
and eight RPC classifiers. Original capture, relocated recovery, revoked access,
changed-original faults and the stalled current-read deadline pass. Both
[retained fixture services stop](evidence/native-rpc-stopped.json). This synthetic
fixture retains its older 405-migration schema and supplied engine adapters.

The separate native engine fixture passes [17 observations](evidence/native-engine-observations.json),
22 result predicates and 69 classifiers. Its original process-root configuration
and remount/refusal checks pass; its task list stays empty. The [engine stops](evidence/native-engine-stopped.json)
under 512 MiB, without host ports or reported OOM. The follow-up unit peaks at
67,710,976 bytes under 256 MiB with zero max/OOM events. All published worker
bindings match after restoration. These two native proofs do not compose actual
RPC authority with real engine init/upload transport or accept processing.

Current-head GitHub checks still need verification before the corrected stack
lands. Hosted aerial03 is already applied and
verified from the prior schema-first rollout. Its code merge remains pending;
retain migration02/05 and every disabled default. No additional hosted write is
required by this correction. Main and production match013df2d9c at the preceding
readback; verify their current state again before merging. M3, native private-
authority composition, processing/results/callback custody, installation and the
full v1 contract remain open. GPT-6.1 Sol at high reasoning performs this
correction; no fresh independent review is claimed.
