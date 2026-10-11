# Public grant audit keeps private schemas separate

The first bounded full-suite batch records 699 passing tests and three failures in the public grant inventory. The parser reads `REVOKE ALL ON ALL TABLES IN SCHEMA openplan_gtfs` as a blanket revoke on every public table. That makes 563 public policy promises appear unreachable. This is an audit defect, not a reason to grant clients access to private execution tables.

The parser now checks the explicit schema list before expanding a blanket grant or revoke. Public lists still reach public tables, including a list that also names a private schema. Named statements retain public and unqualified tables while excluding private names. Quoted schema names follow the existing inventory normalization. Public privilege lookup returns no hold for a private table.

[Three-file regression](grant-schema-restored.json) passes all 39 tests. Strict changed-file lint and scoped TypeScript pass. The first scoped TypeScript invocation exposes two nullable-helper callers and a missing type root in the proof configuration. The callers and proof configuration are corrected before the final checks. [Controls](grant-schema-controls.json) preserve baseline, harmless comment and restored passes. Removing the private blanket filter fails five assertions. Removing the named-table filter fails two. Losing public blanket statements while keeping the private filter fails three. The replay regression specifically reports that the public grant remains held after its revoke was discarded. Each variant fails its named regression assertion and restores the original source in `finally`. [The runner](verify_grant_schema_controls.py) records actual failing names and the restored source hash. The final 1 GiB, swap-disabled control service peaks at 279.6 MiB.

[A separate native read](native-grant-schema-public.json) confirms authenticated SELECT on public notifications and translations. It also confirms no authenticated SELECT or UPDATE on private GTFS executions. This reads actual PostgreSQL privileges. It does not replace the live row-policy or ownership checks.

The inventory follows public table privileges. It does not audit private table privileges, changed search paths, dynamically computed schema names or live row filtering. It keeps those boundaries visible instead of treating a private revoke as a public permission change.

## Full candidate regression remains in progress

The original full-check service passes lint and deadcode, then reaches its 1 GiB cgroup limit during Vitest. [The first memory record](full-candidate-memory-failure.json) retains that interruption. A 2 GiB retry then reaches its separate 768 MiB Node heap limit in test workers. [The retry record](full-candidate-resume-memory-failure.json) retains that failure. Neither interrupted run establishes a full-suite result.

The next run partitions the same default discovered test files into serial 60-file processes with one Vitest worker. This avoids retaining the whole suite in one process. It adds no assertion exclusions and verifies that each batch executes exactly its declared files. The original failed batch and logs remain private. Full local regression, current GitHub CI and release verification remain pending at this checkpoint.
