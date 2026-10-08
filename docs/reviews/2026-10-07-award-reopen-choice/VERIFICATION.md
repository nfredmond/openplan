# Explicit status when reopening an award

T3 navigation from My Work to Grants on build `10c3bc0c` opens the imported
synthetic award's Re-open award form. The status already reads Active. Source
inspection confirms the initial state is `active`, despite a comment that the
planner supplies the destination. The form is canceled without submitting.
The retained baseline is `reopen-navigation-baseline.json` in the private
`award-obligation-review-20261007-proof` directory.

The corrected form starts with Choose a status. A written reason alone cannot
send a reopen request. Staff must choose Not started, Active or Delayed, and
the exact choice reaches the existing route. Opening another confirmation clears
a canceled status choice. The reason remains a draft. The API's existing status
enum, authorization and audit behavior remain unchanged.

Nineteen component tests and targeted ESLint pass. The three destination cases
assert refusal before selection, clearing after cancellation and the exact PATCH
payload. A harmless comment passes. Removing the missing-choice refusal, retaining
a canceled choice and forcing Active into the request each fail their relevant
assertions. The source is restored and all 19 tests pass again. Whitespace checks
pass. Private logs are under `award-reopen-choice-20261007-proof`.

An initial test invocation from the repository root fails to resolve the app
alias and runs no tests. The corrected command runs inside `openplan/`; only
that run counts. These tests simulate fetch and router refresh. They do not prove
live permissions, database persistence, final browser layout or agency authority.
Identified-build desktop and 390px acceptance, broader QA and integration remain
pending. This bounded correction does not complete obligation evidence or final
funder closeout under M13.

## Combined build correction

The obligation-only QA run on `11a897f6` passes 20,051 tests in 1,509 files,
with 1,565 tests in 94 files skipped. Provider checks pass 387 with four skipped;
dependency checks pass 18 and report zero vulnerabilities. Its production build
compiles, then fails TypeScript on the new deduplication key and reminder fixture.
The full QA run therefore fails. Its result and log remain retained.

The combined correction uses the declared `string | null` deduplication contract
and gives the synthetic closed-award fixture an explicit imported closure basis.
No assertion is removed. All 125 focused tests across six files pass. Targeted
ESLint and full TypeScript pass. The first standalone type check exhausts Node's
default heap and exits 134; the second uses the production build's existing
6 GB heap allowance and exits zero. Both logs remain in the private proof folder.
A harmless comment passes; collapsing the review against a milestone and omitting
the reminder closure projection fail. The sources are restored and all 125 tests
pass again. The queued build refuses to run on failed prerequisite QA as intended.

The corrected combined head requires its own production build, browser acceptance
and GitHub checks. Prior test success is retained with its exact commit and does
not turn the failed QA run into a pass.
