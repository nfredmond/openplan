# Workbook layout dependency and historical probe integration

This follow-up resolves the two assigned integration issues above `69d52fe4e31a9cd6bea030c2a06ea657435473ec`. It declares the existing XML parser directly and restores historical probe sources. Runtime application bytes remain unchanged. The parent retains independent review of the whole candidate, integration, build and identified-build journeys. This report does not declare the format candidate released or accepted.

## Assigned checkout and ownership

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-710cbf16`, branch `t3/workbook-xmldom-dep-probe-restore`. It starts clean at launch commit `05dd3e8da4a4572437f06e771b0a2477873e681f`. A local fast-forward reaches exact `69d52fe4e31a9cd6bea030c2a06ea657435473ec`, with no fetch. The parent owns integration `87fa1ec8fc297138ab6c161098d64918d82716ca` in `t3-e33fc359`.

Ownership covers two package files, two historical probe restores and this new directory. No other tracked source changes. Other checkouts, installed dependencies, native artifacts, services and the frozen preview packet receive no writes. No nested delegation occurs.

AGENTS, planner-writing, prove-it, relevant spreadsheet guidance and the complete 69d [implementation report](../2026-10-15-portfolio-workbook-layout-implementation/REPORT.md) and [evidence](../2026-10-15-portfolio-workbook-layout-implementation/evidence.json) inform this work. The nested `openplan/` direction check exits zero. Its expired registry/matrix, release-version and intervening-change reminders remain. The V1 contract, roadmap, capability matrix, October 6 direction review, known issues, architecture and CORE-INCLUSIVE-01 retain their existing scope. This bounded correction changes no requirement, capability grade or direction date.

## Exact dependency change

`openplan/package.json` adds one runtime dependency:

```json
"@xmldom/xmldom": "0.8.15"
```

`openplan/package-lock.json` adds the identical declaration to `packages[""].dependencies`. Both files retain their original formatting. Removing that single added line from each restores its exact 69d bytes. No install, package resolution, upgrade, graph regeneration, fetch, download or Knip suppression occurs.

The lockfile retains 1,144 package entries. All 1,143 non-root entries compare equal, and every `resolved`, `integrity` and `license` value remains identical. The existing parser entry itself remains byte-for-byte unchanged. It still specifies version 0.8.15, its existing registry tarball, SHA-512 integrity, MIT license and Node >=10.0.0 engine. The existing Mammoth dependency uses this same locked parser. The only root metadata difference is the direct declaration. Manifest dependency and development-dependency maps match the lock root exactly.

Offline `npm ls --package-lock-only --all --json` exits zero. The parser-specific lock query shows 0.8.15 at the root and beneath Mammoth. An installed-module check separately identifies parser 0.8.15 in the protected dependency mount. These checks establish local lock consistency and installed identity, not new registry security intelligence.

Full `npm run deadcode` exits zero using the candidate source and the unchanged Knip configuration. It reports 573 unused-export, 696 unused-exported-type and one duplicate-export warnings under the existing warning rules. No unlisted-import error remains. No warning or rule is suppressed.

The network-bearing `npm run audit:dependencies` aggregate does not run. Its local components run explicitly: `npm run test:braces-vendor` passes all 19 cases, and `node scripts/ops/verify-braces-vendor.mjs` exits zero, reporting one installed local braces copy and ten matching file hashes. `npm audit` and npm registry requests do not run.

## Historical sources and current copies

Both historical files restore from `git show 783fd24c230a1e640543e51fcef6cd5d70db0bb0:<path>` using byte writes, without checkout or reset:

- `../2026-10-15-project-workbook-export-independent/probe.test.ts`, SHA-256 `cb6b587080ed3705dfdc63e87ad0429061a7a36b761a03cbd4680eb7c5af8eed`.
- `../2026-10-15-workbook-live-pagination/probe.test.ts`, SHA-256 `2491e76f49e2310d46335e84178caa175fee0ca2a8553f21cef76bd556d7c45f`.

Their original reports and source bindings remain historical evidence. Historical reruns must use the original pinned route and synchronous serializer described by those reports, including their exact `54537205a4f7c47f1f68f0827209bbf55de505d9` candidate. These restored files are not current asynchronous-serializer tests.

The new [independent route probe](independent-route/probe.test.ts) and [live pagination probe](live-pagination/probe.test.ts) preserve the corresponding 69d adaptations exactly. Their SHA-256 values are respectively `af1baae3a7dc99bb1ea136e8a5404bf68745561c9e922fe4753a6d5baa201e2d` and `ea45f1e29a2e413128f4fa2e1dd4ff25ca94feb15460c065f62394bf10745823`. Each differs from its historical original only by one awaited serializer call. No imports, assertions or directory references change inside either copied probe. Private configuration selects the new route-probe path and resolves `@/` to the current private source archive. The live copy retains its explicit private fixture/output environment variables. It is adapted and compiled, with no database execution.

## Fresh checks and behavioral controls

[Evidence](evidence.json) records commands, exits, counts, source bindings, restoration and resource receipts. Complete logs, JSON test reports, configurations, the private source archive and controllers remain under:

```text
/home/nathaniel/.local/state/openplan/workbook-layout-dependency-integration-20261015
```

Fresh focused checks pass all 27 portfolio serializer, export-route and engagement-export cases. The copied independent route probe passes all 17 cases. Scoped TypeScript covers the seven implementation/test files plus both new probe copies. ESLint covers the seven files and both probe copies, using the application test-file configuration for probe stdin. Every scoped lint check exits zero with `--max-warnings=0`. Manifest/lock JSON parsing, npm lock consistency and `git diff --check` also pass.

The behavioral control harness first rewords a comment in the private independent probe. Its selected zero-row case survives. Removing the actual route's serializer `await` then fails the named `independent complete byte parity` assertion: the response bytes differ from the awaited real serializer bytes. The test executes the handler and compares computed bytes, without checking source tokens or mocking the serializer. Separately, removing the copied probe's own `await` fails at `Buffer.from` with an actual Promise argument. Both faults run only against private source copies.

The live probe has a separate compiler-only control. A harmless comment survives scoped compilation. Removing its awaited expected-workbook call fails at the real `Buffer.from(expected)` use with TS2769, identifying `Promise<Uint8Array<ArrayBufferLike>>` as incompatible. This proves static async compatibility, not native PostgREST behavior. No live database probe, fixture read or connection runs.

Every temporary fault restores exact pre-control bytes in `finally`. Restoration hashes match the unchanged 69d route and both current copied probes. The restored independent probe reruns all 17 cases and scoped TypeScript reruns successfully.

The first control-controller trial stops on a missing Vitest JSON property, `numRuntimeErrorTestSuites`. Its harmless case itself passes, but that trial records no accepted mutation result. The corrected controller checks the actual result schema, one selected active case, all 17 discovered tests, expected diagnostics and absence of suite/unhandled-error banners. It reruns the harmless survivor before the targeted faults. The earlier controller and receipts remain private. No production source changes result from that harness correction.

## Isolation, commands and limits

A private Git archive supplies source at 69d. Only the assigned dependency declarations, restored historical files and new probe copies overlay it. Bubblewrap mounts the archive and borrowed `t3-0f743997/openplan/node_modules` read-only, gives output access only to the new private root, uses private caches and `/tmp`, and unshares the network. No package installation occurs. Tests run with one worker, no file concurrency and a 640 MiB Node heap. Systemd cgroups enforce 1 GiB memory, zero swap allowance, 50 percent CPU quota and CPU 23 affinity. The main checks peak at 515,592,192 bytes, controls at 474,824,704 bytes and supplementary lint at 291,688,448 bytes. All three record zero swap use and zero OOM or memory-limit events.

The retained controllers reproduce the checks through these bounded commands:

```bash
systemd-run --user --wait --pipe --collect \
  -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=50% \
  taskset -c 23 python3 -B \
  /home/nathaniel/.local/state/openplan/workbook-layout-dependency-integration-20261015/run.py
systemd-run --user --wait --pipe --collect \
  -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=50% \
  taskset -c 23 python3 -B \
  /home/nathaniel/.local/state/openplan/workbook-layout-dependency-integration-20261015/controls.py
systemd-run --user --wait --pipe --collect \
  -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=50% \
  taskset -c 23 python3 -B \
  /home/nathaniel/.local/state/openplan/workbook-layout-dependency-integration-20261015/supplement.py
```

These commands refer to this retained private environment and overwrite its check logs. A separate evidence directory and adjusted configuration are needed for another retained run. The full exact inner commands appear in evidence receipts. The direction check runs from this checkout's actual nested `openplan/` package.

The lock comparison cannot establish upstream package security, license suitability for every use or behavior of a future installation. Knip's static import analysis cannot prove runtime correctness or every dynamically loaded dependency. Scoped lint and compilation cannot establish a complete build. The in-memory probe uses auth/workspace/audit adapters and a bounded database-query fake. It compares the route with the same real serializer, so independent native cell/layout checks remain separate. It does not establish database snapshots, real authentication, RLS, PostgREST behavior, browser custody or planner usefulness. The live copy has compiler evidence only.

No application runtime bytes change, so the original native artifacts and 69d formatting/native evidence remain immutable and are not regenerated. Their original limits remain: five horizontal print bands, large print page counts, finite row-height limits and no human or Excel acceptance. The original 69d report remains unchanged, including its then-unresolved direct-dependency scope failure. This dated report resolves that finding without rewriting prior proof.

There is no new full suite, full QA, build, database execution, browser, service, provider, hosted operation, PR, push, main merge or release. Earlier full QA at 06a22931 does not cover this head. Parent review, integration and final journeys remain outstanding. The main delivery hold remains in force.
