# Captured aerial drafts retain their original byte identity

This M3/M5b.2 candidate compares a captured NodeODM draft with its original
private engine plan. The installed CLI verifies the complete root package before
and after inspection. It checks the original plan hash, initialization metadata,
filenames, actual sizes and hashes. It reports each missing planned upload.
Mixed files, duplicate uploads, changed metadata and changed image bytes refuse.

The [design](DESIGN.md) follows the [native retry counterexample](../2026-10-11-odm-draft-reconciliation/STATUS.md)
and [original command journal](../2026-10-11-odm-engine-effects/STATUS.md).
The new library and CLI remain disconnected from the deployed worker. No public
contract, engine default, schema, migration or scientific result changes.
M3/M5b.2 and complete worker recovery remain open.

## The result describes captured bytes

An exact draft reports `complete_matching_draft`. Matching metadata and some
missing planned uploads report `partial_matching_draft`. An absent draft or
missing metadata remains `inconclusive`; either can follow an uncertain effect.
Every result reports `transportPermission: false`. Inspection does not change
the original effect journal or resolve an uncertain acknowledgment.

The CLI verifies package integrity. Original writer quiescence, package
authenticity, engine identity and source provenance remain unassessed in its
result. The native fixture separately identifies the owned image, bind mounts
and stopped containers. That fixture does not turn a general caller's engine
descriptor into verified live identity or authority.

## Source controls cover all 24 tests

All 24 tests and [36 source controls](evidence/source-controls.json) pass. Four
baseline, harmless and restored runs survive; 32 targeted variants fail at their
named assertions. An AST census covers every new test. The harness restores both
changed sources in `finally` and disables bytecode. Several variants reach a
diagnostic backstop; their records identify that limit rather than claiming
unsafe acceptance. [Source bindings](evidence/source-bindings.json) identify the
two implementations and test file.

Private trials remain available. The first two unit runs used the wrong expected
exception for a refused symlink. The first control run reached a later byte-budget
refusal instead of proving admission before reading. Its revised oracle refuses
any premature byte read. The second control run exposed a surviving hash-format
mutation: a later hash mismatch hid the missing format guard. The revised oracle
detects any plan read before format admission. The third complete control run
passes. No production guard was removed to obtain these results.

The controlled enumeration adapter wraps actual directory entries, then detects
reading beyond the declared bound. It does not test native large-directory
capacity. Kernel I/O and fsync cannot be interrupted by the elapsed-time guard.
Same-user hostile writers and unsupported filesystem durability remain outside
this evidence.

## The pinned engine produces partial and complete captured drafts

The [native driver](native_custody.py) uses the exact cached NodeODM 2.2.4 image
`sha256:cb07d06e21fd6189cfad287c6fedfa0b72568100355635cd9035cb86eed42ee2`.
Four fresh engines run serially, without external network or host ports. Each
has a 512 MiB limit, no extra swap, one CPU, read-only container filesystem and
private owned root mounts. Synthetic ordinary bytes are not decoded imagery.
No task commit, reconstruction or callback runs.

The original saved plan precedes native initialization and upload. The fixture
reads the first upload response but deliberately omits saving its worker receipt.
This models interrupted receipt persistence, not a lost network acknowledgment.
After stopping the first engine, the actual root capture and CLI report one exact
upload and one missing upload. Reissuing the existing local intent returns false.

A fresh engine receives a copy of that captured root. Only the previously
unissued second upload gets a first intent. Its stopped-root capture reports both
exact original uploads. The first receipt stays unresolved and commit stays
unissued. Separate fresh copies reproduce a duplicate native upload and changed
native initialization; their captured packages refuse. A same-size changed-byte
copy passes package integrity but fails original-byte comparison. That disposable
source mutation restores in `finally`; its captured counterexample remains.

All [29 native observations](evidence/native-observed.json), [90 observation controls](evidence/native-controls.json)
and [eight response controls](evidence/response-controls.json) pass. The response
controls include empty and missing responses, changed status, wrong UUID and a
failed upload. Three harmless runs survive. [Ten source bindings](evidence/native-source-bindings.json)
remain unchanged. The native run takes 15.668 seconds. Its driver peaks at
44,744,704 bytes under a 256 MiB service limit. Engine memory peaks were not
measured; their configured limits are separately checked. All four final engines
are stopped and retained. An earlier successful native checkpoint also remains.

## Integration and remaining work

All [12 aerial test scripts](evidence/odm-suites.json) pass serially. The actual
workflow loop passes [five discovery/fail-fast controls](evidence/ci-discovery-controls.json).
The [new workflow command](evidence/actual-ci-steps.json) and all [14 nested application documentation tests](evidence/documentation-checks.json)
pass. The direction check passes with its existing review reminders preserved.
[Owned service resource records](evidence/resources.json) retain limits, measured
peaks and stopped state.
Local workflow execution does not establish GitHub CI acceptance for a new head.
The native cached-engine check is a local operator proof; CI runs the lightweight
draft tests and source controls without provisioning an engine image.

Original ZIP-derived imagery custody, live authority, ordered runtime dispatch,
commit reconciliation, completed-task results, artifacts, callbacks and complete
worker interruption recovery remain required. Browser, practitioner, scientific,
capacity and hosted acceptance are not established. No requirement grade or v1
scope changes. Main merges remain held until the relaunch coordinator explicitly
clears relaunch, agent guidance update and independent Opus review.

GPT-6.1-Sol implements this candidate and runs its local checks. This is not an
independent product or scientific review. The private proof base is
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-draft-custody-20261011/`.
