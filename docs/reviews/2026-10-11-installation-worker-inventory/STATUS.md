# Explicit worker inventory candidate

The offline command retains exact private worker assessments and configuration
before publishing a compatible selected-root inventory. It requires a declaration
for each of 15 known worker families. Installation coverage remains unassessed.
This is an unreleased M3 candidate, not an audit of the hosted installation.

## Behavior

`installation_worker_inventory.py` retains the original profile, a source
catalogue, selected configuration files and the derived `inventory.json`, then
publishes one durable `snapshot.json`. It uses a fresh private destination,
preserves configuration bytes and modes, rechecks sources and refuses reuse.
The command never sources environment files, launches workers or contacts a
provider. Shared and historical roots remain explicit. Configured status records
configuration, not worker health or acceptance.

The catalogue binds the five Python worker entrypoints, nine Node entrypoints,
the executable Planner Agent connector, two Python launch wrappers and package
bytes. It refuses new Python `main.py` workers, new npm worker keys and retargeted
known npm commands. [The source audit](WORKER_FOOTPRINTS.md) identifies separate
ActivitySim roots, NodeODM dependencies, OCR persistence and native map-package
state. A local model root cannot stand in for all of those systems.

Every family needs an explicit configured, not-deployed or unassessed declaration
and explanation. Selected roots and configuration IDs require assessment
references. Configured workers require retained configuration; declared local
custody requires roots. The [template](profile-template.json) starts with all 15
families unassessed and zero selected roots. That does not mean zero installed
workers. [Operator instructions](../../../openplan/docs/ops/BACKUP_AND_RESTORE.md)
explain protected capture, verify, and use with the existing root-set command.

## Local tests and controls

All 298 ops tests pass. The new suite has 56 methods. [Final controls](evidence/controls.json)
cover every method with 59 intended failures and four successful full-suite runs:
baseline, harmless comment, harmless JSON spacing and restored source. Production
bytes restore in finally; source/test hashes match the accepted run.

The controls exercise catalogue omissions and retargeting, duplicate keys,
profile/state/custody/reference validation, privacy, exact copied bytes/modes,
source changes, immutable destinations, metadata publication order, file and
directory sync, finite deadlines, relocated verification, retained layout,
selection binding, CLI scope and private error handling. Some omitted shape/type
guards fail the controlled diagnostic rather than accept an unsafe input. The
independent command guard still rejects a non-string command after its type guard
is omitted. These are reported as diagnostic controls, not unsafe acceptance.

[Local accounting](evidence/local-validation.json) records serial 512 MiB services,
no extra swap, one CPU and 128 tasks. Final controls take 5.870 seconds and peak at
30.5 MiB. The complete ops suite takes 14.864 seconds and peaks at 72.4 MiB.
Injected sync failures demonstrate error handling, not hardware power-loss safety.
Deadline checks cannot interrupt every blocking kernel operation.

## Native historical-fixture integration

[The final native producer](drivers/native_inventory_root_set.py) starts no
services. It uses the protected previously accepted `679c4c31` source point,
whose database/software proof is identified separately as `93b052a2`. It does not
label that point current main. Fifteen family declarations all remain unassessed.
Four original private configuration files and five known historical roots are
explicitly selected; no new live database/Storage cut is taken.

The inventory CLI captures and verifies. An independent file oracle checks the
original profile and every copied configuration byte, size and mode. The existing
root-set CLI then retains the exact derived selection, captures the five roots
and verifies a relocated copy. Independent checks compare every ordinary byte,
mode, directory and all records/schemas in four SQLite journals. Original source
files, root-set packages, inventory package and source dependencies remain
unchanged. Changed selection and missing component binding refuse; harmless
manifest key order and restored copies verify.

[Native results](evidence/native.json) and [accounting](evidence/native-accounting.json)
record exit 0, 30.337 seconds of wall time and 14.139 seconds of CPU time. The
1 GiB service reaches its memory cap. It has no extra swap and uses one CPU;
this establishes no spare capacity or largest-workload acceptance. The original
1,557-file point remains unchanged. Native source journals are already normalized;
populated WAL and binary SQLite values have separate unit evidence.

## Earlier trials and remaining boundaries

[Earlier trials](evidence/earlier-trials.json) remain retained. A custody test
initially also reached the unassessed-state guard; it now isolates configured
custody. Duplicate references isolate the reference guard. The private diagnostic
assertion checks path leakage before type shape. An omitted CLI-argument guard
returns a declaration refusal rather than the anticipated uncaught type error;
the negative now requires the intended parser exit. The first native catalogue
bound the connector's worker library; source review corrected it to executable
`connector.mjs`, bound launch wrappers and exact npm aliases, then repeated the
native producer in fresh directories. Older completed runs remain superseded,
and failed runners remain failed.

Private proof is under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/installation-worker-inventory-20261011/`.
Protected configuration, raw profiles and complete file/journal inventories stay
private. Public records contain summaries and source hashes.

This command does not automatically discover running services, every imported
library, native helper or external dependency. It does not prove correct operator
declarations, live writer fencing, consistent installation capture, encryption,
new database restoration, all-worker continuation, useful 45-minute computation,
separate-hardware recovery, independent commissioning, browser/practitioner or
scientific acceptance, or public readiness. GitHub CI is a separate check. M3 and
the full v1 contract remain open. The relaunch owner retains hosted coordination
and the main merge hold; this lane changes no deployment, worker protocol or schema.

## CI documentation correction, October 11

GitHub QA and shuffled checks at `3c38b728` fail one mechanical path check:
the operator note presents the generated inventory receipt as a repository path.
The note now identifies `inventory.json` within the private inventory destination.
The command, guard and runtime are unchanged. Six focused checks pass from the
nested application directory. A harmless comment survives; a nonexistent
repository path fails the same path assertion; restored documentation passes.
[Four controls](evidence/doc-receipt-controls.json) retain those outcomes. Full
GitHub checks must finish on the new head before CI acceptance. This correction
does not establish worker, installation, hosted or browser acceptance.
