# Independent populated upgrade and live guard verification

Reviewer A, September 7, 2026. The populated predecessor upgrade preserved its retained records without creating authority. Seventeen live baseline groups reached their assertions. Eleven deliberately broken guards failed for the expected reasons, after a harmless mutation survived. The earlier A1 defect is corrected in the tested migration. This is database engineering evidence, not agency adoption, legal applicability, browser acceptance or a v0.44 release decision.

The original `review-a.md` remains unchanged. I did not read reviewer B's work or edit application/test files.

## Isolated target and exact inputs

The independent target was `/tmp/owp-review-a/stack`, project `owp-independent-review-a`, database container `supabase_db_owp-independent-review-a`, API port 58321 and database port 58322. It was created from `git archive 3004393820ec6f2b05f7a00136bf887914da48b4 openplan/supabase`, with a distinct project ID and ports. All 266 predecessor migrations ran on that new stack. Root's 57321/57322 stack and the other installed stacks were not used.

The two new migration files were copied to `/tmp/owp-review-a/captured` before verification. Their SHA-256 values are:

| Migration | SHA-256 |
|---|---|
| `20260909000001_work_program_review.sql` | `543e1b10a07c6238bfa78f5ba85f74f4ea9a3d00043d3a32009d9abb239eeb8e` |
| `20260909000002_work_program_review_packets.sql` | `8ba82764736812e62f2343784b59cb2e6e52ae61e8b099a10c961a8c4a5df0fe` |

The final check compared their bytes with current source and found no drift. New migrations were applied in order using `psql -X -v ON_ERROR_STOP=1`, each inside an explicit transaction. This tested their SQL against the populated predecessor. The additional migrations were not installed through the Supabase migration-ledger command, so this does not claim migration-ledger deployment or a repeated-install test.

## Nonempty predecessor and upgrade comparison

Before applying either new migration, the predecessor contained synthetic owner, reviewer, viewer and outsider identities; a workspace/program; original/evidence document metadata; source attachment and extraction; two linked preparation revisions; a succeeded HTML export and queued XLSX export; and an extraction job. The fixture explicitly says it is synthetic engineering data with no agency authority.

Source attachment, preparation saves, export enqueue/claim/finish, extraction enqueue and extraction versioning used the predecessor RPCs. User/workspace/program/document records and one document-extraction row were synthetic setup through SQL. Export completion supplied synthetic metadata through the real old finish RPC. No real PDF rendering, Storage object upload or OCR execution occurred.

| Retained table | Nonempty row count |
|---|---:|
| `program_work_program_sources` | 1 |
| `program_work_program_revisions` | 2 |
| `program_work_program_extractions` | 1 |
| `kb_documents` | 4 |
| `kb_ocr_jobs` | 3 |

The comparison retained every preexisting JSON field and value in those tables, including IDs, timestamps, original checksums, source extraction content, revision hashes, previous/source references, job status, lease/custody fields and retained export identity. It excluded only the three newly added columns, which have no predecessor value. Before and after snapshots were equal. The canonical serialized predecessor snapshot SHA-256 was `722880368653ed5c1fd11435b8495230f61dd3e3699a3b5edaa378dcda3c012d`.

The new workflow, event, review-assignment and packet tables each contained zero rows after migration. Every historical revision had a null amendment baseline. Thus the migration did not infer adoption, create reviews or backfill spending authority onto preparation records.

The comparison was checked for sensitivity. A no-op transaction left the full snapshot equal. A rollback-only change to an original document title made it unequal. After rollback it matched again. This proves the comparison could reject a changed retained field; it does not prove protection against every possible migration omission.

## Live baseline groups

Every group ran in its own transaction against the same retained predecessor and rolled back. Expected denials caught a specific SQLSTATE. Reaching the next line without the denial raised a separately named `ASSERT_...` exception, so an unrelated error could not count as success. Each successful transaction also had to print `PROBE_REACHED` with exit code zero.

1. Adopt the current preparation through independent assigned approval; start an amendment; record external acceptance and spending evidence for the still-effective adopted revision; reject spending evidence for the pending revision; retain the old effective baseline. This is the live regression for A1.
2. Reject an incorrect expected sequence.
3. Reject an incorrect content hash.
4. Reject a workspace member recording spending authority, even after adoption.
5. Reject assigning the revision author as their own independent reviewer.
6. Recover an identical event request without duplication; reject changed-payload reuse of the same request ID.
7. Reject replay by an actor whose membership was revoked, even when the event had already been recorded.
8. Exclude a private review sentinel from a public packet and include that same sentinel in its internal counterpart.
9. Reject public packet creation without administrator disclosure acknowledgement.
10. Reject changing retained evidence checksum or deleting the evidence document.
11. Withdraw adoption, clear the effective baseline, retain the original adoption event and reject later spending authorization for the withdrawn revision.
12. Saving a new revision supersedes pending review tasks and rejects approval against the old revision.
13. Returning a review creates an undated task for the author; revising/resubmitting leaves exactly one active reviewer/return task.
14. Authenticated workspace members can read their populated workflow event; direct event writes and direct actor-bearing RPC calls are refused; an outsider cannot read the program's events, reviews or workflow state.
15. Packet enqueue retries return the same job; a failed/cancel-flagged job requeues under the same ID with cancellation cleared; a foreign finish lease is refused; valid finish records success; retained packet bytes cannot be reassigned by checksum update.
16. A regular workspace member cannot generate an acknowledged public copy.
17. A stale sequence cannot create a new packet snapshot.

Public-copy checks here concern SQL acknowledgement/role and event projection. They do not reproduce the A2 browser checkbox bug or verify its UI repair. Acknowledging full preparation/baseline disclosure remains a human act, and public packets intentionally contain selected preparation content.

## Mutation evidence

The first mutation reworded the workflow conflict error without changing control flow. The stale-sequence probe still reached `PROBE_REACHED`; this harmless mutation survived. Only then were targeted mutations run. Each replacement asserted that its target text appeared exactly once, preventing a silent no-op edit.

| Deliberate broken behavior | Observed intended failure |
|---|---|
| Remove null-membership refusal before retry recovery | `ASSERT_REVOKED_RETRY` |
| Remove expected-sequence comparison | `ASSERT_STALE_SEQUENCE` |
| Remove revision-hash comparison | `ASSERT_WRONG_HASH` |
| Disable administrator-only authority restriction | `ASSERT_MEMBER_AUTHORITY` |
| Remove author/submitter exclusion in reviewer assignment | `ASSERT_SELF_REVIEW` |
| Disable changed-payload/actor retry refusal | `ASSERT_CHANGED_RETRY` |
| Disable effective-baseline requirement for spending evidence | `ASSERT_PENDING_AUTHORIZED` |
| Disable public-review acknowledgement requirement | `ASSERT_UNREVIEWED_COPY` |
| Include private events in public packet projection | `ASSERT_PRIVATE_LEAK` |
| Keep the effective baseline after adoption withdrawal | `ASSERT_WITHDRAW_BASELINE` |
| Disable retained review-evidence identity comparison | `ASSERT_EVIDENCE_CHANGED` |

Mutations used `CREATE OR REPLACE FUNCTION` inside rollback-only transactions. No file replacement, DROP, reset or destructive cleanup was used. Final catalog checks compared the exact stored function bodies against all six definitions in the captured migrations: review-boundary trigger, event RPC, review-evidence trigger, packet-document trigger, packet enqueue and export finish. All matched after the probes. The full predecessor row snapshot also matched again, and the event table remained empty.

## Errors and limits retained

The first fixture completeness check failed because source attachment did not create an extraction-version row. I added a synthetic document extraction and invoked the predecessor versioning RPC before either new migration. The final nonempty comparison includes that version. The initial revocation probe failed on the unrelated last-owner protection. I corrected the fixture by appointing the existing reviewer as replacement owner before revoking the tested actor, then reran the complete guard set. Neither failure was counted as a product guard pass.

Supabase startup unexpectedly printed its generated local test-stack credentials. I reported that tooling error immediately. Raw startup output and credentials are excluded from this repository report. The stack contains no client records or real agency signatures.

Blind categories remain explicit. These probes do not establish HTTP authorization/header behavior, browser reachability, accessibility, desktop/390px behavior, recipient comprehension, real source/signature meaning, physical object-byte retention, rendering, worker process death, actual file arrival, complete production backup/restore, concurrent interleavings, or every database privilege/table. The revision/source custody comparison covers the named populated tables, not every table in the application. Packet recovery simulates worker state through SQL and tests the finish boundary; it does not run the worker. No claim of national procedural coverage or scientific validation follows.

## Reproduction and retained evidence

Scratch evidence is under `/tmp/owp-review-a`: `upgrade.py`, `guards.py`, `final-check.py`, `before.json`, `after.json`, `upgrade-result.json`, `guard-results.json`, `restoration-result.json`, captured migrations and one SQL/log pair per probe. The target is reviewer-owned. To rerun guard/restoration checks while it is running:

```bash
python3 /tmp/owp-review-a/guards.py
python3 /tmp/owp-review-a/final-check.py
```

Do not rerun `upgrade.py` against the already-upgraded target. It is a predecessor-to-successor rehearsal, not an idempotent reset tool. These scratch files are local reproduction material; this report preserves the essential method, identities, counts, failures and blind categories independently of their availability.

| Scratch script | SHA-256 |
|---|---|
| `upgrade.py` | `c6c07db80c39f593e86873a476a99c2089a1be6c87259e5f98857988f8d196e5` |
| `guards.py` | `42b38dd6d57ad234479ea0358a57cdba7bf86977ddf19784ab029dcd39394567` |
| `final-check.py` | `d7f5f93ba44e29d7d7d3b6256d6f5522613014ff5a2012706c3b39da4658dca0` |

The reviewer-owned stack was stopped after verification with backup enabled; its volumes were retained. No foreign process or stack was stopped. Only this new report was written in the repository by this follow-up. Final git status was inspected. Other edits belong to the implementing lane and are not described as reviewed final changes.

## Final migration addendum: authority fields and legacy retry recovery

Root subsequently found an actual-artifact defect: hidden authority, scope and decision-date fields from an earlier authority form could accompany a comment or amendment action. Root changed the UI command construction and added a database guard. The earlier evidence above remains a record of the first captured migration. This addendum supersedes its migration identity for final SQL acceptance and does not claim independent browser verification of the UI repair.

Final migration `20260909000001_work_program_review.sql` SHA-256 is `4abc63db4c5d8eeb79e78edecae549f5a2494377b6d674228805e0aa6c6993d6`. Migration 00002 remains `8ba82764736812e62f2343784b59cb2e6e52ae61e8b099a10c961a8c4a5df0fe`. I independently captured those files and repeated the populated upgrade on a new target, `/tmp/owp-review-a/final/stack`, project/container suffix `owp-independent-review-a-final`. It reused the free reviewer ports 58321/58322; the first reviewer stack remained stopped. Root's stack was untouched.

All 266 predecessor migrations ran on the new target, then the predecessor RPCs and synthetic setup populated the same five retained table families: one source, two revisions, one extraction version, four Documents and three jobs. The final two migrations preserved every compared predecessor field and created no authority/review/packet records. The new independent snapshot SHA-256 is `ef0e5c722a185eb9dc95840e49e23b4d1712514011612c924e5028f018eab151`; new fixture IDs/timestamps explain its difference from the earlier run.

The final guard run contains 19 baseline groups, two harmless survivors and 13 intended mutation failures. All 17 earlier baseline groups and 11 earlier targeted mutations were rerun against the final SQL. Added evidence is:

- Each of `submit`, `comment`, `resolve_comment`, `return`, `approve` and `start_amendment` rejects each individually populated `authority`, `scope` and `evidenceDate` field with SQLSTATE 22023. These are 18 separate denial probes. A clean comment still succeeds.
- Rewording only the new authority-field error survives the complete field-scope probe, supplementing the original harmless conflict-message mutation.
- Disabling the new guard lets a comment carry hidden authority and causes `ASSERT_HIDDEN_comment_authority`. The targeted probe uses a valid comment, so an unrelated missing reviewer or invalid transition cannot count as the failure.
- Within one rollback-only transaction, the previously captured event RPC records a synthetic legacy comment containing an authority field. The final RPC then recovers that exact request with the same event ID and without duplication. Changing the note under that request ID is still refused with PT409.
- Moving the new field guard ahead of exact retry lookup causes the legacy replay to fail with `Authority fields require an authority record`. This deliberate ordering mutation demonstrates why the final guard belongs after authenticated exact retry recovery.

Final catalog comparisons again matched all six function bodies to the captured final migrations. The retained predecessor row snapshot matched after all probes; no events remained. A harmless snapshot control survived, while a rollback-only document-title change was detected. Current repository migration bytes matched the final capture at that check.

The final scripts and SQL/log/result evidence are retained under `/tmp/owp-review-a/final`. The legacy retry probe additionally reads the first captured RPC from `/tmp/owp-review-a/captured`. Script hashes are:

| Final scratch script | SHA-256 |
|---|---|
| `upgrade.py` | `2bc829b1bf2113c89e8f5c8e866999ee8d0ab88a4c9c4297d74f93a85c5cbe1a` |
| `guards.py` | `23f69d061627d2bac6ef55e94200301c3cbaf072d579772cee85352c3a69c36e` |
| `final-check.py` | `6a10efe12dc7b41311216565de111ab3355f8c4b47c4ebea19e23f71fde300c6` |

All earlier blind categories remain. In particular, this proves database command meaning and retry ordering; it does not inspect the corrected browser form, exported artifact content or actual agency authority. The final stack startup output was filtered before display and retention, preventing a repeat of the earlier credential-output error. The final reviewer-owned stack was stopped with backup enabled after verification, retaining its volumes.
