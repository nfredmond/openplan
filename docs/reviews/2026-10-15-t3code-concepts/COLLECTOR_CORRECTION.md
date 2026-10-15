# Selected PR collector correction

October 15, 2026. GitHub review of PR 329 identifies two reproducibility
defects in `scripts/fetch_pr_details.py`: unsuccessful CLI requests return a
dictionary that later projections can discard as empty evidence, and paginated
arrays can be parsed incorrectly or discarded. Both findings are valid.

## Corrected behavior

The collector refuses unsuccessful requests and malformed responses. Object
reads remain distinct from list reads. Every list endpoint uses the installed
CLI's `--paginate --slurp` contract; it validates every page and keeps the rows
in order. Empty successful pages remain valid empty evidence. Each CLI call
has a 60-second deadline. A failed or timed-out endpoint aborts collection.

The collector publishes a v2 receipt only after the PR record and all four
list endpoints succeed. It records endpoint counts and a receipt digest. It
keeps declared versus returned file-count disagreements explicit. It reuses
only an intact current receipt with matching identity, counts and digest.
Legacy or damaged caches require refresh. Atomic replacement keeps historical
bytes if collection or publication fails. The digest detects altered local
bytes; it does not authenticate GitHub or protect against deliberate forgery.

The existing comment limits remain 4,000 characters for issue comments and
2,500 for review comments and reviews. This is not a complete comment-text or
patch collector. It does not interpret fetched text as instructions.

## Live audit of the retained study

The lead makes a separate fresh collection of the same 72 selected PRs using
the installed GitHub CLI. Each has a v2 success receipt. The PR metadata,
complete returned file lists, and all three projected comment/review lists
match the original saved records exactly. The original records remain
unchanged. The known upstream discrepancy persists: PR 12296 declares zero
changed files while its files endpoint returns four. The 190-file PR 3699
retains all 190 filenames. The fresh audit therefore finds no missing projected
record in the retained study and changes no recommendation.

This later comparison cannot recreate the earlier server state or prove that
every original endpoint call succeeded. It does not establish reading of new
material, complete patches, untruncated discussions or runtime behavior. The
original corpus, capture interval and reading declarations stay historical.
The live recapture uses the initial corrected collector; the subsequently added
CLI deadline and cache-number type check have separate synthetic controls.
The [audit receipt](evidence/collector-recapture-audit.json) binds the original
and fresh records without copying upstream comment text into the repository.

## Controls and limits

Twelve standard-library unit tests exercise failed reads at each endpoint,
190-file pagination, successful emptiness, malformed responses and rows, exact
PR identity, retained-cache refresh, altered receipts, timeout, duplicate
selection, explicit file-count disagreement and failed publication. The tests
call the actual collector functions and assert the constructed CLI arguments;
only the subprocess transport is mocked.

Baseline, harmless-comment, restored-after-harmless and final restored cohorts
pass on Python 3.14 and 3.11. Twenty-three deliberate source faults fail at
their named assertions. The controller requires that named failure and its
diagnostic; an unrelated nonzero process exit is insufficient. It restores
exact source bytes in `finally`. [Controls](evidence/collector-controls.json)
retain outcomes, source hashes and each check's blind category. The dedicated
research-collector workflow repeats these synthetic controls without making
GitHub API requests.

These controls cannot establish live API completeness, provider rate-limit
semantics, remote authentication, semantic reading or future recommendation
quality. The separate live audit checks retrieval through the installed CLI.
The roadmap scope and sequencing approval remains unchanged. No application,
schema, deployment setting, release grade or scientific claim changes.
