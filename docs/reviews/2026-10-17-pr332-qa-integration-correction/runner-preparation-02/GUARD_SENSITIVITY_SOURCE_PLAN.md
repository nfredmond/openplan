# Six local guard cases need source disposition before implementation

This is a SOURCE PLAN, not runnable controls or a grant. No case, fixture,
callback, mutant, import or manager executes. ROOT first disposes this exact
scope. Any later implementation lives in NEW owned children, receives exact
source hashes and assertion locations, and returns for source reread before
any separate grant. Nothing changes the eleven subject faults or 7+5 files.

## The proposed scope is six cases and eight omissions

Two future interpreter processes use builtins only: one Python process and one
Node24 process. They load private exact-source copies of these new guard
definitions, never `outer`, `entry`, `campaign`, a subject, provider, launcher
or manager. No subprocess, lock, namespace, application request or manager
simulation belongs in the fixtures. The proposed ceiling is 30 seconds overall,
128 MiB memory, zero swap and one process at a time. ROOT must dispose that
separate cost and resource scope before runnable controls are written.

Six named cases run harmless first, baseline and exact-restored selections.
Eight omission variants each run one targeted case. That is 26 named case
executions: 17 Python and nine Node. Intended negative probes are assertions
inside those six cases, not eight more campaigns. Each fixture contains at most
eight data bytes; two independent marker files may contain one byte each.
No old campaign, fixture, result or proof packet is read or replayed.

| Case | Actual function and exact source anchor | Positive and intended negative | Targeted omission |
| --- | --- | --- | --- |
| P-WRITE | `runner.py:write_all`; `type(count) is int and 0 < count <= len(data) - offset` | A supplied local writer calls real `os.write` with one byte per call. Eight bytes, eight actual writes and independent saved bytes must agree. Separate zero and string-count callbacks must refuse at the exact count diagnostic. Each hostile callback raises a named limiter after three calls, so removing the guard cannot hang. | P-W1 changes the loop to a single write. P-W2 removes only the count predicate. Both must fail this case's specific accounting/refusal assertion. |
| N-WRITE | `report-io.mjs:writeAll`; `Number.isSafeInteger(count)` and `offset += count` | The same eight-byte real-file check uses a supplied local write callback. Zero and string counts must refuse with `report_invalid_actual_write_count`; a three-call limiter prevents a loop from substituting a timeout. | N-W1 changes the loop to one write. N-W2 removes only its count predicate. |
| P-READBACK | `runner.py:readback`; `observed['sha256'] == hashlib.sha256(data).hexdigest()` | An exact eight-byte file accepts. A same-length, one-byte corruption must refuse at `saved_file_readback_mismatch`. The reader checks actual bytes independently. | P-R1 removes only the content-hash comparison, preserving the length comparison. |
| N-READBACK | `report-io.mjs:saved`; `bytes.length !== length || sha(bytes) !== hash` | An exact eight-byte file accepts. Same-length corruption must produce `report_saved_length_or_hash_mismatch`, with source input intact. | N-R1 removes only `sha(bytes) !== hash`, retaining length checking. |
| P-INDEPENDENT | `runner.py:error_info` and `independent_actions`; `errors.append({'step': label, **error_info(error)})` | Capture a real local primary callback exception and traceback first. A cleanup callback then throws; two later callbacks must still create their two real private markers. Returned primary must equal the captured primary, the cleanup error must stay separate, and both marker bytes must exist. | P-C1 replaces the cleanup exception capture with propagation. The case catches the observed outcome and fails the explicit later-marker/primary-custody assertion, rather than counting the propagated exception as a kill. |
| P-METADATA | `runner.py:descriptor` and `pinned`; `descriptor(item['path']) == item` | Exact descriptors accept. Same-byte mode drift, same-byte inode replacement, a local symlink substitution, and independently altered expected UID/GID fields must refuse. All paths and targets belong to the new tiny fixture. No identity change, chown, external target or authority is simulated. | P-M1 replaces complete descriptor equality with size/SHA equality. The case must fail its mode/identity-drift refusal assertion. |

Python uses the actual definitions from a private module copy with main dispatch
inactive. Only its local writer binding changes to accept a supplied callback;
the function bodies under test remain byte-identical. Node's private fixture
exposes its otherwise private `writeAll` and `saved` definitions and supplies a
local writer binding. Export/binding-only fixture edits must be separately
listed; the actual function-body hashes must match the frozen source. These
are platform I/O callback seams, not mocked subjects or simulated managers.
ROOT must review those exact fixture mechanics before they become runnable.

## Readers require the intended assertion and restoration

The harmless variant appends an annotation outside guard bodies. It must retain
all six named case successes. The baseline must establish the same six exact
case identities before any omission runs. Each omission must produce exactly
its targeted `AssertionError`, at its future fixed case anchor, with the stated
accounting, diagnostic or marker mismatch. Python's class and Node's
`ERR_ASSERTION` must be inspected explicitly. A limiter exception, import error,
missing output, timeout, generic exception or unrelated failure is not a kill.

The later control implementation must name literal assertion labels matching
these six case IDs. An independent builtin reader checks actual fixture bytes,
reference hashes, marker existence and each recorded refusal. It must not use
the writer/readback guard under test to decide its own expected outcome.
Future source handoff must add exact fixture/test line numbers and reporter
schema before any grant. No such locations or results are invented here.

Every private source variant restores from immutable source bytes in `finally`.
After each omission, compare source hashes independently. The final restored
six-case selection must match the original case identities. Retain primary,
cleanup, partial output, actual mutation and restoration records. Clean up only
new fixture paths. A source-restoration result does not claim restoration of
an intentionally replaced fixture inode or storage durability.

## This plan has a narrow sensitivity boundary

The callback cases cover actual byte accounting, saved-file corruption refusal,
the shared independent-action helper and complete descriptor comparison. They
do not establish all `bounded` call-site ordering, process termination, pipe
behavior, OS filesystem races, kernel storage failure, physical durability,
cross-user ownership enforcement, real UID/GID changes or manager cleanup.
The metadata omission demonstrates the complete-comparison boundary; it does
not independently falsify every fstat/lstat race check. No lifecycle matrix or
old campaign fills those gaps. The 480-second subject proposal remains held
until ROOT disposes this plan and the eventual exact guard-control source.
