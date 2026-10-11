# Correct the total-heap test assumption

[Exact-source CI](build-memory-ci-failure.json) at `48648251cbda` completes both QA and shuffled suites with four failed assertions in the new build memory probe. Each suite records 21,655 passing tests, 1,595 skipped tests and four failures. The failed suites receive no passing QA credit.

The test incorrectly allows less than 100 MiB beyond the configured old-space limit. CI reports total limits of 6,336, 704 and 960 MiB for old-space settings of 6,144, 512 and 768 MiB. The package command preserves the requested settings. The independently completed production build retains its own source boundary.

[Node's command documentation](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib) distinguishes old-space and young-generation settings. The young-generation allowance depends on system memory limits. A fixed allowance does not establish whether the build command honors the operator.

The corrected probe compares the actual npm child with an independent direct invocation of the same Node executable and intended memory options. It checks exact executable identity, option preservation, webpack arguments and compiler exit propagation. The complete-options case explicitly supplies a 64 MiB semi-space setting, producing a 192 MiB allowance that exceeds the old test's assumption. No arbitrary upper bound is widened.

[Current controls](build-memory-runtime-controls.json) pass baseline, harmless and restored runs. The five package-command mutations remain. Seven additional variants reproduce a larger command-line child heap, wrong executable identity, incorrect independent reference, nonfinite measurement, failed reference command, undersized reference and incorrect semi-space reference. Each fails its intended named assertion. Original package and test bytes restore in `finally` and their hashes match.

Five focused tests, strict selected-file lint and scoped NodeNext TypeScript pass. The mutation service uses one Vitest worker, a 1 GiB memory limit and no swap. It takes 21.753 seconds and peaks at a rounded 172.9M. These checks exercise the npm command with a small real Node child in place of Next. They do not measure compiler capacity, establish new browser acceptance or replace current full CI.

The queued documentation checkpoint's CI is cancelled after confirming that it contains the same known failing test. Its running RLS and restore workflows remain untouched. A corrected source push and complete exact-head workflows remain required before integration and release. The encryption-custody investigation stays in a separate worktree and does not change this application candidate.
