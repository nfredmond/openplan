# PR329 comment correction holds; file projection still accepts malformed counts

Reviewed October 15, 2026 UTC, October 14 Pacific. Request changes for one
additional P2 finding. The accepted comment-row P2 is corrected at this head.
The additional finding comes from the requested remaining type-hazard review;
it predates this comment-specific patch. No affected live research record is
asserted. Earlier roadmap scope and sequencing approval stays unchanged.

## Exact candidate and review ownership

- PR: https://github.com/nfredmond/openplan/pull/329.
- Candidate: `677369b27ef234182ce8a60598e35f7060416276`, fetched on
  `origin/work/t3-roadmap-integration-20261015`.
- Its tree is `ef3335a7e2ecc6d283bcb77bcfc88273c39798c3`, exactly equal to
  implementation child `324b159674a52c5d910512ea00de965f2976619f`.
- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-06a07a96`.
  Branch: `t3/review-pr329-correction-independent`.
- Initial clean HEAD: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
  Fetch and `git merge --ff-only origin/main` update only this assigned branch
  to `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`. No unrelated changes exist.
- Ownership covers this dated report only. All candidate source, tests,
  controller, readers, workflow and retained evidence come from exact Git
  objects. Execution uses disposable `/tmp/pr329-independent-tvk83d14/`
  copies or in-memory modules, never another checkout's working files.
- T3 delegation taskId:
  `node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-pr329-correction-independent-review-20261015-round2`.
  The live configuration confirms the corresponding `thread:` backing
  identity, parent `1401bb6a-70e4-42eb-a1f1-98045485f8cc`, GPT-6.1 Sol and
  high reasoning. Completion returns through the existing T3 delegation.

The review reads updated AGENTS.md, shared coordination and
`restart-continuation-20261015.json`, the binding contract, roadmap and
requirement mapping, the latest direction review, and relevant capability,
architecture and known-issue boundaries. The nested-package
`npm run product:direction:check` exits zero. Existing registry-expiry,
review-version and intervening-change reminders remain. Planner-writing and
prove-it apply. No other model or nested agent runs. This bounded review does
not repeat whole-product strategy approval.

## P2: malformed file additions publish as complete reusable evidence

Location at the candidate:
`docs/reviews/2026-10-15-t3code-concepts/scripts/fetch_pr_details.py`, lines
120 to 121 and 133 to 134. Cache validation at lines 88 to 103 validates
file-list containers and counts, but not the projected file fields.

The collector checks file names, then projects other file fields without
checking their types. A successful files response containing
`{"filename":"a.ts","status":"modified","additions":"one","deletions":0}`
therefore produces a signed, complete receipt. The actual unchanged
`scripts/digest.py` requires numeric additions to sort the files at line 21.
It exits 1 with:

```text
TypeError: bad operand type for unary -: 'str'
```

An independent `main()` probe starts with historical bytes at the selected
output path and supplies successful, otherwise valid endpoint responses.
With integer additions, collection and the actual digest reader succeed.
Changing only additions to the string `"one"` yields:

```json
{"historyReplaced":true,"successOutput":"3699 1 0 0","complete":true,"cacheReusable":true,"readerExit":1}
```

This does not depend on forged or manually recomputed receipt digests. The
collector creates the malformed receipt itself, replaces the previous file,
prints success, and later reuses it. The independent refusal assertion fails:

```text
AssertionError: Malformed numeric file field must not form a reusable receipt
```

The current `full_text.py` succeeds on this shape because it formats file
values as text. That consumer's successful test cannot protect the numeric
operation in `digest.py`. All 19 methods and all 42 intended collector faults
also pass with the current source; their file-row cases cover file names,
not malformed additions. This is a remaining projection/consumer boundary,
not a failure of the new comment validator.

Require the file projection fields needed by the retained readers, including
numeric additions, before signing and publication. Apply the corresponding
projected-file validation during cache reuse. Preserve valid zero counts and
refuse missing or malformed values rather than coercing them. Keep failed
refresh bytes and paths intact. Test the actual digest consumer as well as
full_text. A complete upstream schema validator is not required to protect
these consumed fields.

This minimal reproduction uses only exact candidate objects and temporary
synthetic files. It prints `True True 1` and the TypeError above:

```python
import json, pathlib, subprocess, sys, tempfile, types
from unittest.mock import patch

head = '677369b27ef234182ce8a60598e35f7060416276'
base = 'docs/reviews/2026-10-15-t3code-concepts/scripts/'
def source(name):
    return subprocess.check_output(
        ['git', 'show', head + ':' + base + name], text=True)
m = types.ModuleType('collector')
exec(compile(source('fetch_pr_details.py'), base + 'fetch_pr_details.py',
             'exec'), m.__dict__)
values = [
    {'number': 3699, 'title': 'synthetic', 'state': 'closed', 'changed_files': 1},
    [[{'filename': 'a.ts', 'status': 'modified',
       'additions': 'one', 'deletions': 0}]],
    [[]], [[]], [[]],
]
responses = [subprocess.CompletedProcess([], 0, json.dumps(v), '') for v in values]
with patch.object(m.subprocess, 'run', side_effect=responses):
    record = m.collect(3699)
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    (root / 'pr-details').mkdir()
    m.publish(root / 'pr-details/3699.json', record)
    (root / 'pull-requests.jsonl').write_text(
        json.dumps({'number': 3699, 'body': 'synthetic'}) + '\n')
    reader = root / 'digest.py'
    reader.write_text(source('digest.py'))
    result = subprocess.run(
        [sys.executable, '-I', '-B', str(reader), str(root), '3699'],
        capture_output=True, text=True, timeout=10)
    print(record['collection']['complete'], m.valid_cache(record, 3699),
          result.returncode)
    print(result.stderr.splitlines()[-1])
```

## The accepted comment-row correction withstands independent checks

Raw rows now require explicit body, user and endpoint-specific metadata.
Non-null raw authors need string logins. Projected cached authors must be
strings or null. Deleted-author nulls and explicit empty bodies remain valid.
The retained official-schema extract distinguishes optional issue-comment
body from this collector's documented stricter text-evidence policy. This
review inspects the pinned extract; it does not independently download the
upstream OpenAPI document or authenticate the extract's origin.

The new `collection.commentRowPolicy` marker invalidates old v2 receipts.
Projected comment validation also refuses malformed rows with recomputed
matching digests. Failed refreshes keep historical paths and bytes and print
no fresh-success line. A later valid refresh recovers. These are shape and
reuse controls, not timestamp parsing, account authentication, freshness or
complete upstream-schema validation.

The exact controller runs serially on Python 3.11.15 and Python 3.14.4.
Each interpreter executes four complete 19-method cohorts and 42 targeted
source faults. All intended outcomes match. The harmless comment survives.
The controller restores exact source bytes; independent comparisons against
candidate Git objects confirm the collector, tests, controller and reader
remain unchanged in temporary copies. No candidate checkout changes.

Observed examples on both interpreters include:

- `allow-nested-login` fails
  `test_nested_comment_authors_are_refused_before_signing` with
  `CollectionError not raised : nested author must be refused before signing`.
- `skip-projected-row-validation` fails
  `test_projected_cache_rows_are_validated_even_with_new_digest` with
  `malformed projected cache row must be rejected despite matching digest`.
- `unlink-before-malformed-refresh` fails
  `test_bad_v2_failed_refresh_preserves_bytes_without_success` with
  `malformed refresh must preserve historical path`.
- `numeric-projection-breaks-actual-reader` fails
  `test_actual_full_text_reads_valid_deleted_and_empty_rows` with
  `actual full_text.py must read valid/deleted/empty rows` and the actual
  reader's nested-author TypeError.

The successful actual-full_text cohort checks retained human/deleted-author
text, empty bodies, last file, manifest, null identity and existing truncation
limits. It tests synthetic compatibility, not semantic reading quality.

Additional independent in-memory probes check 72 malformed raw shapes across
all three comment endpoints, 45 missing or malformed projected-cache shapes
with newly computed digests, nine valid empty/deleted shapes, six failed
refreshes and six recoveries. Five additional API probes supply valid JSON
with nonzero CLI exits at each endpoint; all refuse as API unavailable.
A harmless source comment survives the independent refusal oracle; disabling
the nested-login type condition triggers its exact malformed-source assertion.
These probes also confirm the inherited file-cache shape gap: removing a file
name and recomputing the digest still passes cache validation.

Independent AST comparisons confirm all 12 original methods remain; 11 are
unchanged. The original malformed-row fixture gains surrounding valid fields.
All 22 original fault tuples remain, plus the original special author fault.
The unchanged dedicated workflow invokes the candidate controller on Python
3.11 and 3.14 with read-only permissions and a five-minute job limit. The
controller requires `Ran 19 tests` for full cohorts. No current GitHub CI
result is inferred from this source inspection.

The actual classifier probe accepts/refuses its 14 transcripts on both
interpreters. Independent reruns also reproduce the harmless classifier
survivor and all nine targeted parser faults per interpreter. Each fault
fails `Controller misclassified synthetic runner transcript` for its named
case. These include source-echo diagnostics, wrong methods, extra errors,
syntax failures, missing footers, incorrect exit codes and old 12-method
cohorts. Temporary controller bytes are restored exactly. Synthetic runner
transcripts alone do not prove test execution; the actual controller runs
provide that separate evidence.

The seven retained transcript archives contain 281 members. Archive hashes,
member sets, byte lengths and SHA-256 values match the committed manifest.
This checks retained-byte consistency, not independent provenance of earlier
runs. Campaigns 06 and 07 bind the current source hashes; earlier failed and
superseded attempts remain in the candidate.

## Provenance and unchanged approval

Current candidate source SHA-256 values are:

```text
fetch_pr_details.py
0e58585d5259eb2a3a79ddf3ee844efb4cc47f51b9dd7e1ff9bdb7c52a4f3a77
test_fetch_pr_details.py
1bdf4936077f95f52d3620b709a633b47b93924a9c49f0d86a332d00fe360409
verify_collector_controls.py
703b61b33fe4f4f784bf3f2a3257e01f0ec8626723eb77c68e68678f42179350
full_text.py
1e859aa5c66833d4e6744c3fb22a80579aa2c20d49324c15863adb5216b17fb6
```

The original independent report matches its source at review commit
`65db205ae0bd69e5b61966757402532b1da19ddc` byte-for-byte. Its residual
categories and disagreements remain in the candidate. The response does not
silently replace that report with an approval.

All eight approved artifacts are byte-identical between approval
`52e308404b2e2d5dcb90a3de6266da1ca0c8b58b` and this exact candidate:
ROADMAP, MILESTONES, CORE_REQUIREMENTS_LEDGER, documentation index, historical
roadmap evidence log, and the dated roadmap PROPOSAL, REVIEW and VALIDATION.
This review requests no roadmap or claim-tier change.

## Residual blind categories and disposition

- `complete` establishes successful endpoint processing, not source-set
  completeness, uniqueness or a common server snapshot. Declared file-count
  discrepancies remain visible and do not block receipts. The known PR12296
  discrepancy and 72-record audit are inherited evidence. No live corpus is
  recaptured or independently authenticated here.
- Receipt digests do not authenticate deliberate rewriting, host/repository
  provenance or collector implementation. Cached records do not establish
  freshness or upstream head/comment currency. Numeric file fields now have
  the additional concrete P2 above, separate from those provenance limits.
- CLI pagination and 60-second per-call budgets are asserted, and synthetic
  TimeoutExpired handling holds. Real hanging transport/process limits are
  untested. Five sequential calls can approach five minutes per PR.
- Atomic publication flushes and fsyncs a sibling temporary file before
  replacement. The injected replacement failure preserves historical bytes
  and removes the temporary file. Directory-entry power-loss durability is
  untested.
- Downstream readers do not enforce receipt validity. After failed refreshes
  they can consume retained stale or malformed historical files. Retention
  remains intentional and is not a successful fresh capture.
- Selection is restricted to unique positive decimal numbers; fetched file
  names and review paths remain JSON values. Hostile local filesystems,
  symlink races, resource exhaustion and arbitrary semantic string contents
  remain outside these controls. Full upstream PR/file schemas are not
  validated. Comments remain truncated, bot filtering remains, and patches
  are absent.
- Inherited fault cases for API, identity and timeout classification can fail
  because a later guard gives a different diagnostic. Their assertion failures
  alone do not prove harmful publication. Independent nonzero-exit probes
  provide a separate refusal check; the file P2 includes actual publication.
- No research recommendation quality, scientific accuracy, practitioner,
  public-participant, browser, accessibility, deployed, database, recovery,
  independent-host or V1 acceptance follows from green synthetic controls.

The original comment correction merits bounded source acceptance. Overall
PR329 approval is withheld pending the additional file-projection P2. Parent
retains correction, fresh-head CI and integration decisions. Only this dated
report is committed. No GitHub mutation, watcher, push, main merge, hosted
change, migration application, reset, service, build, application suite,
process termination, branch deletion or paid infrastructure occurs. T3 links
the existing PR internally; that does not mutate GitHub.
