# Assistant evidence fixture type repair, October 9, 2026

GitHub CI run `37927258617`, QA job `113809069076`, failed at commit
`ebfdda6b334d7efb213cb27e3b094a3d9df7b5d7`. The QA job recorded 1,522 passing
test files and 96 skipped files, and webpack compiled successfully. The build's
TypeScript phase then failed with TS2339 at
`src/test/assistant-chat-evidence-tools.test.ts:361`.

The fixture returned a specifically inferred object without the
`model_attempt_instrument_custody` table. The new custody test assigned that
property afterward, which worked at runtime but failed type checking. The test
now constructs an extended object with the table declared at initialization.
It retains the narrow inferred type, all four expected attempt records, the
other-workspace decoy, exact projection assertion and workspace/run filters.
No assertion, production query or type-checking rule was removed.

## Verification and limits

All 23 tests in `assistant-chat-evidence-tools.test.ts` pass with one Vitest
worker. A scoped TypeScript check also passes for this test and its imported
dependencies. Its temporary configuration extends the application's tsconfig,
includes the application declaration files and uses its normal `node_modules/@types`
directory. The first scoped attempt omitted that ambient type directory because
the temporary config lived outside the application; it reported missing GeoJSON
types. Correcting the test configuration resolved those errors without changing
application code or relaxing compiler settings.

The attempted full local TypeScript check exhausted a 3 GB Node heap and exited
134. It is not a passing full-app type-check. The original CI failure and local
check records remain under
`/home/nathaniel/.local/state/openplan/ci-qa-typecheck-ebfdda6b3-20261009`.
Full exact-head GitHub QA, RLS and restore results remain required for landing.

All nine existing instrument-consumer controls meet their expected outcomes.
The control script exercises the real reader,
assistant tool and report HTML builder against synthetic database mocks. Its
harmless and targeted mutations preserve the distinction between exact attempt
identity, workspace scope and failed reads. The report retains those limits;
it does not establish authenticated REST, downloaded report usability, browser
layout, evidence completeness or scientific acceptance.

This is an integration repair within PR #171. PR #170 still requires the retained
T3 visual acceptance work. Neither this correction nor a passing scoped check
declares the stack merged or the full v1 contract satisfied.
