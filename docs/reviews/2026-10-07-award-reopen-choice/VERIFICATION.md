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
