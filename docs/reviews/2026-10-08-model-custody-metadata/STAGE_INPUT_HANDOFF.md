# Stage input handoff findings

October 8, 2026. Source inspected at `0732ae49` in the isolated managed-dispatch
integration checkout. This is an implementation design for the existing M3/S1
work, not a replacement roadmap or evidence of completed handoff.

## The state file is not the complete input

`_claim_and_run_stage` reads the shared `state.json` for Network Assignment,
Artifact Extraction and ActivitySim Network Assignment. Managed state publication
retains the original JSON and registers its hash, but explicitly records
`package_inventory_included: false`. Its referenced files remain mutable.
Selecting that artifact alone cannot safely start a successor in another attempt.

| Consumer | Required inputs visible in current code | Transfer requirement |
| --- | --- | --- |
| Network Assignment | Setup centroid/cordon maps and geography; `aeq_project`; `package.package_dir`; selected count files and source metadata | Copy a completed setup package and project into the new attempt, with verified inventory and explicit path mapping. Retain the original state unchanged. |
| Artifact Extraction | Assignment state; `aeq_project/project_database.sqlite`; `run_output` volume CSVs, skims and calibration files; demand and zone tables in the recorded package; `zone_attributes_payload.json` | Retain the complete source set before evidence preparation. Preserve absent caches as absent instead of downloading a different source. Verify counts through the existing consumer helper. |
| ActivitySim Network Assignment | First assignment's accepted profile, network settings and solver-visible network identity; separately registered ActivitySim demand package; original count record | Preserve demand-engine separation. Copy the accepted project into the consumer attempt and verify its network identity before applying the second assignment. Do not derive a new profile from local environment defaults. |
| Demand Model Agreement | Two completed same-run volume artifacts, matching profile/settings/network, retained geometry and comparison inputs | Reuse existing completed-producer and byte-checked copies. Do not replace these with paths inferred from directory names. |

The package is also an output. `stage_assignment` writes auto-only demand and
calibration can write `od_auto_matrix_calibrated.csv`. Copying only the setup
manifest's original file list would omit later generated inputs used in artifact
calculations. The retained inventory must describe the completed producer's
actual package, while retaining the original manifest as one source file.

`stage_setup` closes the AequilibraE project before direct SQLite edits and closes
its connection before returning. `stage_assignment` closes its project before
returning. These success-path calls are useful boundaries, not proof that every
exception or native resource has closed. Project capture must explicitly refuse
an unconfirmed live database rather than copy a database file while ignoring WAL
or journal state. A synthetic SQLite consistency/recovery test and an actual
small project reopen are distinct acceptance checks.

## Required implementation boundary

Use a typed inventory with relative paths, file roles, sizes and hashes for the
closed producer package, project, required outputs and source caches. Record the
producer run, stage and attempt, original state artifact and inventory artifact.
Require a completed producer and exact attempt ownership before reading files.
Do not use the newest state across unrelated stage types as a substitute for an
explicit predecessor. The current artifact projection lacks stage order and
stage name; predecessor selection needs an explicit checked stage relationship.

Materialize an exclusive consumer directory, verify every copied file and the
full inventory, and preserve the source state byte-for-byte. Build a separate
execution-state object with explicit field mappings. Do not recursively rewrite
arbitrary strings, scientific metadata, recorded source labels or original paths.
Refuse unexpected, changed, missing or extra files according to the declared
inventory. Do not adopt a partial prior consumer directory after interruption.

Only then connect normal claim dispatch and its complete publication lifecycle.
Exercise setup-to-assignment-to-artifacts and the separate ActivitySim handoff,
including fresh-process recovery, incorrect installation/attempt, lost receipts,
source changes during copying and partial destination files. A synthetic handler
proves lifecycle behavior; native project reopening proves a different boundary.
Neither proves scientific accuracy or planner acceptance.

## Corrected package reference

Artifact calculations use the recorded `package.package_dir`, but zone-attribute
registration previously read `work_dir/package` unconditionally. The correction
uses the recorded directory, retaining the historical fallback only when no
package directory is recorded. A missing file in a recorded directory cannot
select an unrelated legacy file. Four tests execute the actual registration
block with conflicting real CSVs, compare URL/hash/size, cover absence and legacy
behavior, and detect a deliberately restored wrong-directory reference.
These tests mock registration and do not prove complete package custody.

## Installed project closure inspection

Inspection of installed AequilibraE 1.6.2 confirms that `Project.db_connection`
creates a `commit_and_close` context. Its normal exit commits and closes that
connection. `Project.close()` also calls `clean()`, which deletes disconnected
non-centroid nodes through another such context. Closing is therefore a database
mutation boundary, not just a handle release.

This does not prove that all callers or native components released their own
connections. In addition, `commit_and_close.__exit__` does not place `close()`
in a `finally` block, so a commit or rollback exception can bypass closure.
A capture implementation must preserve a failed-close refusal and must verify
SQLite consistency separately. Do not infer quiescence or copy safety solely
from a return from `Project.close()`. Native reopen and source-change tests
remain required before activating project transfer.
