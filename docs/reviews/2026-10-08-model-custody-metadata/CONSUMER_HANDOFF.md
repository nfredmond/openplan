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
