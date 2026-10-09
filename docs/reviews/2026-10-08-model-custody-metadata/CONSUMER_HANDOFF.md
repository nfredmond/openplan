# Retained model evidence must reach planner handoffs

October 9, 2026. Source inspection at `cf4074edf54b6c8aae6fd7faf550628db91b5298`.
This is an implementation decision within roadmap S1, not a second roadmap or
completed export acceptance. The native Storage and reply-loss checks in
[the ingestion record](INGESTION_DESIGN.md) establish narrower writer behavior.

## Confirmed integration gap

The new attempt-specific custody table has no application consumer in the
inspected `openplan/src` source. The three existing comparable-evidence readers
still query `modeling_validation_instrument_v2_custody`. Replacing that table
name alone would both break access and discard essential identity distinctions.

| Boundary | Source | Finding |
| --- | --- | --- |
| Read authority | Migration `20261016000014_model_attempt_command_custody.sql`, lines 635–668; all subsequent migrations through 23 | The new custody table enables RLS and revokes every table privilege from PUBLIC, anonymous, authenticated and service roles. No later SELECT grant or policy was found. Command receipts remain private. |
| Project freeze | `openplan/src/app/api/projects/[projectId]/evidence-bundles/route.ts`, `POST` | The route checks the authenticated user and project permissions, then passes the caller client to `loadProjectEvidenceGeneratedFiles`. The service client in the same route does not authorize the generated-record reads. |
| Project export | `openplan/src/lib/project-evidence-bundles/generated-records.ts`, `evidenceRows` | Reads historical v2 custody with workspace and model-run filters and complete pagination. Both the exported JSON and revision hash omit attempt-specific custody. Artifact metadata alone cannot reconstruct the missing custody relationship. |
| Reports | `openplan/src/lib/reports/run-citations.ts`, `newestComparableByRun` | Keeps one historical comparable record per parent run. Reusing this map for new custody would collapse two methods or multiple attempts into one record. |
| Assistant | `openplan/src/lib/assistant/chat-tools.ts`, comparable query | Reads historical v2 rows, newest first, with a limit of ten. It has no attempt-specific reader or indication that such records were omitted. |
| Export regression | `openplan/src/test/project-evidence-generated-pagination.test.ts` | Covers pagination of historical tables. Its mock does not enforce selected columns or scope filters and has no attempt-specific fixture. It cannot prove the missing handoff. |

The historical table permits one record per run and does not carry the new
method, stage, attempt and output identity. Preserve those historical records
without inferring their missing fields from a parent run's engine name.

## Implementation decision

Add authenticated, read-only access to the new custody table through an additive
migration. Require membership in the row's workspace and a readable parent run
with the same workspace. Use the existing historical member-read policy as a
starting point, then verify the actual native policy behavior. Do not grant
access to command receipts, write contexts or direct custody mutation. Do not
switch project export to a service client to bypass the missing read policy.

Export the records as a separate attempt-specific collection. Each record must
retain workspace, run, stage, attempt, demand method, output artifact and hash,
the five instrument artifact identities and hashes, creation time and scientific
outcome. Include this collection in the modeling revision hash. Retain complete
pagination, deterministic ordering and refusal on any failed page. A failed read
must not become an empty successful collection.

Reports and assistant responses need the same method-specific identities. Keep
historical citations available separately. A report may cite an explicitly
selected attempt and method; a parent-run key or creation timestamp alone must
not choose the scientific result. An assistant response must retain any paging
or truncation boundary and must not describe the newest record as accepted.
These records remain inconclusive. No consumer may raise their claim tier.

## Required evidence before calling this handoff complete

- Native read checks over a populated isolated database: a member reads both
  methods; an outsider and anonymous caller cannot; removed membership loses
  access; direct writes and receipt reads remain refused. Retain records across
  the migration and verify the member's parent-run visibility.
- Export tests with both methods under one parent and more than one attempt.
  Assert query projections, workspace/run filters, every retained identity,
  later-page refusal and revision changes when retained custody changes.
- Harmless controls survive. Targeted faults that remove a method, omit the
  output hash, collapse attempts or bypass workspace scope fail for those
  reasons. Restore all mutations and record each check's blind category.
- An authenticated freeze produces a usable downloaded artifact. Inspect its
  actual bytes and both method records. Exercise report citations and assistant
  retrieval from real navigation on an identified build at desktop and 390px,
  with console review. T3 screenshot failure currently leaves this unproved.

Supporting source publication remains a separate, necessary part of the same
handoff. The current joined proof uploads six evaluated files per method.
Observation, structural and other supporting files still need an immutable,
complete, hash-checked publication manifest and recovery verification. A JSON
record containing a local path or Storage URI is not an independently usable
source archive. The reader change alone cannot close that requirement.

Normal dispatcher enrollment, independent model acceptance for each published
use, nationwide evidence and practicing-planner acceptance also remain open.
This decision does not reduce the V1 contract or authorize a release.

## October 9 read and project-export implementation

Migration 24 adds SELECT for authenticated callers under workspace membership
and visible same-workspace parent-run policies. It changes no retained rows and
grants no direct writes, service-role table reads or receipt reads. The Supabase
CLI created the migration; its filename was placed after migration 23 in this
repository's existing October 16 migration sequence. The inventory check reports
396 migrations, with no duplicate timestamps, empty files or invalid filenames.
The design follows the distinction between grants and row policies in the
[Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

Generated project modeling evidence now includes `attemptInstrumentCustody` as
an additive collection. The collection preserves both methods, repeated attempts,
all six artifact identities and hashes, and inconclusive outcomes. It is included
in the revision hash and has its own evidence descriptors. Historical comparable
records remain separate. Failed reads abort export generation.

The two focused export and route suites pass 16 tests. The expanded pagination
fixture asserts the new query's complete projection and exact workspace/run
filters, retains seven records with both methods and repeated attempts, detects
a changed output hash in the revision token and refuses a later-page outage.
[Eight export controls](prototype/instrument-export-controls.json) include
harmless and restored passes and six targeted failures. These are generated-file
checks with a mocked database, not a native authenticated freeze or download.

[Sixteen native access controls](prototype/instrument-member-read-controls.json)
run over ten populated custody rows in a fresh clone. They cover a new viewer,
an owner in another workspace, membership removal, parent-run hiding, prohibited
reads and actual direct-write refusal. Five transactional policy/grant faults
fail for their intended reasons; harmless and restored controls pass. All custody
rows remain unchanged. Postgres role/JWT-sub settings are explicit, but real Auth
issuance and PostgREST access are not exercised by this script.

Private candidate records under `instrument-member-read-20261009a` through `e`
account for five isolated databases. The first run used the last owner as the
removal fixture and correctly hit the unrelated last-owner protection. Later
runs use a fresh viewer; the final run also creates a separate-workspace owner.
No source database, browser acceptance stack or running server was changed.

Focused lint passes. The first whole-app TypeScript check exhausted Node's
default heap. One retry with a 3 GiB Node heap inside a 4 GiB, no-swap scope
also exhausted its heap. Whole-app type checking remains unverified locally.
Reports and assistant readers,
source-file publication, native application freeze/download and desktop/390px
browser acceptance remain unimplemented or unproved by this checkpoint.

## October 9 report and assistant consumers

`models/attempt-instrument-read.ts` now supplies a complete, stably ordered
attempt-custody read. It uses the existing pagination helper and discards any
prefix when a later page fails. Report resolution retains an array per cited
run. It does not select a newest method or attempt. Generated report HTML includes
each retained record's workspace, run, stage, attempt, method, outcome, timestamp
and all six artifact identities and hashes. It escapes the text and allows long
hashes to wrap. Layout and actual downloaded-report acceptance remain unproved.

`get_model_run_results` uses the same reader with an explicit workspace filter.
The response carries `available` or `read_failed` separately from the records;
a failed lookup is never presented as an absent instrument. Historical records
remain separate and all new attempt assessments remain inconclusive. Both the
report-generation route and chat route pass their authenticated caller clients,
not their separately available service clients, into these readers.

Four focused suites pass 92 tests from the application package directory.
The first invocation ran from the repository root and two existing source-file
checks failed to locate package-relative files. Rerunning from `openplan/`
corrected the invocation without changing those assertions. The tests exercise
the real report reader and HTML builder, the actual assistant tool, scoped query
projections and pagination under a two-row response cap. Focused lint passes.
[Nine consumer controls](prototype/instrument-consumer-controls.json) retain
harmless/restored passes and seven intended failures: omitted output hash,
dropped method/attempt, omitted workspace, hidden read failure, wrong report
parent, omitted report markup and hidden assistant failure.

These are synthetic database-mock checks. Native authenticated REST readback,
report download, browser navigation at desktop and 390px, supporting-source
publication and scientific/human acceptance remain open. The previous native
migration checks establish a separate database-policy boundary, not those paths.

A scoped TypeScript check passes for `attempt-instrument-read.ts`,
`run-citations.ts`, `html.ts`, `chat-tools.ts` and their imported dependencies.
The temporary configuration extends the application `tsconfig.json`, includes
`next-env.d.ts`, resolves the application's `node_modules/@types` and disables
incremental output. The initial temporary configuration omitted that ambient
type root and reported missing GeoJSON types; correcting the configuration
resolved those errors. The check uses a 3 GiB Node heap within a 4 GiB no-swap
scope. This is not a passing whole-application type check.
