# Saved API project UI acceptance

Latest checkpoint: full QA handle 94182 finished exit 0 on 886ce2dc.
Shuffled 912556, 479 isolated RLS checks, both browser widths and Upgrade Path
34730331136 passed. All owned browser/dev/model/worker processes are stopped.
The next commit lands directly on main; inspect its exact CI/RLS before tagging
v0.55.0. Do not restart completed local checks without new changes or failures.
See local-release-checks.json and the final sections of VERIFICATION.md.


Active full v1 goal, A0b. Published release remains v0.54.0. Worker increment is
on main at 47c4985e. Its RLS Isolation 34728670387 completed successfully. CI
34728670375 has successful Python worker, modeling, ops and shuffled jobs;
QA also completed successfully. All five CI jobs and RLS passed for 47c4985e.
Do not poll or restart these completed worker runs.

The request endpoint is branch-pushed at 22a97822. The project provider panel
now has Saved workspace API selection, paged metadata using the existing
provider-api-metadata parser, configured model selection, endpoint/auth/shared
record disclosure and explicit consent. It preserves the chosen revision rather
than silently advancing it after refresh. Exact connection/revision/hash is
checked for both POST acknowledgement and uncertain-request recovery. The
browser parser now supports retained API history and its original destination.
Proposals still require the existing conversation review flow.

New panel tests: 25 cases. Restored replay of both panel suites plus API endpoint
passed 79 cases; TypeScript and changed-file ESLint passed. The initial lint
warning about reading a ref in effect cleanup was resolved with the existing
callback invalidation pattern. Mutation campaign completed one harmless survivor
and 22 targeted failures; source restored. Private recovery:
/tmp/openplan-api-project-ui-mutations-gUnt56/state.json.
These tests mock HTTP and cannot establish real navigation, rendered layout,
worker execution or live database integration. Browser acceptance is next.

Isolated Chrome launch with channel chrome and about:blank navigation passed.
Use the authorized harness at
/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test.
Implementation checkout:
/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10
Package openplan/, branch work/planner-agent-api-connections. No other agent
owns this worktree; the other active session is in Job Search. Root/demo remain
untouched. No subagents. Preserve unrelated reminder constraint and private keys.

## Release candidate checkpoint

The UI and actual-worker journeys passed at desktop and 390px on source
5b84838c86852a228e23ea1a138551581b9132fd. VERIFICATION.md, public synthetic
JSON reports, viewport captures, build-identity.log and BROWSER_SHA256SUMS retain
the evidence. Keyboard save/retry/cancellation, one dispatch after response loss,
keyed original and keyless corrected generation, immutable old history after
correction/revocation, anonymous history 401 and direct credential 403 passed.
The final mobile retry followed a recorded Chrome network-change failure; it
used Refresh connections and passed with only the deliberate POST abort error.
The earlier source selector mistakes and clipped capture are documented too.

The dev server on 3255 was stopped intentionally after browser collection.
Its handle 68984 is terminal, exit 143. No browser, model fixture or API worker
remains running. No new Python/scientific behavior was introduced.

Version/package-lock, contract/roadmap/matrix/registry release metadata and
changelog are aligned to the v0.55.0 candidate. Review dates and capability
statuses are unchanged. The release high-water mark is 318 migrations through
20261012000002_assistant_api_turns.sql. Release-ordering fault probes had one
harmless survivor and two expected failures; source restored. Browser source
precedes only version, documentation and release-check changes, not runtime edits.

Next: run full candidate QA, shuffled seed 912556 and full RLS in the named
isolated stack. Keep their real session handles and logs; do not restart a live
job. Commit/push checkpoints, land directly on main when applicable local checks
pass, inspect exact main CI/RLS, and manually dispatch Upgrade Path from v0.54.0
on the final candidate. Tag/publish v0.55.0 only after the declared gates pass.
Then continue the full roadmap. No draft PRs, paid services or human-review gates.

## Private environment

Private files, never print or commit:
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12
api-settings.env and api-settings-account.json. The checkout .env.local targets
an older stack; override it. Named disposable Supabase workdir:
/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050
API29821/DB29822, container supabase_db_openplan-restore-target-2026091050.
318 migrations already applied; no reset/reapply. Live API claim is global;
never overlap claim/mutation suites. Last verified queue was empty.

## Usage-reset checkpoint, September 12

Current candidate source is 8b4f756c324b224686216e055885f99a2fe588fe, already
pushed to origin/work/planner-agent-api-connections. Working tree was clean
before this notes-only checkpoint. Main remains the earlier worker increment;
the UI candidate is not yet on main or released. The only other Codex process
is in Job Search; this session owns this resumption note.

Recovered actual candidate results:
- Full QA handle 47344 finished exit 1. Normal suite: 1 failed, 14079 passed,
  450 skipped; 1257 files passed, 1 failed, 43 skipped.
- Shuffled seed 912556 handle 75430 finished exit 1 with the same failing test
  and counts. This is not evidence of order dependence: normal order also fails.
- Both fail planner-copy-says-the-plain-thing.test.ts, baseline comparison at
  line 283: record increased 265 to 266, workspace increased 158 to 160.
  Inspect the newly introduced user wording and existing jargon guidance;
  fix the actual wording or justify any legitimate terminology explicitly.
  Do not blindly increase the baseline to manufacture green. Other QA stages
  after the failed suite are not established by this run.
- Full isolated RLS handle 67884 was still running at checkpoint. Its quiet
  log only showed startup; no terminal result yet. Recover it before starting
  another live suite. If the tool handle expires, inspect processes and retained
  log instead. No database reset or concurrent claim suites.
- Upgrade Path 34730331136 completed SUCCESS for exact candidate 8b4f756c,
  manually dispatched from v0.54.0. Do not dispatch it again without a reason.
  https://github.com/nfredmond/openplan/actions/runs/34730331136

Logs are retained privately under the api-provider-research directory below:
v055-full-qa.log, v055-shuffled.log, v055-full-rls.log. QA and shuffle logs are
terminal; the RLS log may still grow. Next recover RLS, fix the demonstrated
wording failure, verify the change and repeat applicable candidate checks.
Any browser-visible wording change requires proportionate browser verification.
Then land directly on main, inspect exact final CI/RLS, and release v0.55.0.
Keep developing toward the complete v1 contract afterward. No draft PRs and no
human-review release gate. No v1 completion claim has been made.

Returning after a usage reset: use this same thread and say continue. Re-read
this file and current git/process state; tool handles and running processes
must not be assumed to survive. All expensive implementation/browser evidence
is committed. A reset is not evidence that an interrupted command completed.

Terminal log SHA-256 values:

- v055-full-qa.log: d10245deac3fceadc95e8050dc83f278c43c88b206dc574ba05aafcc57ab8df7
- v055-shuffled.log: f6e81a6573b4bb0f001ea18d5a3bb694f8fba8bcdaa30cabfccc210d44c98973

## Wording fix and recovered RLS result

RLS handle 67884 finished exit 0: 479 tests across 50 files. All nine retained
SQL function-source hashes match the earlier worker reference and active API
queue is zero. UI wording now says Saved API, links to settings, and specifies
name, summary, status and question in both the disclosure and consent. No test
baseline was raised and no guard changed. Focused copy and both panel suites
passed 57 tests. A harmless comment control passed all four copy checks; original
wording failed the baseline as documented above. The copy guard cannot assess
meaning or layout; fresh browser acceptance and full QA/shuffle follow.

Final browser wording replay on b86f5f87 passed at both widths, with inspected
images and public artifacts under wording-replay/. Full shuffled replay passed
14080 tests; RLS and Upgrade Path are complete as recorded above. Dev handle
34729 was stopped after acceptance. Full QA replay starts next; do not re-run
unchanged RLS or browser journeys without a new reason. See VERIFICATION.md.
