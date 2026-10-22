# PR329 collector needs one row-validation correction

Reviewed October 15, 2026 UTC, October 14 Pacific. This is an independent,
bounded collector review. Request changes for one P2 defect. The earlier
roadmap scope and sequencing approval is outside this review and remains
unchanged.

## Candidate and ownership

- PR: https://github.com/nfredmond/openplan/pull/329.
- Exact candidate: `7193478d81ce39887f552be2e5530ebdcdd3354c`.
- Base and assigned checkout after fast-forward:
  `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`.
- Assigned branch: `t3/review-pr329-pr-details-collector`.
- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-c91de3f6`.
- Checkout starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`.
  Fetch and `git merge --ff-only origin/main` update only this clean branch.
  PR head checks before and after inspection show no head drift.
- Ownership covers this report only. Candidate files come from
  `git show <exact-head>:<path>`, not the implementation owner's working tree.
  Synthetic execution uses disposable temporary copies or in-memory modules.
- T3 task identity:
  `node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-pr329-independent-collector-review-20261015-round1`.
  The child thread has the corresponding `thread:` prefix. A child-scoped
  `task_status` attempt returns `task_not_found` because the task belongs to
  the parent thread. Completion returns through the existing T3 delegation.

The review reads current AGENTS.md, the shared coordination record and
`restart-continuation-20261015.json`, the contract, roadmap, requirement
ledger, direction review and supporting capability/architecture boundaries.
The nested-package `npm run product:direction:check` passes. Its existing
registry expiry, review-version and intervening-change reminders remain.
The review applies planner-writing and prove-it. No other model or subagent
runs.

## P2: malformed comment rows become complete reusable evidence

Location at the exact candidate:
`docs/reviews/2026-10-15-t3code-concepts/scripts/fetch_pr_details.py`,
lines 96 to 101 and 112 to 120. Cache validation at lines 68 to 77 also accepts
the resulting rows.

The author check accepts any dictionary without checking `user.login`.
For example, a successful issue-comments response containing
`{"user":{"login":7},"body":"retained comment"}` produces a projected
record with `user: 7`. Collection marks it complete, signs its digest, and
`valid_cache(record, 3699)` returns true. The exact candidate's actual
`scripts/full_text.py` then exits 1 at line 25:

```text
TypeError: expected string or bytes-like object, got 'int'
```

The same validation also accepts an empty object at any of the three comment
or review endpoints. The resulting rows are:

```json
{"user": null, "body": "", "created_at": null}
{"user": null, "body": "", "path": null}
{"user": null, "body": "", "state": null}
```

Each receipt has `complete: true` and passes cache validation. Calling the
actual `main()` with a malformed review response replaces a pre-existing
historical file with this complete receipt. The issue-comment/review reader
filters blank bodies out, so missing source data becomes absent discussion.
This contradicts the stated malformed-row refusal boundary. No live source
corruption or affected original research record is asserted.

Require the fields needed for each projected row, distinguish missing fields
from permitted null values, and validate a non-null author's login as a
string. Preserve legitimate deleted authors and empty review bodies.
Apply corresponding validation during cache reuse, or invalidate prior
receipts, so an already accepted malformed v2 record cannot bypass the fix.
Add cases for missing fields and malformed nested author fields at all three
endpoints, including failed-refresh preservation and the reading consumer.
The present tests cover a string in place of the whole author object, but
they do not cover its nested login or missing row fields.

The following read-only reproduction compiles the exact candidate object.
The independent refusal oracle fails with the explicit assertion shown.

```python
import json, subprocess, types
from unittest.mock import patch

head = '7193478d81ce39887f552be2e5530ebdcdd3354c'
path = 'docs/reviews/2026-10-15-t3code-concepts/scripts/fetch_pr_details.py'
source = subprocess.check_output(['git', 'show', f'{head}:{path}'], text=True)
collector = types.ModuleType('collector')
exec(compile(source, path, 'exec'), collector.__dict__)
payloads = [
    {'number': 3699, 'title': 'synthetic', 'state': 'closed', 'changed_files': 0},
    [[]], [[{}]], [[]], [[]],
]
responses = [subprocess.CompletedProcess([], 0, json.dumps(p), '')
             for p in payloads]
with patch.object(collector.subprocess, 'run', side_effect=responses):
    try:
        collector.collect(3699)
    except collector.CollectionError:
        pass
    else:
        raise AssertionError('Malformed comment row must be refused before receipt/publication')
```

## Checks that hold at this candidate

The exact source controller runs successfully in temporary copies with
Python 3.11.15 and Python 3.14.4. Each interpreter executes four full
12-method positive cohorts and 23 named targeted faults. The harmless
comment survives. All targeted faults reach a named unittest failure with
the controller's required diagnostic. Final source bytes match the original.
The earlier progress message's Python 3.11.13 patch version was a reporting
error; the inspected interpreter reports 3.11.15.

Representative observed failures establish the relevant boundaries:

- `discard-pages` fails `test_all_pages_are_flattened_in_order` at
  `all 190 files must survive pagination`.
- `omit-slurp` fails that method at
  `CLI must slurp every list endpoint`.
- `ignore-cache-receipt` fails
  `test_only_intact_complete_current_cache_is_reused` at
  `altered cache must be rejected`.
- `erase-before-publish` fails
  `test_failed_atomic_publication_preserves_previous_record` at
  `failed publication must preserve the previous cache path`.
- `omit-api-deadline` fails the pagination method at
  `API calls need a bounded deadline`.

Some faults test error classification rather than publication loss.
`ignore-api-failure`, `ignore-pr-identity` and
`ignore-timeout-classification` reach `assertRaisesRegex` failures when a
later guard reports a different CollectionError. They are actual assertion
failures, not syntax/import failures, but do not alone demonstrate harmful
publication. An additional independent probe supplies otherwise valid JSON
with a nonzero CLI exit at each of the five endpoints. Each refuses with
`API unavailable`, including list endpoints.

The transport distinguishes `[[]]` from missing slurped pages. It flattens
every supplied valid page, requires successful CLI exit, uses an explicit
60-second timeout, and does not publish after a collection refusal.
Publication writes, flushes and fsyncs a sibling temporary file before
replacement. The injected replacement failure preserves the previous path
and bytes and removes the temporary file. These checks do not establish
power-loss durability of the directory entry.

Additional direct probes reject `../3699`, `/tmp/3699`,
`3699/../../target`, zero, negative numbers and duplicate selections before
calling collection. Fetched filenames remain JSON values; they do not form
output paths. This checks selection-based traversal, not a hostile local
filesystem or symlink race.

Source SHA-256:
`1975c3e462d45bbf06d456473939914caa2985d0f738ae307a5d17007df169f7`.
Test SHA-256:
`3ab6f9763d67e83b53afe806f29ebcf606ac3bbea5d67cecfad327997cdc9077`.
The controller restores exact source after each interpreter run. No
candidate source or test changes persist in any checkout.

## Residual blind categories and acceptance limits

- Pagination tests establish processing of pages returned by a successful
  CLI invocation. They cannot prove the server supplied every page. A probe
  returning no files for a PR declaring two files produces a reusable
  `complete: true` receipt with `fileCountMatchesDeclared: false`.
  A two-row duplicate filename list can match the declared count. Thus
  `complete` means successful endpoint processing, not independently proven
  source-set completeness or uniqueness. Do not promote it to that claim.
- The known PR12296 discrepancy remains explicit and unchanged. The committed
  recapture audit has 72 unique rows, no listed projected differences, and
  PR12296 as its sole file-count discrepancy. This review checks the committed
  receipt's consistency. It does not independently rerun the live recapture
  or authenticate its private original and fresh inputs.
- Cache hashes detect byte changes without an updated digest. They do not
  authenticate provenance against deliberate rewriting. Source host/repository
  and collector implementation hashes are not fields in each v2 receipt.
  Cache reuse does not check upstream head/comment changes or freshness.
  The PR object and four lists also lack a common server snapshot. Treat
  cached results as dated research, not current-source verification.
- Each call's 60-second deadline is asserted, and TimeoutExpired is tested.
  Actual hanging network/process behavior is not exercised. Five sequential
  endpoint calls may consume nearly five minutes per PR.
- The dedicated workflow invokes this exact synthetic controller for Python
  3.11 and 3.14 on pull requests and main pushes, with read-only repository
  permissions and a five-minute job limit. It has no API token requirement
  and makes no research network calls. This is source inspection and a local
  controller rerun, not a claim that current GitHub CI passed. Parent owns CI
  and integration disposition.
- Downstream `digest.py` and `full_text.py` read JSON directly and do not
  enforce receipt validation. Fail-closed collection does not prevent a
  separate manual reading command from consuming retained legacy evidence
  after a failed refresh. Retaining historical bytes is intentional; do not
  represent those bytes as a successful fresh capture.
- Comments remain truncated, bot text is filtered from reading material, and
  patches are not collected. No semantic reading, recommendation quality,
  application journey, browser, accessibility, practitioner, scientific,
  deployment, database or independent-host acceptance follows from this review.

Eight approved roadmap artifacts are byte-identical between the approval
commit `52e308404b2e2d5dcb90a3de6266da1ca0c8b58b` and this candidate:
ROADMAP, MILESTONES, CORE_REQUIREMENTS_LEDGER, documentation index, historical
roadmap evidence log, and the dated roadmap PROPOSAL, REVIEW and VALIDATION.
The collector correction does not change those approved records.

Only this report is added. No source edit, GitHub comment/review/push, merge,
hosted action, migration, database change, service, build, process termination,
full suite, corpus collection or model research occurs. T3 registration links
the existing PR internally; it does not mutate GitHub. Parent retains the
implementation checkout, the P2 correction and all integration authority.
