# Retain checked aerial task metadata separately from engine commands

This candidate keeps supplied, checked task replies in a private metadata root.
That root is separate from the original engine command tree. Original plan
bytes bind both roots. The helper grants no task transport, processing commit,
retry, engine adoption, callback or publication permission.

## Current implementation and bounded checks

`retained_task_observation.py` reuses the existing original-plan validator,
task metadata parser, private readers, cooperative lock and immutable publication.
Both configured roots must already exist privately. Equal or overlapping roots
refuse. Recording rechecks the engine plan, binds the ledger to its exact plan
and stores each raw reply under its SHA256. Exact replay keeps the original file.
Different raw JSON spellings remain separate replies.

Loading requires the original ledger plan. It bounds the record before parsing,
rejects alternate canonical encodings and rechecks the decoded body, filename
digest and complete interpretation against the original plan. Supplied status,
counts, options and progress remain reported facts. All six original assessment
fields remain `unassessed`; transport and publication remain denied.

An empty, precommissioned metadata root can initialize from the matching engine
plan. This does not detect a previously emptied root, discover lost records or
establish installation completeness. A missing metadata root is not provisioned.
An existing populated root without its ledger plan refuses.

The current local unit cohort has 29 cases. Its source controller has four
passing cohorts and 32 targeted faults, on Python 3.14 and 3.11. Helpers and tests
restore exactly after each fault. The failure oracle also rejects wrong exit
types, unrelated tests, missing summaries, wrong counts, extra tests and decoy
diagnostics. [Current source controls](evidence/source-controls314.json),
[3.11 controls](evidence/source-controls311.json) and
[source oracles](evidence/source-oracles314.json) retain those results.

## Native continuation and discovered defect

The initial native trial stores metadata inside the engine command root. The
existing engine journal rejects the added directory as an unknown effect record.
This exposes an integration defect that the initial unit cohort missed.
The correction retains the engine guard and requires a separate metadata root.
A new unit case reopens the actual effect journal after recording metadata and
checks that command paths and unissued states remain unchanged.

The corrected native probe uses the existing cached isolated API fixture.
Three invalid ordinary byte strings enter one committed synthetic task. The
actual backend reports failure and three images. This does not establish decoded
imagery or usable reconstruction. The helper records the exact actual response.
The original producer stops before the selected-root point.

The existing root-snapshot command captures the explicitly assembled engine and
metadata roots. A relocated copy reopens the original checked reply. Original
command files, the assembled source and immutable package remain unchanged.
The first corrected probe and separate Python 3.11 probe pass. Native controls
exercise four positive cohorts and 20 selected broken predicates. The current
typed-oracle rerun passes, with three positive and ten invalid-result controls.
[Native controls](evidence/native-controls.json),
[native oracles](evidence/native-oracles.json),
[current result](evidence/native-results.json) and
[3.11 result](evidence/native311-results.json) retain the bounded evidence.
This is one known fixture on the same host.

## Failed and superseded trials

The first source-controller launch lacks its private proof parent and stops
before tests or mutation. The next trial rejects a load-bound fault whose bounded
read produces a different JSON diagnostic. The corrected fault removes both
size checks, so the test can detect parsing beyond the declared bound.

The earlier digest test changes the body to invalid JSON and reaches a later
parser guard when the digest guard is absent. It is replaced with a complete,
valid reply stored under the wrong original digest. The targeted digest fault
then reaches its intended assertion.

After separating the roots, the directory-sync fault initially survives. The
fixture loses acknowledgment at the earlier plan sync. The corrected fixture
waits for the actual new reply file before interrupting its directory sync.
The current targeted fault then fails. No publication guard is weakened.

The old load-bound fixture also counts one plan read. Separate engine and ledger
plans require two. The replacement directly detects whether the oversized reply
reaches JSON parsing, without depending on a plan-read count.

## Limits and next verification

The private record is not a fresh live poll, proof of current actor access,
attested engine identity or source/image quality. Cooperative writers and private
paths do not establish an adversarial same-UID fence. A fully substituted evidence
package or fabricated subprocess transcript is outside these controls.
The selected-root point does not align database, Storage, configuration, engine
data or every installation root. Runtime polling, uncertain-effect reconciliation,
engine adoption, processing/results/callback recovery, useful long computation,
clean agency commissioning, physical-host recovery, visual/practitioner/scientific
acceptance, full M3/M5b.2 and v1 remain open.

[The actual 33-stage aerial recipe](evidence/workflow-results.json) passes
630 cases across 25 unit suites and 20 app/documentation cases. Direction and
the pointer controls pass. [The owned unit](evidence/workflow-resources.json)
stops at 962,031,616 bytes under 1 GiB, with zero maximum/OOM events and zero
swap. [All source bindings](evidence/workflow-bindings.json) match after restoration.
The [new recipe comparator](evidence/recipe-controls.json) preserves the preceding
20-minute wrapper and rejects omitted metadata commands and changed suite deadlines.
The preceding frozen recipe binding stays unchanged. These comparators do not
parse general YAML or prove GitHub execution. The [summary](evidence/summary.json)
retains the case and control counts.

Current-head CI remains separate and required before landing.
Preserve the hosted merge slot and exact health between PRs.
No app route, default, hosted setting, database migration or release tag changes.
Original logs, replies, roots and failed trials remain under
`~/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-task-observation-retention-20261013/`.
