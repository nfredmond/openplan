# PR329 reader projection correction withstands independent review

Reviewed October 15, 2026 UTC, October 14 Pacific. No new P1/P2 defect is
identified within the assigned collector and reader-projection scope at exact
local correction `76069d81fd9fe2c1f378fd80b3c5401d5b513215`. The accepted
numeric-file P2 is corrected, and the earlier comment correction still holds.
Recommend bounded source acceptance of this correction. Parent retains
integration, fresh integrated-head CI and overall PR disposition. This report
does not grant merge or production acceptance.

## Exact object, checkout and ownership

- PR: https://github.com/nfredmond/openplan/pull/329.
- Reviewed local commit: `76069d81fd9fe2c1f378fd80b3c5401d5b513215`.
  Tree: `0a7840e26b9193e23d31df04ec3e163a27bf6f1e`.
  Parent: `677369b27ef234182ce8a60598e35f7060416276`.
- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-ad8ae1bc`.
  Branch: `t3/pr329-reader-projection-independent-review`.
  Initial clean HEAD: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
  Fetch and `git merge --ff-only origin/main` advance only this clean assigned
  branch to `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`. No unrelated changes
  exist. No candidate source is merged into this review branch.
- Ownership covers this report only. Candidate files come from shared Git
  objects through this assigned checkout. Execution uses disposable
  `/tmp/pr329-round3-dsld_3om/` copies or in-memory modules. No original
  implementation, prior-review, main or browser-acceptance tree is edited.
- T3 taskId:
  `node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-pr329-reader-projection-review-20261015-round3`.
  Live T3 thread state confirms the matching `thread:` backing identity,
  assigned branch/worktree, parent `1401bb6a-70e4-42eb-a1f1-98045485f8cc` and
  GPT-6.1 Sol. This run uses high reasoning and no nested agent or other model.
  Completion returns through the existing delegated task.

The review reads updated AGENTS.md, shared coordination and
`restart-continuation-20261015.json`, the binding contract, roadmap, ledger,
latest product-direction review and relevant capability/architecture/known-issue
boundaries. It also reads the candidate roadmap amendment's approval record.
Planner-writing and prove-it apply. The nested-package
`npm run product:direction:check` exits zero with the existing registry-expiry,
review-version and intervening-change reminders. No review date is advanced.
The shared PR327 production hold remains outside this review's authority.

## Prior findings and their dispositions remain visible

The original reports and separate responses remain unchanged in the candidate.
Byte comparisons establish:

- The [first independent report](../2026-10-15-pr329-malformed-receipts/INDEPENDENT_REVIEW.md)
  matches `65db205ae0bd69e5b61966757402532b1da19ddc` at its original path,
  `docs/reviews/2026-10-15-pr329-collector-independent/REVIEW.md`.
  SHA-256: `e15dc8bcad96adf4590bc55a9b6838656d48e062d47123b969bf3eb9b9e0b649`.
- Its [response](../2026-10-15-pr329-malformed-receipts/RESPONSE.md) matches
  exact parent `677369b27`.
  SHA-256: `8eba961a6887ab857b3ee20f700451b0aece4f1d4f544b42d4e4759e30cc1467`.
- The [second independent report](../2026-10-15-pr329-reader-projection/INDEPENDENT_REVIEW.md)
  matches `d4c71fc361a42f452c2c788c52122ed52cd2eb7a` at its original path,
  `docs/reviews/2026-10-15-pr329-correction-independent/REVIEW.md`.
  SHA-256: `4b969e0788d1171b913e0010fc43af1cb25dc81881fe33c3511495f593bbaf68`.

The initial API-as-empty and missing-pagination P2 findings were corrected in
`7193478d81ce39887f552be2e5530ebdcdd3354c`; transport controls still hold here.
The first independent report found malformed nested authors and missing comment
fields producing complete reusable records and an actual full_text crash.
Correction `324b159674a52c5d910512ea00de965f2976619f`, integrated as `677369b27`,
closes that boundary. The second report confirms that correction but exposes
malformed file additions, cache filename validation and an actual digest crash.
The [new response](../2026-10-15-pr329-reader-projection/RESPONSE.md) addresses
that accepted additional P2 and systematically checks both readers' projections.
This review accepts that bounded correction. Earlier residual categories and
research disagreements remain; none becomes an approval by being copied.

## Required fields protect the actual numeric and text operations

The unchanged `digest.py` sorts files using unary minus on additions and indexes
filename/additions. `full_text.py` indexes filename/additions/deletions. Both
display PR changed_files; digest also displays PR additions/deletions and merge
SHA. Both apply regular expressions to projected comment authors and text.
Corpus title, state, body, author and timestamps come from separate
`pull-requests.jsonl` records. This collector does not validate that input.

At the candidate, `validate_file` at lines 78 to 86 requires a nonempty string
filename, explicit string status and explicit integer additions/deletions.
`validate_pr_projection` at lines 89 to 101 requires string title, supported
state, integer additions/deletions/changed_files, nonnegative changed_files,
and explicit string-or-null merge_commit_sha. Missing merge SHA cannot become
apparently valid null before validation. Raw identity still requires the
selected exact positive integer PR number. Cache identity checks the top-level
projected number, where that identity is retained.

The shared raw/cache validators refuse booleans despite Python's bool/int
relationship. Missing values, null numeric values, strings including `"0"`,
lists, objects, integral floats, fractional floats and nonfinite floats refuse.
Zero remains valid. There is no coercion. Both raw and cache changed_files
refuse negative values. Existing comment checks require explicit string body
and endpoint metadata, explicit user, and string login on a non-null raw user.
Projected users require string or null. Deleted users and empty bodies remain
valid; explicit source omissions cannot silently become empty text or authors.

Negative file and PR additions/deletions remain accepted integers. Independent
probes confirm both actual readers display `-1` unchanged and digest arithmetic
does not crash. The retained pinned GitHub schema extract has integer types
without minimums for those fields. The correction explicitly promises types,
not numeric plausibility. This is a visible semantic-validation limit, not a
new P2 in the requested consumer-correctness boundary. No nonnegative-count or
complete upstream-schema claim is accepted. This review inspects the retained
extract; it does not independently download or authenticate its upstream source.

Status requires a string but does not enforce the upstream enum. Neither reader
uses status. PR commits, timestamps, merged_at, user/base/head and other unused
metadata retain their prior projection without systematic schema checks.
Timestamp/path/account semantics and SHA format are also unproved. These are
blind categories, not grounds to add unused-field features to this correction.

## Recomputed digests cannot bypass the projection policy

`valid_cache` checks containers, exact endpoint counts, number/schema/completion,
both policy markers, the shared PR/file validators and projected comment shapes
before accepting the digest. It refuses malformed projections even after a
matching digest is recomputed. This remains unsigned local integrity checking.

`collection.consumedProjectionPolicy: "required-reader-fields-v1"` invalidates
older v2 records, including valid-looking null merge SHA whose source presence
was erased. The earlier comment policy remains required. Invalid caches trigger
collection before publication. Refusal preserves the old path and exact bytes,
leaves no temporary file and prints no fresh-success line. A valid retry collects
all five endpoints, atomically replaces the file and reports success.

Independent probes on each interpreter check 97 malformed raw shapes before
signing, 97 malformed projected-cache shapes with recomputed digests, six old
policy cases, six failed-refresh cases and six recoveries. Additional main()
probes remove each policy marker from an otherwise valid receipt. Each missing
marker causes five endpoint calls. Malformed refresh retains history without
success; valid refresh replaces it. The source mutation controls include a
harmless comment survivor and these exact targeted failures:

- Removing the file-additions condition fails
  `Malformed numeric file field must be refused before receipt/publication`.
- Skipping cached-file validation fails
  `Malformed numeric cache field must refuse despite matching digest`.

These probes run in memory or temporary copies. Final collector/controller,
tests and both readers match the exact candidate object bytes.

## Both actual readers reproduce the old defect and the corrected boundary

With otherwise valid synthetic data at `677369b27`, `additions: "one"` still
forms a complete reusable receipt. Actual digest exits 1 with:

```text
TypeError: bad operand type for unary -: 'str'
```

Actual full_text exits zero because it formats that malformed value. The same
source field at `76069d81f` refuses with `API malformed file additions: 3699`
before a receipt forms. The independent refresh cases confirm historical-byte
preservation at that corrected boundary. Valid zero and ordinary counts run
through both unchanged programs with the original file counts retained.
Deleted authors, empty bodies and the original truncation limits still work.

Both readers intentionally remain direct historical-file readers. A separate
synthetic bypass writes malformed historical JSON after collection refusal:
string additions crash digest but full_text succeeds; missing filename raises
KeyError in both; missing deletions raises KeyError in full_text while digest
succeeds. Those results agree on both interpreters. Retaining old bytes after
refusal does not establish fresh reader compatibility or block a manual command
from consuming stale history.

## Actual controller execution and retained evidence

The exact source controller runs serially under Python 3.11.15 and Python
3.14.4. Each run executes four full 25-method cohorts and 63 targeted source
faults, 67 controls total. All intended outcomes match. The harmless comment
survives, and `finally` restores exact source bytes. Representative observed
failures include:

- `allow-file-additions`, `allow-file-deletions`, `allow-pr-additions`,
  `allow-pr-deletions` and `allow-pr-merge-sha` fail
  `test_consumed_source_fields_are_refused_before_signing` with
  `malformed consumed source field must refuse before signing`.
- `consumed-validate-after-signing` fails that method at
  `Expected 'digest' to not have been called`.
- `skip-file-cache-validation`, `skip-pr-cache-validation`,
  `allow-boolean-cache-pr-changed-files` and `allow-negative-cache-file-census`
  fail `test_consumed_cache_fields_refuse_even_with_recomputed_digest` with
  `malformed consumed cache field must refuse despite recomputed digest`.
- `reuse-old-consumed-policy` fails
  `test_prior_consumed_projection_policy_requires_refresh` with
  `prior consumed projection policy must refresh erased distinctions`.
- `consumed-erase-before-refresh`, `consumed-unlink-before-refresh`,
  `consumed-success-before-refresh` and `consumed-skip-recovery-publication`
  fail `test_consumed_bad_refresh_preserves_history_and_recovers` at the
  exact historical-byte, historical-path, no-success and replacement assertions.
- `reject-zero-file-counts` fails
  `test_actual_both_readers_accept_zero_ordinary_deleted_empty` with
  `valid zero/ordinary counts and deleted/empty comments must collect`.
  `corrupt-counts-for-readers` fails the same method with
  `both readers must retain actual file counts`.

AST comparison retains all 19 prior methods; 18 are unchanged. The original
malformed-file fixture gains valid surrounding fields to isolate its filename
failure. All 39 original literal fault tuples remain, along with the three
original special faults. The added consumed-validation-order fault makes the
current total 63. No prior test or fault is removed or disabled.

The classifier requires the named failed method and assertion diagnostic,
rejecting source echoes, unrelated method failures, errors, syntax failures,
missing failure footers and incorrect exit results. The full-cohort census
changes from 19 to 25. Its 15-transcript probe passes on both interpreters,
including refusal of old 12- and 19-method cohorts. Independent temporary
controller mutations reproduce the harmless survivor and nine targeted parser
faults per interpreter. Each targeted fault reaches
`Controller misclassified synthetic runner transcript` for its exact named
case. Synthetic transcript checks remain distinct from actual unittest runs.

The unchanged dedicated workflow invokes the current controller on Python
3.11 and 3.14 for PRs and main pushes, with read-only repository permissions,
synthetic responses and a five-minute job budget. It therefore discovers the
25-method census without a YAML change. This is source inspection, not a claim
of fresh CI at an integrated head. The inherited API/identity/timeout mutants
can fail on a later guard's different diagnostic; those failures alone do not
prove harmful publication. That earlier qualification remains valid.

All six new transcript archives match their committed manifest, including
280 exact member names, lengths and SHA-256 values. Final campaigns 04 and 05
bind the current collector, tests, controller and both readers, matching this
review's reruns. Earlier anchor and mixed-TypeError failures remain historical
attempts, not acceptance. The source-binding audit initially used the copied
review paths at their original commits and refused because those paths did
not exist. Correcting to each original review path yields the byte comparisons
above; that failed audit attempt does not count as a successful check.

## Exact provenance and unchanged approval

Source SHA-256 values at `76069d81f`:

```text
fetch_pr_details.py
2febd9fb6f7bdda760ed243a2511da6b44ff0eb12b49bf4de426d791c2162907
test_fetch_pr_details.py
bd42edf969fc53d34308e04267b1abb8fad2919a4336257dba5eddd91027a401
verify_collector_controls.py
250df40f90c8239eca68c12c9f702a7721a9a7b626d1408327897086d3c234dd
digest.py
0e82efebe0f8fee5680c435b5e1989957543ecf83057f31624b5a17b3795a288
full_text.py
1e859aa5c66833d4e6744c3fb22a80579aa2c20d49324c15863adb5216b17fb6
```

Both readers also match approval `52e3084` and parent `677369b27` byte-for-byte.
All eight approved artifacts match exact approval
`52e308404b2e2d5dcb90a3de6266da1ca0c8b58b`, parent and reviewed correction:
ROADMAP, MILESTONES, CORE_REQUIREMENTS_LEDGER, documentation index, historical
roadmap evidence log, and dated roadmap PROPOSAL, REVIEW and VALIDATION.json.
No scope, sequence, completion grade, provenance or scientific claim changes.

Temporary rerun logs, independent results and audit receipts remain under the
temporary directory named above. `independent_probe.py` has SHA-256
`ff4c3f64086bda14bfe8374d9ebf6c4b40679ce94618d260e47b28c6369805a4`;
`audit.json` has SHA-256
`722427ce3567218659381b9de8dce9c26602f4e9f74f18bcc26197dff92d81dd`.
Only this report is committed. The committed candidate controllers and retained
archives provide the durable replay sources; temporary files are not permanent
evidence custody or authenticated provenance.

## Acceptance limits and parent handoff

- Transport-complete means successful processing of supplied endpoints. It
  does not prove source-set completeness, uniqueness or a common upstream
  snapshot. Declared file-count mismatches remain explicit and nonblocking.
  PR12296 and the prior 72-record audit remain inherited evidence. This review
  makes no live corpus capture or independent authentication of private inputs.
- Hashes and policy markers do not authenticate host/repository, collector
  identity, source authorship, freshness or upstream currency. Deliberate
  receipt rewriting is not authenticated. Unused metadata and semantic numeric,
  text, timestamp, status, path, account and SHA correctness remain unvalidated.
- Synthetic subprocess responses and asserted CLI flags do not establish live
  pagination, rate-limit behavior or real hanging-process deadlines. The
  per-call budget is 60 seconds; five sequential calls can approach five minutes.
- Atomic publication fsyncs the sibling temporary file before replacement and
  preserves history on injected failure. Directory-entry power-loss durability,
  hostile local filesystems, symlink/path races and resource exhaustion remain
  unproved. The operation is per record, not a corpus-wide transaction.
- Historical downstream readers can consume stale or malformed retained files
  after refused refreshes. Bot filtering, truncation and absent patches remain.
  Reader completion does not prove source meaning or research recommendation
  quality. No full upstream-schema validation is claimed.
- No application suite, build, service, database, migration, browser journey,
  practitioner/public-participant, accessibility, scientific, independent-host,
  restore or full-V1 acceptance follows from these synthetic controls.

Parent should integrate the correction, compare the integrated source/tree with
this exact object and obtain fresh exact-head CI. This review performs no
GitHub mutation, watcher, push, main merge, hosted change, migration application,
database reset, process termination, branch deletion or paid provisioning.
T3 internally links the existing PR; that does not mutate GitHub. All broader
integration and production coordination remains with parent.
