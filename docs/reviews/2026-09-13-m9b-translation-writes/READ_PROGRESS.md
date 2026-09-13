# Translation inventory continuation

The release checkout remains fixed at 18c50222 for v0.58.0 CI and publication.
The next implementation is isolated at
/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13,
branch work/translation-command-workflow. It is not a release or a complete
translation-write implementation. NEXT.md retains the full workflow.

The editor's category, published-question, active-option and saved-translation
reads stopped after one PostgREST response. New regression cases failed on the
old code for both a two-row server cap and 1,005 stored rows. The loaders now
reuse readEveryPage, apply a unique id ordering after the existing display order,
continue successful short pages to an empty page, and discard partial results
when a later page fails or the safety ceiling is reached. Existing schema-pending
and published/active filters remain. The source/translation projections are
asserted in the new tests. Existing query doubles now model ranged exhaustion.

Four focused files passed 123 tests after the page-level double was updated.
The first broad run failed 55 page tests because that double terminated after
two order calls; the new third unique-id order exposed it. An earlier command
used --root from the repository root, which did not change process.cwd and broke
file-based tests. Another mutation-runner attempt expected 121 tests instead of
the observed 123; its baseline tests passed but the result assertion failed.
These are retained failed attempts, not passing verification. Final checks and
source hashes must be recorded after their commands finish.

Pagination proves exhaustion for a stable dataset, not a transaction snapshot
across concurrent edits. This remains preparation for the exact-source/version
write workflow, not evidence that stale saves, source races or billable retries
are fixed. No new identified browser journey or installed-data read of the new
loader is claimed here. The fresh checkout has no provisioned worker Python environments. A focused
JSON test report identifies seven skipped worker-import/control cases; their
names are recorded in complete-read-checks.json. These explain the seven extra
skips versus the release checkout. The absence of .env.local was initially
noted as a possible cause; the named report establishes the worker environments
as the reason instead.

## Lock analysis must include foreign keys

A read-only catalog query on the retained disposable schema328 confirmed eight
translation foreign keys. See translation-foreign-keys.json. Migration
20261014000008 adds real category/question/option/response foreign keys with
cascading deletes, in addition to campaign/workspace relationships. The source
address is no longer protected only by a polymorphic trigger. An earlier trigger
inventory filtered out internal triggers; it cannot describe these cascades or
the referenced-row locks taken by inserts. Do not use it as a complete lock map.

The configuration capture function locks the campaign row. Translation changes
capture configuration; source deletion can cascade into translations. Existing
response writes also take the campaign's engagement-response advisory lock.
These facts mean that simply locking a campaign first and then writing target
translations has not been shown safe against source deletion. Taking source rows
first also needs campaign/workspace deletion and whole-batch analysis. No
concurrency-safe order is established by this note.

The transactional implementation must exercise actual inserts and cascades with
multiple connections. Preserve the foreign keys and retained history. Consider
explicit nonblocking/bounded lock acquisition with a retryable, noncommitted
outcome if a uniform order cannot cover existing source writers; that is a design
option to test, not implemented behavior. Never use an automatically retried
40001 to hide business conflicts or rerun a paid generation.

## Final local checkpoint

After fixing the page-level query double, all 123 focused tests passed. The
expanded mutation runner also passed its expected outcomes: baseline and a
harmless comment survive, while stopping after one page, ignoring incompleteness,
omitting the unique order and dropping a source projection fail named assertions.
The full unit suite exited 0 with 14,344 passed and 460 skipped, followed by
successful complete TypeScript and changed-file lint checks. Source/log hashes
and the seven named unprovisioned-worker skips are in complete-read-checks.json.
No full QA/build, shuffled, new browser or installed-loader acceptance is claimed.

Continue implementation and verification from NEXT.md. The v0.58.0 release
candidate remains exactly 18c50222; do not tag this next-work checkpoint as v0.58.
