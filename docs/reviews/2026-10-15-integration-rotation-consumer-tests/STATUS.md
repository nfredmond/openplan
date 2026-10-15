# PR 328 combined consumer source tests

October 15, 2026 UTC. Both bounded source-test gaps pass on candidate
`cfdce545f70c2580bf11d4a6253bb48620927a9e`. No source defect was reproduced.
The implementation and original rotation tests remain unchanged.

## Ownership and direction

Assigned tree: `/home/nathaniel/.t3/worktrees/openplan/t3-095307b4`, branch
`t3/integration-secret-rotation-consumer-tests`. The branch started clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwarded with
`git merge --ff-only cfdce545f70c2580bf11d4a6253bb48620927a9e`.
This child owns the new test, this controller and this evidence directory.
The original owner's checkout was not edited. No nested delegation ran.

The child read AGENTS, the current first coordination entries, binding product
direction, the candidate rotation records and the full independent review from
`t3-550de714`, also preserved in the candidate's
[rollback review](../2026-10-15-integration-secret-rotation/INDEPENDENT_ROLLBACK_REVIEW.md).
The existing merge hold remains outside this child task. The rollback P2 is
already corrected in the supplied base. M3 remains partial.

`npm run product:direction:check` exits zero from `openplan/`, with existing
registry/matrix expiration, review/package version and intervening-source
reminders. This does not refresh a review or establish runtime acceptance.
Planner-writing and prove-it govern the new prose and controls.

## What the tests establish

The [two-case test](../../../openplan/src/test/integration-rotation-consumer-chain.test.ts)
uses the real selection, envelope and Node crypto consumers. The database
fixture returns only requested columns and checks the table, exact projection
and workspace/provider filters on every read. Preparation captures the SHA-256
of the original stored ciphertext. After switching primary and retaining the old
secret, verification succeeds with the exact queued envelope and stored bytes.
Replacing ciphertext with a fresh encryption of the same plaintext refuses the
original digest. Removing the needed secret refuses both the queued envelope
and a fresh selection, despite an available environment payer. Missing-envelope
decryption refuses before querying the selected row again.

The API case prepares an actual revision before rotation. It changes the
destination and recomputes the outer hash from parsed configuration while
retaining the exact encrypted payload, workspace and revision. An observing spy
calls the real decrypt implementation. A stale outer hash refuses before that
call. The recomputed hash reaches a successful decrypt of the original envelope,
then refuses the encrypted configuration mismatch. Removing the encrypted hash
comparison returns the key and fails the specifically named refusal assertion.
Removing the previous secret instead produces a null decrypt result, confirming
that distinct refusal stage.

These functions do not authorize dispatch. The tests supply synthetic caller
scope and credentials; they do not bypass or grant route approval, claim a job,
change a payer, send a provider request or rewrite stored records.

## Controls and retained failures

Four two-case cohorts pass: baseline, harmless comments in both consumer sources,
restored after comments and final restored source. Seven named faults fail only
their intended test while the other test passes. See
[controls](evidence/controls.json), the complete per-trial JSON reports beside it
and the [controller](verify_controls.py).

- Remove previous-secret reads for workspace-bound ciphertext.
- Hash plaintext instead of exact stored ciphertext.
- Omit the selected workspace column.
- Ignore the retained ciphertext digest.
- Fall back to the environment payer after selected-row decryption fails.
- Ignore the encrypted API configuration hash.
- Ignore the outer API configuration hash.

The strict classifier requires exit 1, both named cases, exactly one failed
assertion, one passing peer, no skipped case and the exact named assertion
diagnostic. Ten negative classifier controls reject runtime/import errors,
empty selections and unrelated result shapes. A harmless classifier wrapper
survives; a permissive classifier fault fails its own named refusal assertion.
See [classifier controls](evidence/classifier-controls.json).

Two earlier controller attempts were rejected and retained. First, Vitest's
promise assertion omitted the intended diagnostic label; a direct assertion on
the caught error fixes that observation. Second, removing the outer hash check
fails the earlier refusal assertion before the expected spy assertion. The
controller now names that actual first assertion. Neither rejection counts as
an intended failure. [Failed trials](evidence/failed-trials.json) retain both
reports and private evidence paths. Every trial restores exact source in
`finally`; five parent-owned sources match the base's Git bytes afterward.

Strict lint of the new test and a scoped TypeScript check pass. The latter
checks this test and its imports, not the whole application. Source hashes and
commands are in [checks](evidence/checks.json) and
[final bindings](evidence/final-bindings.json).

Each run uses one worker in a transient resource scope with a 1 GiB limit and
swap disabled. No application service starts. Dependencies mount read-only;
Vite, npm and temporary caches remain private. The sandbox disables networking.
The final controller peaks at 210,358,272 bytes, records zero OOM events and uses
zero swap. See [resources](evidence/resources.json).

To repeat, mount existing dependencies read-only at `openplan/node_modules`,
use private writable caches/output, and invoke this controller in a cgroup with
`MemoryMax=1073741824` and `MemorySwapMax=0`:

```sh
python3 -B docs/reviews/2026-10-15-integration-rotation-consumer-tests/verify_controls.py \
  --repo "$PWD" --out /absolute/private/new-trial-directory
```

The output directory must be new; earlier trials are never overwritten. The
controller refuses a missing resource cap and runs only these two cases. Its
private configuration uses the Node environment and the source alias, with no
application-wide setup file. Both cases also declare the Node environment.

## Blind categories

The projected query fixture cannot establish live database grants, RLS, schema,
transactions or concurrent row changes. The decrypt spy establishes this
consumer's call/result boundary, not native GCM internals or every malformed
v1/v2/v3 envelope. The controller samples seven source faults, not all possible
faults. Hash manifests establish bytes, not behavior.

One-process environment switches do not establish deployment configuration,
process restarts, mixed-reader delivery, saved queue recovery, secret inventory,
rollback compatibility, protected backup contents or independent-host restore.
No full suite, build, browser, database, application service, hosted operation,
secret rotation, GitHub review/comment, PR update, push or merge ran. These tests
do not establish provider responses, route authorization, practitioner acceptance
or M3/V1 completion. Parent retains implementation, CI and integration ownership.
