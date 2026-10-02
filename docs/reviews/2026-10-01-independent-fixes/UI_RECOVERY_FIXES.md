# Callback and public error recovery follow-up

October 1, 2026. Reviewed integration baseline: `9530d77c`, including main through
`d72c11095e679e897dcf7796fcc6bbcc4ee1ad0c`. Changes remain in the isolated
`independent-fixes-20261001` worktree. The security agent owns only the callback
helper and its tests, the portal error component and its focused test, this note,
and `evidence/security-ui-recovery-*`. The root agent owns browser evidence and
integration. No database, provider or financial behavior changes here.

## Changes

`openplan/src/lib/auth/callback-destination.ts` now catches invalid caller-supplied
destinations and returns `/dashboard` on the original origin. Previously,
`next="/\n/["` passed the prefix check and caused `new URL` to throw after the
callback redeemed the authentication code. The existing parsed-origin comparison
remains, and valid local queries and fragments remain intact.

`openplan/src/app/(portal)/error.tsx` now asks the participant to try loading the
page again. It no longer claims that earlier submissions were received or that
the problem has a known cause. The boundary has no submission receipt or cause
information to support those claims. Its retry button now reloads the page, so
the browser requests a fresh server response rather than only resetting the
client error boundary.

The root agent subsequently tested an actual Server Component failure with an
external flag controlling the fault. After removing the flag without changing
source or triggering HMR, the original reset-only button retained the same error.
Fresh navigation succeeded. This exposed a limit of the initial component test,
which proved that reset was invoked but could not prove server recovery. The
updated test intercepts only browser navigation and requires the click to call
`window.location.reload()`. A full reload also recreates the error boundary; it
does not claim that a previous submission succeeded.

## Focused evidence

The two focused suites contain nine passing tests. They exercise malformed
input, valid local destinations, an origin change exposed by URL normalization,
the actual rendered portal message and an actual button click requesting reload.
The component remains real; the test suppresses console output and intercepts
`window.location.reload`, since jsdom cannot perform document navigation.

The mutation harness in `evidence/security-ui-recovery-mutations.py` first runs
the unchanged implementation and then a harmless comment, both with nine passes.
Removing malformed-input recovery causes three intended failures. Removing the
origin check, dropping the fragment, restoring the unsupported receipt claim,
restoring the unsupported cause claim, disconnecting reload, and reverting to
the original reset-only handler each cause one intended failure. The harness checks assertion names and records assertion
messages, rather than accepting any nonzero process exit. Every temporary source
mutation is restored; hashes and results are in
`evidence/security-ui-recovery-mutations.json`.

Command: `npx vitest run src/test/auth-callback-destination.test.ts src/test/portal-error-recovery.test.tsx`.
Focused ESLint checks the same four application and test files.

These tests do not prove email delivery, Supabase code exchange or cookie
persistence, real navigation, responsive layout, screen-reader behavior, or
submission acknowledgement. This agent does not claim browser acceptance.
The root agent records its separate identified-build browser evidence. Invalid
configuration origins still throw; `origin` comes from the parsed request URL,
not from the caller-supplied destination.

## Identified browser recovery

The coordinator opens a temporary synthetic portal route from a real link in the owned T3 tab and development build on port 3198. The route throws while an external synthetic flag exists. Removing the flag without changing source leaves the original reset-only button on the same error and digest; fresh navigation recovers. With the corrected reload handler, the same button reaches “Synthetic recovery completed.” Desktop 1440×900 and 390×844 error captures are retained. The expected injected server error is distinguished from unexpected failures. Fixture sources and results are recorded, and all three temporary routes are removed before publication. This proves server-page retry and displayed recovery wording, not public-participant or screen-reader acceptance.
