# Explicit network settings, October 9, 2026

The shared network-settings validator previously treated a persisted
`road_class_factors` value of null, false, zero, an empty string or an empty list
as an empty map. The builder's `value or {}` fallback silently changed malformed
records into an unadjusted network. That could give an invalid saved record the
same canonical identity as an explicit baseline.

Persisted settings now require an object for `road_class_factors`. The builder
retains its intentional omitted/None baseline default but rejects other
non-object inputs with `AssignmentSettingsError`. An explicit empty object
remains valid. Named factors retain their sorted numeric canonical form; invalid,
nonfinite, boolean and nonpositive values still fail. No historical record is
rewritten or silently repaired.

## Verification

Fifty related tests pass across network settings, directed graphs, initial
snapshots, preparation links and live profiles. Five new settings tests cover
explicit baseline semantics, malformed containers, canonical values and invalid
individual factors. A new snapshot test verifies that malformed persisted maps
stop before files or execution.

Six temporary-source controls pass their expected outcomes. A harmless comment
survives; removing persisted-object validation fails both the direct null test
and the pre-execution test. Restoring the builder's false-value fallback fails
its domain-error check. The controls do not alter the real source. Results and
source hash are in `prototype/network-settings-controls.json`.

The existing 30 ActivitySim assignment-handoff checks also pass in the lightweight
Python environment. Native-only cases in that script may self-skip. This change
has no new native engine, database or scientific acceptance claim. The focused
worker workflow now includes the settings test. Exact-head GitHub CI remains
required.

## Integration and v1 scope

The current roadmap, contract and requirements ledger were inspected again.
M9b acceptance, the remaining agency workflows, nationwide authority coverage,
normal managed dispatch and independent scientific acceptance remain open.
`main.process_stage` still uses its legacy claim path. ActivitySim's explicit
admitted entry is connected, but normal polling does not create that context.
The prepared-source and native transformation fixtures do not establish an
operational managed model pipeline. This correction removes a reproducible input
defect; it does not activate that pipeline or alter the v1 contract.
