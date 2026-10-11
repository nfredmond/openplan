# Retained archive and parser artifact custody

`withGtfsParsedArtifact` connects an owned attempt's retained archive to the
existing Storage reader and supervised parser. It expects an archive already
identified by the database. It does not fetch a publisher URL, prepare an upload,
publish rows or enroll an import route.

The helper saves a private binding before reading Storage. That binding includes
installation, target, workspace, feed, original actor, version, attempt token,
archive hash and size, parser build, parser limits and output bound. A different
binding cannot reuse the directory. The worker installation must supply the
actual deployed parser build when this helper is connected to its runner.

Archive files become visible at their fixed local path after file sync, through
an exclusive link that refuses an existing destination. Every reuse checks the
private regular file, byte count and hash through the same open descriptor later
passed to the parser. The helper confirms archive custody through the owned
command dispatcher and records the parsing stage before starting the child.

The production parser runs through the existing supervisor, with bounded memory,
runtime and independent renewal. Its output and containing directory are synced
before the completion record. The consumer receives a verified read-only output
descriptor, receipt and cache status. The descriptor closes before the helper
returns. Parser refusal remains a refusal artifact, not a ready database version.

After restart, the helper renews ownership, verifies both retained files and
reuses the exact output. It does not parse again or refetch changed source data.
Missing, changed or oversized acknowledged output is refused. An interrupted
parse without a completion record can restart from the verified retained archive.

## Verification

The final combined suite passes 196 tests, including 39 artifact tests and the
existing attempt, dispatcher, journal, parser-supervisor and retained-archive
suites. Scoped TypeScript and ESLint pass. The tests use actual private files and
locks, the installed SDK with controlled responses, and a controlled supervisor
for the artifact unit cases. The existing supervisor suite runs real children.

[The control record](worker-artifact-controls.json) identifies the source and test
hashes for 34 runs. Baseline, harmless-comment and restored source pass; 31 broken
variants fail assertions. They cover identity, private files, exact bytes, bounds,
schema/path restrictions, sync ordering, confirmation/stage calls, cancellation
and saved completion. An earlier control survived because the later saved-output
size check masked removal of the pre-save check. The corrected test also requires
that oversized fresh output never receive a completion record. The final control
fails for that missing boundary. Initial fixture URL expectations were corrected
against the installed SDK and existing reader tests before these controls ran.

[The native proof](worker-artifact-native.json) uses the retained 892,312-byte
public BART archive, a separate private Storage service on the isolated proof
database, and the production parser child. It produces 14 routes and 287 stops.
The proof kills its own process group after the output record is saved, observes
lock release, and starts a new process. Recovery returns the same output hash
with zero downloads and one renewal. Only one parsed output file exists. A third
process refuses changed output bytes without downloading an archive.

The native Storage service is limited to 512 MB and removed after fixture
cleanup. Parent maximum resident memory is recorded separately in the proof;
it is not the total process-group peak. The parser heap is limited to 384 MB.
Renewal and lifecycle replies in this proof are controlled responses, so it does
not prove native database ownership, fencing or publication. It also does not
prove power-loss recovery or largest-feed capacity.

## Remaining integration

Next validate the parsed artifact's complete domain shape and map it through the
existing route/stop mapping functions. Bind ordered batches and completion
metadata to the artifact receipt, preserving parser route/stop counts for later
adoption. Connect URL/catalog acquisition, uncertain Storage-write reconciliation,
ordinary adoption and queue polling. Files left by interrupted parsing need an
explicit cleanup policy before an unattended worker is enabled.

Native database/HTTP recovery and concurrency, promotion lock ordering, late
Storage writes after cancellation, operating budgets, populated upgrade/restore,
full branch CI and T3 desktop/390px journeys remain required. The candidate SQL
is unchanged. No main merge, resumable-import release, scientific acceptance or
v1 completion is declared by this checkpoint.
