# Six local controls are implemented as unexecuted source

ROOT disposition03 accepts SOURCE implementation of six cases, eight omissions
and26 case executions. It grants no operation. The exact definitions, static
variants, case assertions and independent readers now live in NEW03 only.
Preparation02's source plan and every older packet stay unchanged.

The proposed guard window is separate:30 seconds overall,128MiB, zero swap,
CPU50 and Tasks64, one Node child at most, no subject calls. ROOT's future
external finite controller must pin this complete source and impose the window
before calling `guard-controls.py`. That source is a control program, not its
own admission authority. It never calls the subject runner or a manager. It
does not create a request, grant or epoch. There is no automatic successor.
The subject480-second window requires its own later disposition and grant.

`guard-controls.py` proposes17 Python executions and one persistent builtin-only
Node child with nine executions. Four phase barriers interleave both families.
All six harmless cases finish before any baseline; all six baselines finish
before any omission. Four one-byte child acknowledgements and three one-byte
parent phase markers synchronize this order. Only one case executes at a time.
Harmless first, baseline and final restored
each contain all six cases. The eight omissions each contain only their one
targeted case. Both interpreters load new private copies. Python uses `-B`,
requires bytecode writing disabled and refuses optimization. Node uses unique
module URLs after each source replacement. Fixture files contain at most eight
bytes; the two later-action marker files contain one byte each.

| Case | Actual definitions | Targeted omissions and literal failed assertion |
| --- | --- | --- |
| P-WRITE | `write_all` | P-W1 single iteration: `P-WRITE.actual-eight`; P-W2 omitted positive-count predicate: `P-WRITE.zero-refusal`. |
| N-WRITE | `writeAll` | N-W1 single iteration: `N-WRITE.actual-eight`; N-W2 omitted positive-count predicate: `N-WRITE.zero-refusal`. |
| P-READBACK | `descriptor`, `readback` | P-R1 removes only the SHA comparison: `P-READBACK.hash-refusal`. |
| N-READBACK | `saved` and exact metadata helpers | N-R1 removes only the SHA comparison: `N-READBACK.hash-refusal`. |
| P-INDEPENDENT | `error_info`, `independent_actions` | P-C1 propagates cleanup instead of retaining it: `P-INDEPENDENT.later-markers`. |
| P-METADATA | `descriptor`, `compare_descriptor`, `pinned` | P-M1 replaces final complete equality with size/SHA equality: `P-METADATA.mode-refusal`. |

The writer positives call real platform writes eight times, one byte each.
Independent reads must find exactly eight bytes and the returned count8.
Zero and string-return callbacks must refuse at their exact count diagnostic.
A three-call local limiter prevents an omitted predicate from hanging. A
limiter exception cannot count as a kill. Readback cases accept exact bytes,
then require refusal after a same-length one-byte corruption.

P-INDEPENDENT captures a real local primary exception and traceback first.
One cleanup callback throws; both later callbacks must still write markers.
Primary custody, cleanup separation, later action results and independent marker
readbacks have separate assertions. The omission case captures propagation,
then requires the specific later-marker assertion. A generic cleanup exception
does not become a kill.

P-METADATA uses actual mode drift, a distinct inode replacement, local symlink
substitution and changed expected host owner fields. It separately supplies
changed actual owner fields for strict1000 metadata, seven synthetic system
owner views, seven non-owner mode changes and one unknown root-owned path.
All probes execute before the final assertions. It performs no chown, privilege
operation, mapping probe or system-file read. Synthetic owner views stay visibly
separate from actual tiny-file metadata.

## Exact body text and listed seams bind the controls

`GUARD_SOURCE.json` contains every selected function's exact definition text,
SHA-256, private baseline/harmless paths, static variant hashes and the23 exact
assertion source lines. Python copies only nine definitions and the exact
system-path constants, with stdlib imports. No runner dispatch enters its
capsule. Its local `os` binding receives a delegating writer callback only
while writer probes run, then restores in `finally`.

Node retains the full report-I/O module but never calls its journal or signal.
Only the import name `writeSync as nativeWriteSync`, a local writer binding and
`setGuardWriter`/private-function exports differ outside the tested definitions.
`writeAll`, `saved` and metadata helper text remain identical. The manifest lists
these seams. Harmless annotations sit outside every copied definition.

`guard-readers.py:read_source_equivalence` independently compares literal body
text and hashes in original, baseline and harmless files before controls load.
The static omissions each change exactly one named anchor. Private working
copies restore in each step's `finally`, and again in independent terminal
actions. Readers compare final actual working bytes to immutable baseline
bytes. No original file is mutated.

## Literal readers reject generic failures

`guard-readers.py` has its own literal26-row order and eight omission labels.
It requires exact `AssertionError` class, message and pinned source location.
Node also requires `ERR_ASSERTION`, actual false and expected true. Setup/import
errors, missing reports, limits, unrelated assertions or generic failures refuse
the window. All six harmless survivors must precede the baseline and omissions.

Readers independently open fixture bytes and marker files. They check the
primary traceback, separate cleanup record, later action results and marker
readbacks separately. They check the exact synthetic system path list, actual
supplied owners, `UNPROVED` parity and strict/unknown refusal details. They do
not call the tested writer, readback or metadata policy to decide outcomes.

Both drivers retain primary, cleanup, partial rows and restoration records.
Python records each partial row and results even after a control-stage failure.
Once its own child is terminal, it independently attempts restoration and
readback of the child's private working source too. Node independently
attempts restoration, restored-file readback and hash capture before its result
write. Recording failures refuse completion. The future external ROOT controller
must retain startup errors and final raw process outcomes too. The proposed
inherited262144-byte file-size limit bounds child stdout/stderr files. No
parent pipe buffers child output. The shared30-second ceiling includes both
interpreters, readers, recording and restoration. The program uses a27-second
work deadline, leaving three seconds within30 for ROOT's external termination
and terminal evidence. Its deadline is not an independent wall-clock enforcer.
ROOT must supply that finite external controller before a grant. Cost fit
remains unmeasured.

These controls cover local byte accounting, hash refusal, the shared independent
action helper and complete metadata comparison. They do not falsify every
`bounded()` call site, pipe/process ordering, real manager cleanup, OS races,
filesystem/kernel failures, physical durability, namespace capability or actual
cross-user owner mapping. No lifecycle matrix or old campaign is added. No
control has run; no harmless survivor, kill or restoration result is claimed.
