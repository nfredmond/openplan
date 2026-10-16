# Fresh local QA passes on frozen 06a

The parent completes fresh local QA on October 15, 2026, at exact source
`06a108010ab39aa42eed4c2bcda3e1371b8aa813`. All eight command stages exit zero.
This is local engineering evidence, not a release or browser acceptance record.

## Source and dependencies stay fixed

The tested checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-0f743997`,
with the application package at its nested `openplan/` directory. Its own
lockfile installation replaces the earlier borrowed dependency symlink.
Canonical dependencies remain unchanged. The lockfile SHA-256 is
`40c30e5b8ae8aac104f242af61298b9e5a3e85fe7b004fee3c44d945c7cfe965`.
Mammoth resolves argparse 2.0.1, and a separate native SQLite query succeeds.
Node is 24.22.0 and npm is 11.19.1. Final source and working-tree checks retain
the exact initial commit and a clean tree.

The earlier b4 diagnostic remains preserved, including five failed cases,
40 pending assertions after two worker exits, the shared dependency mismatch,
and the earlier cgroup OOM. This successful run changes both dependency custody
and resource allowances. It does not establish a single cause for those exits.

## Completed results

| Stage | Result | Duration, seconds |
|---|---|---:|
| Six previously failing or interrupted files | 190 passed | 163.715 |
| Full lint | Exit zero | 97.181 |
| Dead-code check | Exit zero | 3.213 |
| Full Vitest suite | 22,931 passed; 1,662 skipped; zero failed | 1,995.414 |
| Provider connector checks | Exit zero | 8.197 |
| Ordinary RLS gate, opt-out path | Exit zero; no live RLS execution | 0.020 |
| Dependency audit | Exit zero | 1.208 |
| Product direction consistency | Exit zero; existing reminders retained | 0.453 |

Vitest reports 1,662 passing files and 106 skipped files, 1,768 in total.
Its JSON contains exactly 22,931 passed and 1,662 skipped assertion states,
with no failed or unresolved assertion states. JSON `numPendingTests` includes
the skipped assertions; it does not identify an additional unfinished cohort.
The service completes with exit zero and `Result=success`.

The suite uses one worker, disables file concurrency and keeps its Vite cache
in the private proof directory. The service enforces 6 GiB memory, zero swap,
two CPU quotas and a 2,048 MiB Node heap. Its retained cgroup reading records
3,270,344,704 bytes peak memory, zero peak swap and zero OOM or memory-limit
events. The shared PostgreSQL server is not exercised by the opt-out RLS gate.

## Sensitivity and limits remain explicit

No test or guard changes in this parent run. The joined source retains the
earlier harmless controls and targeted faults for the copy, projection and
journal repairs. The later scanner expression correction has its own
[independent review](../2026-10-15-projection-expression-shadow-independent/STATUS.md)
and the joined 161-case cohort in [the integration record](STATUS.md).
Those checks cover the later two test/helper files; they do not change this
full suite's source identity to the later integration HEAD.

The run uses CI placeholders and local synthetic fixtures. Skipped live tests
remain skipped. Production build, full application TypeScript build checks,
live RLS, operational preview, desktop and 390px navigation, console review,
download custody, hosted delivery, human usefulness and scientific acceptance
remain separate. The preview packet still identifies 06a. The later workbook
formatting correction is absent from this tested source.

Raw configuration, logs and JSON remain private under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-combined-final-qa-20261015/`.
The adjacent `fresh-qa-evidence.json` binds the retained command and result
files by SHA-256. The parent does not overwrite historical failed trials.
