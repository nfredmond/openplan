# Selected worker-root set, October 11 candidate

The Linux candidate command retains an explicitly selected set of private worker
roots. It saves the exact selection bytes before copying any component, binds
every component manifest, observes all selected sources before and after copying,
and publishes the set manifest last. It does not discover omitted installation
roots or establish a coordinated database and Storage point. M3 remains open.
The relaunch agent retains hosted coordination and the main merge hold.

## Command and controls

[`worker_root_set_snapshot.py`](../../../openplan/scripts/ops/worker_root_set_snapshot.py)
reuses the existing single-root operator. The [design](DESIGN.md) records its
selection, publication and evidence boundaries. Capture requires declared writer
quiescence, a private selection file, nonoverlapping private source roots and a
fresh private destination outside every source. Safe unique IDs name components.
An empty selection means zero selected roots, not zero installed workers.

All sources are inventoried before component copying. Each component is compared
with that initial inventory, then every source and the selection file are checked
again. The retained selection keeps its exact bytes and private mode. SQLite uses
the existing native backup and recognized reader-sidecar rules. Ordinary paths,
bytes, modes and empty directories remain exact. Observed durable changes refuse
capture. Component receipts alone cannot establish a complete set.

Verification reads only the retained set. It checks the outer layout, exact
selection binding, declared component IDs, original source identity, component
manifest hashes and complete component contents. It works after source paths
become unavailable. The protected coordinated point must authenticate the set's
manifest hash; self-consistent manifests do not authenticate themselves.

The [37 controls](evidence/mutation-controls.json) include five survivors and 32
broken cases. Baseline, harmless comment, different manifest indentation and
restored source pass the full 31-test native suite. Omitting a redundant explicit
selection-privacy call survives one selected case because the entry reader also
checks privacy. This selected survival does not establish whole-program harmlessness.

Every new test has a selected broken-behavior control. Thirty-one broken cases
fail their intended assertion. The remaining case removes the remaining deadline
from native SQLite backup and exceeds its owned child's four-second bound. The
runner ends only that child and restores production source bytes in `finally`.
Cases cover initial-to-component binding, later source changes, private aliases,
selection bytes and mode, invalid CLI scope, retained source identity, zero
selection, incomplete publication and file/directory/parent sync. Reported sync
and later-component failures exercise refusal branches, not actual disk loss.
The full operations suite passes 208 tests without skips.

The [first control trial](evidence/failed-control-selection.json) fails oracle
selection. A malformed list raises before the intended foreign-format assertion
when validation is omitted. The corrected test first exercises a well-shaped
foreign-format record and retains all malformed cases. The original source was
restored, and the failed trial remains private. It is not relabeled as passing.

## Native five-root set

The [installed CLI check](evidence/native-five-root-set.json) captures the five
known roots from the previously accepted managed-stage point. It retains the
exact selection bytes and mode, verifies the set, copies it to a fresh location
and verifies that copy. Each ordinary path, byte, private mode and empty directory
matches independently. All four native journal schemas and table records match;
SQLite page metadata may normalize. The [six execution dependencies](evidence/native-source-binding.json)
are frozen before execution and unchanged afterward. The [executed driver](drivers/native_root_set.py)
is retained with its original bytes.

| Selected root | Files | Directories | Retained bytes | SQLite copies |
| --- | ---: | ---: | ---: | ---: |
| Managed-stage worker | 5 | 13 | 41,676 | 2 |
| Legacy model worker | 5 | 7 | 33,499 | 2 |
| Configured transit worker | 699 | 620 | 274,085,334 | 0 |
| Replacement transit worker | 29 | 23 | 2,873,176 | 0 |
| Capacity transit worker | 787 | 780 | 235,651,073 | 0 |

A harmless manifest-key order change verifies on the disposable relocated copy.
Changed selection bytes and a missing component binding each produce a controlled
CLI refusal. Mutation bytes and modes are restored in `finally`; final verification
passes. The immutable set, all original roots and the complete original 1,557-file
point remain unchanged. No database, Storage service or worker starts for this run.
These source journals were already normalized by the accepted point. Populated WAL
and generic BLOB records are tested in the separate native unit suite.

[Unit accounting](evidence/unit-accounting.json) records invocation IDs and exits.
The native driver takes 32.182 seconds; its bounded service reaches a rounded
512 MiB peak. This is not spare-capacity acceptance. Private proof remains under
`gtfs-managed-ingestion-proof-20261009/worker-root-set-20261011/`.

## Browser and remaining boundaries

The [T3 retry](evidence/t3-retry-limits.json) starts an owned frozen f72 preview
and obtains HTTP health 200. T3 open initially reports an attached `tab_3`, but
resize times out and navigation/snapshot report no available automation host with
an explicit do-not-retry instruction. The owned preview is stopped after checking
its process directory. The original isolated API services remain unchanged.
No alternate browser is used. This attempt establishes no fresh navigation,
screenshot, desktop/390px, console, keyboard or restored-browser acceptance.

Declared quiescence is not a writer fence. This selected set cannot detect every
change and exact restoration between observations, discover omitted roots, align
a new database/Storage cut, encrypt itself or authorize model continuation.
Progress deadlines cannot interrupt every blocking kernel call. Full independent
agency installation, every worker family, useful computation beyond 45 minutes,
separate physical-host recovery, native Windows/macOS and independent AequilibraE
and ActivitySim validation remain open. No capability grade, scientific claim,
hosted deployment, migration, release, tag or main merge is promoted by this work.
