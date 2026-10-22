# PR329 reader projection correction

October 15, 2026 UTC, October 14 Pacific. This corrects the parent's accepted
additional P2 against exact candidate `677369b27ef234182ce8a60598e35f7060416276`.
The collector refuses malformed consumed fields before signing or publication
and validates equivalent cached projections before reuse. Approved roadmap
artifacts stay unchanged. Parent retains review, integration and fresh CI.

## Checkout and original findings

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-440ee3b4`,
branch `t3/validate-collector-file-numeric-fields`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. Fetch and fast-forward reach
`origin/main`, `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`, then the exact
candidate. Both fetched references match the brief. No unrelated changes
exist, and no existing candidate or independent-review checkout changes.
Ownership covers the collector, focused tests/controller and this directory.

The full [second independent report](INDEPENDENT_REVIEW.md) is copied from
review commit `d4c71fc361a42f452c2c788c52122ed52cd2eb7a` byte-for-byte.
The [prior independent report](../2026-10-15-pr329-malformed-receipts/INDEPENDENT_REVIEW.md)
and its separate [response](../2026-10-15-pr329-malformed-receipts/RESPONSE.md)
remain unchanged. Their disagreements and residual boundaries remain valid.
This response does not replace either report with an approval.

AGENTS.md, shared coordination and current continuation, binding contract,
roadmap, core ledger and direction review inform this bounded correction.
The nested-package `npm run product:direction:check` passes with existing
expiry, release-version and intervening-change reminders. Planner-writing
and prove-it apply. Only GPT-6.1 Sol with high reasoning runs. No nested
agent or other model runs.

T3 taskId:
`node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-pr329-reader-projection-fix-20261015-round1`.
Live T3 configuration confirms the corresponding `thread:` identity and
Sol/high selection. Completion returns through the existing T3 task.
PR329 is linked internally to this thread. No GitHub mutation occurs.

## Exact consumed projection policy

The actual unchanged `digest.py` and `full_text.py` define this boundary.
`digest.py` indexes filename/additions and sorts with unary minus on additions.
`full_text.py` indexes filename/additions/deletions. Both consume PR changed-file
count; digest also formats PR additions/deletions and merge SHA. Their comment
and review projections retain the accepted earlier validation.

The [official schema extract](github-consumed-schema-extract.json) comes from
GitHub's [pinned OpenAPI source](https://github.com/github/rest-api-description/blob/507b88ecbdccb4789ce77228fa2f2fde4bdeaf1f/descriptions/api.github.com/api.github.com.json).
The documentation fetch matches the previously retained full-source SHA-256,
`2d18c7b121c209aa40a5c92ea462af1f7955603fc3ec530ab0466549498d14cf`.
No research corpus or live PR endpoint is fetched.

- File rows require explicit filename, status, additions and deletions.
  Filename retains the existing nonempty string rule. Status requires a
  string, without adding enumeration or path semantics. Additions and
  deletions require actual Python integers, excluding booleans. Missing,
  null, strings, floating values, nonfinite values, lists and objects refuse.
  Zero remains valid. There is no numeric coercion.
- PR additions, deletions and changed_files require actual integers, excluding
  booleans, in raw responses and cached projections. The existing nonnegative
  changed_files rule also applies to reuse. The pinned additions/deletions
  definitions have no minimum; this correction adds type requirements, not
  new numeric range semantics for those fields.
- PR merge_commit_sha must be explicit and either string or null, matching
  the required nullable schema property. Missing source data cannot become
  an apparently valid null. Existing PR number/title/state checks remain;
  cache reuse validates title/state and these consumed projection fields.
- File status is retained projection metadata. Neither reader currently
  displays it. PR commits, timestamps, merged_at, user/base/head are not
  consumed from this collector by either reader, so their existing projection
  remains unchanged. Corpus title/state/body/author/timestamps come from the
  separate `pull-requests.jsonl` input and are outside this collector's fields.
  This is not full upstream schema validation.
- Every comment still requires explicit string body, explicit user with
  null or string projected identity, and endpoint-specific string metadata.
  Raw non-null authors still require a string login. Deleted authors, empty
  comment/review bodies and original truncation limits remain valid.

Raw file and PR validation runs before projection signing and publication.
Reuse calls the same file/PR shape validators and existing projected comment
validator, even with a newly computed matching digest. New receipts require
`collection.consumedProjectionPolicy: "required-reader-fields-v1"`, alongside
the existing comment policy. Old v2 receipts refresh even when their shape
looks valid: missing merge SHA had already become null during old projection.
A digest cannot recover that lost distinction. Failed refresh keeps the old
path and exact bytes and prints no fresh-success line; valid recovery replaces
it atomically. No historical capture is rewritten here.

## Focused controls and actual reader execution

Final acceptance campaigns run serially on installed Python 3.11.15 and
3.14.4. [Campaign 04](campaign-04-python311/controls.json) and
[campaign 05](campaign-05-python314/controls.json) each run four complete
25-method cohorts and 63 targeted source faults. All intended outcomes match.
The harmless comment survives; `finally` restores exact collector bytes.
Both receipts bind collector, tests, controller and both unchanged readers.

All 19 original methods remain. Eighteen method ASTs are unchanged. The
malformed-file fixture gains valid status/count fields to isolate its original
filename failure. The shared PR fixture gains valid required consumed fields.
All 39 original literal fault tuples and three original special faults remain.
The 21 additional faults cover new validation, policy, ordering, recovery and
both-reader assertions. No original method or fault is removed or disabled.

Six new methods cover consumed raw fields, cached fields with recomputed
digests, old projection policy, failed-refresh preservation/recovery, actual
both-reader valid inputs, and actual malformed historical inputs after refusal.
Representative observed targeted failures on both interpreters include:

- `allow-file-additions`, `allow-file-deletions`, `allow-file-status`,
  `allow-pr-additions`, `allow-pr-deletions` and `allow-pr-merge-sha` fail
  `test_consumed_source_fields_are_refused_before_signing` at
  `malformed consumed source field must refuse before signing`.
- `consumed-validate-after-signing` fails the same method at
  `Expected 'digest' to not have been called`.
- `skip-file-cache-validation`, `skip-pr-cache-validation`,
  `allow-boolean-cache-pr-changed-files` and `allow-negative-cache-file-census`
  fail `test_consumed_cache_fields_refuse_even_with_recomputed_digest` at
  `malformed consumed cache field must refuse despite recomputed digest`.
- `reuse-old-consumed-policy` fails
  `test_prior_consumed_projection_policy_requires_refresh` at
  `prior consumed projection policy must refresh erased distinctions`.
- `consumed-erase-before-refresh`, `consumed-unlink-before-refresh`,
  `consumed-success-before-refresh` and `consumed-skip-recovery-publication`
  fail `test_consumed_bad_refresh_preserves_history_and_recovers` at the
  historical-byte, historical-path, no-success-line and replacement assertions.
- `reject-zero-file-counts` fails
  `test_actual_both_readers_accept_zero_ordinary_deleted_empty` at
  `valid zero/ordinary counts and deleted/empty comments must collect`.
  `corrupt-counts-for-readers` fails that method at
  `both readers must retain actual file counts`.
- `allow-malformed-source-before-reader-probe` fails
  `test_actual_readers_expose_historical_malformed_input_after_refusal` at
  `malformed source cannot publish before actual reader probe`.

Both actual reader programs run under the campaign's interpreter using
synthetic zero/ordinary data, null/non-null merge SHA, deleted authors and empty
bodies. Assertions inspect actual digest output and full-text batch artifacts.
The inherited actual-full-text method still checks the last file, manifest,
null identity, retained text and truncation. Both consumers remain byte-identical
to the candidate.

Malformed-source cases first run actual collector main and assert refusal and
absence of publication. Only then do tests directly write synthetic malformed
historical files to characterize the unchanged readers. `additions: "one"`
crashes actual digest with unary-minus TypeError but full_text formats it.
Missing filename fails both with KeyError. Missing deletions fails full_text
with KeyError but digest completes. Thus reader completion cannot stand in for
projection validation. The new collector refuses all three shapes first.

The controller still requires the exact named failed method and assertion
diagnostic and rejects source echoes, unrelated failures/errors, syntax errors
and incorrect exit outcomes. Its full-cohort census is now 25. The separate
[classifier probe](verify_controller_classifier.py) tests 15 transcripts per
interpreter, including refusal of both old 12- and 19-method cohorts. Each
interpreter also runs a harmless controller survivor and nine targeted parser
faults in temporary copies. Each fault reaches
`Controller misclassified synthetic runner transcript` for its named case.
Working controller bytes stay unchanged. These synthetic classifier controls
are distinct from actual execution of the full unittest campaigns.

## Retained attempts and provenance

Campaign 01 stops at a duplicated identity diagnostic anchor in the new PR
projection helper. The new PR projection identity diagnostic is made
distinct, preserving the original identity fault. Campaign 02 detects assertion
failures mixed with TypeErrors when a draft changed_files mutant skips type
validation but still compares malformed values with zero. The strict classifier
refuses that campaign. The final mutant targets boolean census acceptance
without an unrelated exception. Campaign 03 passes the earlier 62-fault version;
campaigns 04 and 05 add the explicit negative cached-census control. None of the
incomplete or superseded campaigns substitutes for the final source bindings.
The initial 25-method test output is also retained as historical draft evidence.

[Provenance](provenance.json) records exact source hashes, preserved methods and
faults, task identity, review bytes and approved-artifact checks.
[Transcript archives](transcript-archives.json) retain every new transcript,
including failed campaigns, without whitespace normalization. Archive readback
compares member names and exact bytes before removing loose log copies.
Earlier correction evidence remains untouched. Eight approved artifacts match
`52e308404b2e2d5dcb90a3de6266da1ca0c8b58b` and exact candidate bytes:
ROADMAP, MILESTONES, ledger, documentation index, historical roadmap log, and
dated roadmap PROPOSAL, REVIEW and VALIDATION.json.

## Acceptance limits and parent handoff

- Transport-complete means successful processing of supplied endpoints, not
  independently proven source-set completeness, uniqueness or a common server
  snapshot. File-count discrepancies remain explicit and nonblocking. The
  known PR12296 discrepancy and earlier 72-record audit remain unchanged.
- Digests are not authenticated provenance. They do not establish source
  host/repository, collector identity, freshness or upstream head currency.
  The policy marker invalidates older projections, not deliberate rewriting.
- Historical downstream readers still read retained bytes directly. After
  refused refresh they can consume stale malformed history or crash. Retention
  is intentional and is not successful fresh collection.
- Mocked transport and asserted CLI flags do not prove live pagination,
  rate-limit behavior, real hanging-process cancellation or server completeness.
  Atomic replacement failure is tested; power-loss directory durability is not.
  Hostile local filesystems, symlink races and resource exhaustion remain open.
- Field types do not prove semantic text, timestamp, path, status, account or
  research correctness. Bot filtering, truncation and absent patches remain.
  No reading-quality, recommendation, practitioner, public-participant,
  scientific, full-V1, accessibility, browser or independent-host acceptance
  follows from these synthetic controls.
- No full application suite, build, service, browser, live database, full
  72-record recapture, migration application, reset, process killing, branch
  deletion, main merge, paid infrastructure or hosted change runs. There is
  no own PR, push or merge. Parent reviews/cherry-picks and pushes the local
  checkpoint and requires fresh exact-head CI before integration.
