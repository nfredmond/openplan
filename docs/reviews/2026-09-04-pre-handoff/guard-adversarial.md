# Adversarial guard review, 2026-09-04

Reviewed isolated commits `0918bb040e6e0ef3f2afe023b91f166f59400ddf` and `732a49211397652f31bcab9463d4b34b9bb4e0eb`. This is the original pre-repair finding record. No checkout was edited while establishing these findings. Pure fixtures live in `guard-adversarial/probe.mjs`, their generated inputs in `guard-adversarial/fixtures/`, and observed decisions in `guard-adversarial/results.json`. No browser, live server, database or model was used. Historical browser filenames were inventoried read-only; this does not revalidate those journeys.

## Decision

The maintenance improves two real fail-open boundaries and connects useful existing offline suites to normal QA. It is appropriately narrow once the demonstrated browser symlink evasion is repaired. It does not implement complete release acceptance, authentic browser capture custody, scientific validation, human usefulness, or practice-by-organization-by-geography proof. Those limits must remain explicit.

## Demonstrated findings

1. **Fatal console symlinks are silently skipped, a regression introduced by the new file-type filter.** At `qa-harness/first-week-discovery.js:579-582`, `Dirent.isFile()` excludes symlinks before reading console logs. My completed/yes fixture with a regular page, empty regular console, and a regular fatal console fails. Replacing only that fatal log with a symlink to the identical fatal bytes makes full `verifyRun` pass. The earlier filename-based reader would read those bytes. This is an actual evidence-verifier evasion, not a product/browser exploit. Reject relevant nonregular/symlink records explicitly instead of quietly treating them as absent. Test both aggregate verification and resume behavior.

2. **The browser directory itself can borrow another journey's captures via a symlink.** `inspectBrowserCapture` at lines 598-616 calls `readdirSync` without establishing that its browser directory is a real directory rather than a symlink. A completed/yes fixture whose browser directory points to another scratch journey's regular captures passes. File-entry checks do not constrain the directory. Explicitly reject the directory symlink. Broader ancestor/manifest custody is a separate existing boundary.

3. **A zero-byte file with its correct SHA can support a proven cell.** `openplan/scripts/ops/capability-evidence.mjs:36-59` establishes a regular in-repository file and exact digest, but not nonempty contents. The empty-file fixture passes. Rejecting zero-length evidence is a useful bounded improvement; even then any nonempty unrelated text can still satisfy this mechanical contract. The helper's header correctly leaves applicability and actual outcome judgment to reviewers. Do not claim that hashing alone prevents false proof.

## Correct refusals and compatibility observations

The capability helper rejected a symlink escaping its repository root, two paths resolving to the same canonical file, an outdated cell review date, an impossible date, and a changed digest. Its `realpathSync` containment and canonical duplicate checks work for the tested cases. An ordinary exact-byte fixture passed, so these checks did not reject everything. The global date is validated in `product-direction-review.mjs:442-447` before the helper is called at line 470; registry expiry is enforced afterward at lines 489-490. Standalone helper behavior must not be mistaken for the complete integration.

Every sampled genuine job used `page-<UTC timestamp>.yml` and `console-<UTC timestamp>.log`: all twelve jobs in `2026-09-01T11-06-18-597Z`, the neutral job in `2026-09-04T21-00-45-902Z`, and the two populated jobs in `2026-09-04T21-16-15-287Z`. They were read under `/home/nathaniel/.local/state/openplan/first-week-runs/`; an initial lookup under the old checkout-local path found no directories. No filename incompatibility was demonstrated. Some genuine jobs have multiple console files, and resumed jobs contain capture timestamps hours after the run-root creation time. Preserve empty console files as valid captures; missing and empty consoles mean different things. Do not infer artifact age solely from the root directory timestamp or demand one console per job.

The new cell review date must be within the current registry review period. That is a date of review, not necessarily the original capture date. An unchanged older record may be reviewed again; mechanically rewriting its capture date would damage historical evidence. Conversely, the metadata date is not proof that review occurred. Integration documentation must say what reviewer judgment and candidate applicability are required.

## Known broader false-proof boundaries

A fixture containing the literal `x` in `page-1999-01-01T00-00-00-000Z.yml`, an empty matching console log, and a completed/yes report passes full verification. No screenshot or findings are necessary when the report has no findings. This establishes the implementation's actual scope: retained nonempty page-named text and a console record, not authentic page content, contemporaneous capture, or the intended user outcome. The new summary explicitly acknowledges those limits at discovery lines 975-982. An honest summary should retain that qualification.

`verifyRun` trusts selected manifest jobs, recorded/inferred completion and self-reported outcomes; it does not itself perform `compareBuildIdentity` or verify the candidate named by a historical run against a release. Existing execution startup checks and an external same-candidate release evidence policy remain necessary. `first-week-evidence.js:296-307` separately loads `.yml`, `.yaml` and `.txt` browser dumps for findings; its broader file set is not proof that the new outcome check must accept arbitrary `.txt` as an MCP page. None of these broader mechanisms was implemented by the two reviewed commits.

## Offline suite integration

The new Vitest wrapper invokes four existing Node suites with a 20-second subprocess limit and 25-second test limit. I ran those four suites directly with `TMPDIR` confined to `guard-adversarial/tmp`: discovery, finding evidence, regression decisions, and model-download verification all exited zero. Each completed in less than a second in this run; this is local fixture timing, not a loaded-CI guarantee. Their assertions contain refusing cases, and the model-download suite explicitly rejects changed bytes. I did not run the app's full Vitest suite or the wrapper through Vitest in this pre-repair review.

Moving Playwright's import inside `first-week-regression.js:192` prevents offline classification tests from loading the browser package. The actual browser runner still imports Playwright inside `main`. The helper finds the sibling QA package by walking upward and throws if missing; the wrapper does not silently skip absent suites. Removal of the boolean tautology from the policy test is safe narrow cleanup. This does not add the missing behavioral CI coverage for every worker family.

## Proof inventory

| Fixture | Observed decision |
|---|---|
| Ordinary completed/yes, regular page and empty regular console | Pass |
| No browser directory | Refuse |
| Regular fatal console log | Refuse |
| Same fatal bytes through a console symlink plus empty regular log | **Pass: demonstrated evasion** |
| Browser directory symlink to other captures | **Pass: demonstrated evasion** |
| Stale filename and arbitrary page text | Pass: broader stated authenticity/semantic limit |
| Ordinary exact-byte capability record | Pass |
| Empty exact-byte capability record | Pass: missing minimal content requirement |
| Capability symlink escaping root | Refuse |
| Duplicate canonical capability path | Refuse |
| Stale/impossible review dates or wrong digest | Refuse |

Repair the symlink and empty-file boundaries with targeted fixtures and a harmless surviving mutation, then run the existing wrapper and relevant focused tests. Keep broader coverage expansion on the roadmap rather than representing this maintenance as a complete proof system. The parent review owns final source handoff, CI and current browser acceptance.
