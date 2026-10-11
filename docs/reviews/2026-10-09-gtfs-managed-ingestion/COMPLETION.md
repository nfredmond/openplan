# Managed GTFS completion checkpoint

The candidate now commits ready status and its receipt together after checking
current ownership, the retained source archive, expected parsed-output identity,
complete row and batch totals, exact batch manifest and actual stored counts.
Terminal replay returns the original receipt. A changed request fails, a new
completion command cannot complete a ready version again, and the execution
record releases its active token and lease. The completed feed remains unadopted.
No route or worker uses these new commands yet.

Tract computation reuses the existing spatial join under guarded transaction
context. Its private receipt retains one outcome per attempt. Successful zero-row
analysis has a timestamp and numeric zero. A failed join retains a failure code
and bounded detail with no numeric result or completion timestamp. The function
rechecks ownership after computation; query cancellation or ownership refusal
rolls back rather than becoming a tract-analysis result. An ordinary tract query
error rolls back partial tract writes and retains an unavailable outcome, matching
the existing import behavior that keeps route/stop results usable independently.

The worker must still verify the actual parsed artifact against its saved hash.
The database compares declared identity and stored rows; it cannot read those
private local bytes. No schedule validation, real-world service measurement or
scientific claim changes here.

## Native evidence

The [control record](completion-controls.json) covers 67 outcomes. Baseline,
harmless-comment and restored cases pass, while 64 broken variants fail the
intended assertions. New cases exercise truncated planned output, changed plans
and manifests, receipt totals that differ from stored rows, changed archive
identity, missing tract outcomes, altered tract rows, invalid parser metadata,
exact terminal retries, current membership, execution closure and denied client
calls. The full earlier admission, archive and batch checks remain in the run.

Three synthetic imports prove successful zero-row tract analysis, a one-row
polar test polygon and a simulated SQL query failure. The latter replaces the
tract function only within the rollback transaction and uses SQLSTATE 08006. It
is a query-error fixture, not a physical network-disconnect test. A separate
injected computation expires its own lease; final ownership refusal rolls back
that command. This tests the recheck, not a long-running worker heartbeat.

The initial test-run setup finds a mutation target that is no longer unique
after adding receipt functions. The batch mutation now names its exact exception
instead of altering unrelated checks. Test identifiers also distinguish the
worker token variable from the database column. The receipt-corruption fixture
runs before the first tract outcome, so a duplicate-outcome guard cannot mask
the actual stored-count check. All function replacements, synthetic rows and
candidate schema changes roll back. A separate connection confirms the candidate
schema is absent after every case.

The [advisor comparison](completion-advisor-summary.json) uses the same pinned
official Supabase SQL and baseline as the prior checkpoint. It finds no new
security warning/error or missing foreign-key index. Fourteen informational
notices remain for unused new indexes and intentionally policy-free private
tables. This does not clear historical findings in the isolated proof database.

## Remaining implementation

Adoption still needs the existing material-shrinkage review and atomic current
feed transition. Managed failure/cancellation, cleanup custody, queue and read
commands remain unfinished. The worker must connect durable journals, actual
Storage bytes, independent parser renewal and these database commands through
all three import doors. Committed lost-reply recovery and concurrent replacement
must be repeated against the candidate, followed by upgrade/restore and identified
desktop/390px T3 journeys. The rollback tests do not substitute for those checks.
The candidate remains outside v0.68 and is not ready to merge.
