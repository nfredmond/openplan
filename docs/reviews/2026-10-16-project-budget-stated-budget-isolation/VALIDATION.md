# Validation and limits

## Behavioral checks

The new loader tests cover five malformed amounts, five honest optional values, an actual permission-error shape, wrong version and project identity, and invalid deliverable records. Two page cases cover invalid money and permission failure. They assert that recorded delivery work and edit prefills remain, while the financial summary stays unavailable. The RPC mock asserts the exact function name and project argument. It does not execute SQL.

| Source trial | Passed | Failed | Excluded | Intended observation |
| --- | ---: | ---: | ---: | --- |
| Before fix | 10 | 6 | 84 | Malformed money discards valid delivery work |
| Corrected selected | 16 | 0 | 84 | Source failure remains local |
| Harmless comment | 16 | 0 | 84 | Harness accepts a nonbehavioral edit |
| Remove isolation | 10 | 6 | 84 | Valid delivery preservation fails |
| Invent source success | 10 | 6 | 84 | Unreadable-source assertions fail |
| Wrong source message | 11 | 5 | 84 | Exact failure provenance fails |
| Invent zero amount | 10 | 6 | 84 | Missing amount must remain null |
| Accept foreign project | 15 | 1 | 84 | Outer identity refusal fails |
| Restore financial summary | 14 | 2 | 84 | Page disclosure assertions fail |
| Exact restoration | 16 | 0 | 84 | Original candidate behavior restored |

Each mutation restores the touched source in `finally`. The temporary financial-summary mutation touched `page.tsx`; its exact bytes were restored and it is not part of the candidate diff. The final related nine-file run passes 254 tests, zero failures and zero skipped tests. Selected-run exclusions above are not presented as passing cases.

## Execution boundary

Recorded dependency commands run serially under the shared compiler flock, one Vitest worker, a 1 GiB memory cap, zero swap and 50 percent CPU quota. Node receives a 512 MiB heap. Dependencies are reused through local symlinks with a final kernel read-only donor bind. Owned caches, temporary paths and output stay private. Network is unshared. Corrected commands clear the environment before setting the allowlisted paths.

The first setup attempt failed to resolve `vitest/config`. No source assertions ran. Its copied runner inherited the environment even though donor read-only, network and resource bounds were present. `failed-setup-01` and `setup-correction.json` preserve that deviation. A private dependency symlink and explicit environment clearing correct the later runs. This setup failure is not a mutation kill. No donor install, modification or historical cache restoration is claimed.

The resource-assertion campaign passes baseline, harmless and restored trials. Removing each memory, swap, CPU or donor-read-only predicate causes its named refusal to disappear and the control to fail. These are pure controls over the actual assertion AST. They do not demonstrate a physically misconfigured cgroup or a denied donor write. Actual run observations separately record the expected caps and read-only bind.

| Final check | Exit | Peak bytes |
| --- | ---: | ---: |
| Resource assertion controls | 0 | 15,540,224 |
| Changed-file lint | 0 | 346,259,456 |
| Seven-entry TypeScript closure | 0 | 337,506,304 |
| Nine-file related tests | 0 | 453,521,408 |

All four record zero memory events. The TypeScript closure includes budget math, loader, loader tests, migration source tests and shared fixtures through seven explicit entries and their imports. It excludes full page and board compilation. Ten selected reused package versions match the lock file; this is not whole dependency-tree parity or a clean installation.

## Evidence and blind categories

The private root is `/home/nathaniel/.local/state/openplan/project-budget-stated-budget-isolation-20261016`. The manifest pinned by `evidence.json` captures preceding regular files and link targets without following dependency symlinks. It includes failed setup, exact commands, process results, logs, source pins and mutation records. It excludes itself and later report output. Public source hashes match the current staged bytes.

Mocks and jsdom cannot establish native SQL, permissions, RLS, database transaction behavior, committed row completeness, API limits or production rendering. No database, browser, account, provider, hosted configuration, build or release operation runs for this report. Aggregate money precision remains a separate correction and human finance validation remains open.
