# Integration validation, October 8, 2026

## Full TypeScript check

The isolated integration checkout at `6aa6b54477365135c49690de06950b74088ff85c`
passes the full configured TypeScript check with no diagnostics. The command uses
TypeScript 5.9.3, a 6 GB Node heap, a 7 GB systemd memory limit, no swap for the
scope, a 128-task limit and disabled core dumps:

```sh
ulimit -c 0
systemd-run --user --scope --quiet --unit=openplan-integration-types-6aa6b5447 \
  -p MemoryMax=7G -p MemorySwapMax=0 -p TasksMax=128 -- \
  nice -n 10 node --max-old-space-size=6144 node_modules/typescript/bin/tsc \
  --noEmit --incremental false --extendedDiagnostics
```

The check exits 0 in 53.18 seconds. Compiler diagnostics report 4,580 files,
843,612 TypeScript lines, 9,680,766 instantiations and 4,770,307 KB of memory.
The configuration root inventory contains 3,509 files and no nested worktree.
The difference includes imported dependencies. The earlier 2 GB and 4 GB heap
failures remain failed attempts; the successful run uses the 6 GB allowance
already present in the repository's build script. No source exclusion or type
check bypass was added.

This standalone check precedes Next's generated build types. The production
build is a separate check. Neither check establishes runtime authorization,
rendered browser behavior, data recovery or scientific acceptance.

## Stacked PR checks

At this checkpoint, PR #171 targets the branch of PR #170. Inspection of GitHub
checks shows only the restore drill on #171. CI, live RLS isolation and worker
security each restrict pull requests to the `main` base, so those checks do not
run on the intermediate stack. PR #170 has eight passing checks, but that result
does not cover the later worker and recovery commits in #171.

The three workflows now use an explicit unfiltered pull-request event. Their
main-branch push triggers and job definitions remain intact. The native ops test
`test_stacked_pr_checks.py` requires each PR trigger, permits a harmless comment,
and rejects both a main-only branch restriction and a missing PR trigger. YAML
parsing separately confirms all three event mappings and their five, one and one
jobs. This source guard does not prove GitHub job execution, branch protection or
repository permissions. Observe the new head's actual checks after pushing.

## Production build resource boundary

The first bounded `npm run build` compiles webpack in 41 seconds and finishes
Next's generated TypeScript check in 58 seconds. It then attempts page-data
collection with 23 workers. Native Tokio runtimes cannot create their threads
inside the 256-task limit; the build exits 1 with `SIGABRT`. This is a failed
build, not a completed build or a compiler error. Core dumps remain disabled.

Inspection of the installed Next 16.3.8 code shows its default CPU setting uses
`CIRCLE_NODE_TOTAL` minus one when supplied. The retry sets that value to 3 and
limits affinity to observed available cores 0 and 1. It retains the same 7 GB
memory limit, zero scope swap and 256-task limit. No type-check, page-data or
static-generation stage is disabled. The build uses the same placeholder
Supabase and API values as CI, not a real account or preview database.

The retry exits 0. Webpack compiles in 20.3 seconds; generated TypeScript finishes
in 7.8 seconds using the prior build cache. Two page-data workers complete all
137 static pages in 1,277 ms, followed by page optimization and build tracing.
The command is:

```sh
ulimit -c 0
systemd-run --user --scope --quiet \
  --unit=openplan-integration-build-6aa6b5447-serial \
  -p MemoryMax=7G -p MemorySwapMax=0 -p TasksMax=256 -- \
  env CIRCLE_NODE_TOTAL=3 \
  NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key \
  SUPABASE_SERVICE_ROLE_KEY=ci-placeholder-service-role \
  ANTHROPIC_API_KEY=ci-placeholder-anthropic-key \
  taskset -c 0,1 nice -n 10 npm run build
```

The two allowed cores are specific to this observed Linux host. This built
artifact uses CI placeholders and is not the configured acceptance preview.
No application source changed between the checked commit and these runs. The
pending changes at build time are CI workflow triggers, their native test and
this documentation. Full TypeScript and production build validation now pass;
T3 visual acceptance, real session journeys, complete QA/worker/RLS/upgrade
checks on the integrated head and the full V1 requirements remain separate.
