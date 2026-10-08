# Native output test type correction

PR #155 failed GitHub QA run 37741559224 at TypeScript checking. The new process-loss test indexed nullable Supabase data after asserting its length. Vitest's length assertion rejects null at runtime but does not narrow the TypeScript type.

The correction adds non-null assertions to the three existing indexed reads after that length check. TypeScript transpilation of the original and corrected file produces identical JavaScript. No runtime assertion is removed or weakened.

Verification on October 8, 2026:

- The targeted native process-loss test passes against the named disposable `openplan-restore-target-2026091050` stack. Fifteen unrelated cases are skipped by the name filter.
- A harmless worker comment passes the same test.
- Deliberately refusing recovery from an observed journal fails at the resumed process exit-code assertion. Restoring the worker makes the test pass again.
- `git diff --check` passes.

The first invocation ran from the repository root and failed because the spawned CLI could not resolve `tsx`. Running from the application package corrects that invocation error. Native checks use synthetic provider output and do not establish browser, practitioner, host-loss or scientific acceptance. Full corrected-head TypeScript and CI checks remain pending. The earlier full local QA process continues against unchanged commit db92ca1b.

Private logs and control results are retained under `/home/nathaniel/.local/state/openplan/s1-metadata-20261008-proof/native-output-types*`.
