# PR329 malformed comment receipt correction

October 15, 2026 UTC, October 14 Pacific. This corrects the parent's accepted
P2 finding against `7193478d81ce39887f552be2e5530ebdcdd3354c`. It changes
collection and cache acceptance. It does not change the approved roadmap.

## Checkout, ownership and original review

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-cb7792cb`,
branch `t3/pr329-collector-malformed-receipt-fix`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. Fetch and fast-forward first reach
current `origin/main`, `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`, then exact
`origin/work/t3-roadmap-integration-20261015`, `7193478d81ce39887f552be2e5530ebdcdd3354c`.
There is no candidate drift at that fetch. No unrelated changes are present.
The original implementation and independent-review checkouts remain untouched.

Ownership covers `fetch_pr_details.py`, its focused unittest/controller, and
this dated evidence directory. The full [independent report](INDEPENDENT_REVIEW.md)
is retained byte-for-byte, including its residual blind categories. Its SHA-256
is `e15dc8bcad96adf4590bc55a9b6838656d48e062d47123b969bf3eb9b9e0b649`.
The [provenance receipt](provenance.json) checks the original report, unchanged
reader, and all eight approved artifacts against candidate and approval objects.

AGENTS.md, current shared coordination, `restart-continuation-20261015.json`,
the binding contract, roadmap, core ledger and direction review inform this
bounded assignment. The nested `npm run product:direction:check` passes with
the existing registry expiry, review-version and intervening-change reminders.
Planner-writing and prove-it apply. Only GPT-6.1 Sol at high reasoning runs;
there is no child delegation.

T3 taskId:
`node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-pr329-malformed-comment-fix-20261015-round1`.
The child thread configuration identifies the matching `thread:` identity.
Completion returns through that existing delegation. T3 internally links
PR329; there is no GitHub review, comment, push, merge or other GitHub mutation.
Parent owns integration into the existing PR, CI, and disposition.

## Required fields and permitted nulls

The [schema extract](github-row-schema-extract.json) retains relevant definitions
from GitHub's [official OpenAPI source at commit 507b88ec](https://github.com/github/rest-api-description/blob/507b88ecbdccb4789ce77228fa2f2fde4bdeaf1f/descriptions/api.github.com/api.github.com.json),
with the complete downloaded source's hash. This is a documentation read, not
a research corpus capture. The collector validates its reader projection,
not every field in those upstream schemas.

- Each endpoint requires an explicit `user` field. GitHub's schemas reference
  `nullable-simple-user`, so `user: null` remains valid. A non-null raw author
  must be an object with a string `login`. Missing, null, numeric, boolean,
  list and object logins refuse before truncation or signing. Projected caches
  require `user` to be null or a string.
- Each endpoint requires an explicit string `body`. Empty strings remain
  valid, including an approval review without prose. Null bodies refuse.
  GitHub requires `body` for review comments and reviews. Its issue-comment
  schema defines a string body but does not list it as required. Requiring
  that plain-text field is this collector's stricter evidence policy: an
  absent text field is insufficient for this reader and cannot become `""`.
- Issue comments require string `created_at`, review comments require string
  `path`, and reviews require string `state`. GitHub requires those respective
  fields and does not mark them nullable. Missing and null values refuse.

The same projected shape check applies during reuse, even if a malformed
record carries a newly computed matching digest. Cache reuse also requires
`collection.commentRowPolicy: "required-projected-fields-v1"`. Earlier v2
receipts lack that marker and refresh. This deliberately invalidates even
otherwise intact old receipts: projection had erased the distinction between
missing source text and valid empty text. A failed refresh retains old bytes
and prints no fresh-success line. A later valid refresh replaces the old
record atomically. No historical capture is rewritten during this correction.

These are shape checks. They do not parse timestamp semantics, enumerate review
states, impose new string lengths, authenticate accounts, or validate the full
GitHub schema. Existing truncation limits and deleted-author nulls remain.

## Current source controls and reading consumer

Current acceptance uses [campaign 06, Python 3.11.15](campaign-06-python311/controls.json)
and [campaign 07, Python 3.14.4](campaign-07-python314/controls.json), run serially.
Each executes four full 19-method cohorts and 42 targeted faults. All expected
outcomes match, including the harmless comment survivor. `finally` restores
exact source bytes. Both receipts bind current collector, tests, controller
and unchanged `full_text.py` hashes.

All 12 original methods remain. Eleven method ASTs are unchanged. The original
malformed-row method gains valid surrounding fields so each original fault
still isolates its stated defect. All original 22 fault tuples and the special
author fault remain unchanged, totaling the original 23. Seven new methods
cover missing fields and malformed nested authors across all three endpoints,
typed fields, projected caches with recomputed digests, prior v2 receipts,
failed-refresh preservation and recovery, and the actual reading consumer.

Representative new failures reach these exact named assertions:

- `allow-nested-login` fails
  `test_nested_comment_authors_are_refused_before_signing` with
  `nested author must be refused before signing`, across all three endpoints.
- `validate-after-signing` fails that method with
  `Expected 'digest' to not have been called`. Rejection after signing does
  not satisfy this boundary.
- `skip-projected-row-validation` fails
  `test_projected_cache_rows_are_validated_even_with_new_digest` with
  `malformed projected cache row must be rejected despite matching digest`.
- `reuse-old-comment-policy` fails `test_prior_v2_policy_is_not_reused` with
  `prior v2 receipt must refresh under the explicit comment policy`.
- `erase-before-malformed-refresh`, `unlink-before-malformed-refresh`, and
  `claim-success-before-refresh` fail
  `test_bad_v2_failed_refresh_preserves_bytes_without_success` at the
  historical-byte, historical-path and fresh-success assertions respectively.
- `numeric-projection-breaks-actual-reader` fails
  `test_actual_full_text_reads_valid_deleted_and_empty_rows` with
  `actual full_text.py must read valid/deleted/empty rows`, and the actual
  reader's `TypeError: expected string or bytes-like object, got 'int'`.

Inherited `ignore-api-failure`, `ignore-pr-identity` and
`ignore-timeout-classification` faults still test the expected error class or
diagnostic when another guard may also refuse. Their assertion failures alone
do not establish harmful publication. The copied independent report retains
that distinction and its additional direct transport probes.

The positive consumer test writes synthetic collected JSON and invokes the
actual unchanged `full_text.py` with the same interpreter. It checks the real
batch and manifest files, retained human/deleted-author text, last file, null
deleted identity, empty bodies, and original truncation limits. Mutants also
detect rejecting empty reviews, inventing empty text, inventing deleted authors,
and removing truncation. This does not establish semantic reading quality.

The controller requires the named failed method and its assertion diagnostic,
excluding source-code echoes, syntax errors and unrelated errors/failures.
The [classifier probe](verify_controller_classifier.py) reads the actual nested
controller function and tests 14 synthetic runner transcripts on each interpreter.
The [classifier source controls](classifier-source-controls.json) additionally
run a harmless controller mutation and nine targeted parser mutations per
interpreter in temporary copies. Each targeted mutation fails the probe's
explicit `Controller misclassified synthetic runner transcript` assertion.
The working controller remains unchanged. Synthetic transcript checks do not
replace actual unittest execution, which the source campaigns supply.

## Retained attempts and acceptance limits

Campaign 01 stops on a controller indentation error before any test runs.
Campaigns 02 and 03 pass the earlier 37-fault draft on both interpreters.
Campaign 04 passes after fixture and empty-review mutant refinements; campaign
05 passes all 42 faults before classifier tightening. These earlier logs and
receipts remain historical, not substitutes for campaigns 06 and 07. The first
provenance attempt names nonexistent `VALIDATION.md` and refuses; the corrected
check uses the actual approved `VALIDATION.json`. No failed attempt counts as
acceptance. The original collector campaigns and research artifacts stay intact.

Raw unittest output includes trailing spaces, which the full staged whitespace
check reports. The transcripts are packaged in lossless `transcripts.tar.gz`
files beside each campaign receipt, with classifier transcripts in
`classifier-logs.tar.gz`. Every archive member is read back and compared with
its original bytes before packaging replaces the loose copy. The
[archive manifest](transcript-archives.json) records member sizes/hashes and
archive hashes. No transcript text is normalized. Source/docs and final full
checkpoint whitespace checks pass after packaging.

The independent report's residual boundaries remain:

- `complete` means successful endpoint processing. It does not establish
  source-set completeness, uniqueness, or a common server snapshot. Declared
  file-count mismatches remain explicit and do not block receipts.
- Hashes detect changes without a corresponding digest update. They do not
  authenticate provenance against deliberate rewriting. Receipts still lack
  source-host/repository and collector-implementation hashes. Cache reuse
  does not check freshness or upstream changes.
- PR12296's known file-count discrepancy and the prior 72-record audit stay
  unchanged. This assignment makes no live recapture or network corpus call
  and does not authenticate that audit's private inputs.
- The 60-second deadline and error handling remain synthetic controls.
  Actual hanging transport and power-loss directory-entry durability are not
  exercised. Five sequential calls may consume nearly five minutes per PR.
- Downstream reading commands still read retained JSON directly without
  validating receipts. They can consume or crash on historical malformed
  records after a refused refresh. Retained bytes are not fresh success.
- Selection traversal controls do not cover a hostile local filesystem or
  symlink races. Comments remain truncated, bot filtering remains, and patches
  are absent. No semantic recommendation-quality claim follows.
- No current GitHub CI, full live corpus recapture, Vitest, full suite, build,
  service, browser, database, migration application, hosted operation,
  accessibility, practitioner, scientific, deployment or independent-host
  acceptance is asserted. Parent retains those boundaries and integration.

The local checkpoint contains no app, schema, roadmap or release changes.
