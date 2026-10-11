# Build memory and operator settings, October 10

The package build command now preserves supplied `NODE_OPTIONS`. If the value
is absent or empty, it keeps the previous 6 GiB default. For example,
`NODE_OPTIONS=--max-old-space-size=2048 npm run build` reaches Next with that
2 GiB heap setting. The build continues to use webpack and returns compiler
failure statuses. A heap limit does not cap the combined memory of parent,
compiler and native allocations. Operators still need an appropriate service
or container limit.

## Two failed builds remain failed evidence

At clean source `fa2e0ba0edfe`, the first owned build reaches its 4 GiB service
cap in 42.223 seconds. Its launcher supplies 3 GiB, but the old package command
appends 6 GiB. [The failure record](bounded-build-first-failure.json) preserves
both intended and effective settings.

The second build invokes the installed Node/Next CLI directly with an actual
3 GiB heap. It also reaches the combined 4 GiB service cap, in 46.769 seconds.
[Its separate failure record](bounded-build-second-failure.json) does not
attribute a host-wide crash to this service or establish a successful build.
Both services disable swap and use one CPU. Other agents' services stay untouched.

Inspection of installed Next 16.3.8 shows that its webpack worker compiles the
server, edge server and client sequentially. A smaller heap may reduce total
memory by collecting sooner; these failures do not prove that it will suffice.
The debug-memory option can write large heap snapshots, so it is not enabled.
The hosted lane's `next.config.ts` stays unchanged.

## Command controls

[Five command tests](../../../openplan/src/test/build-respects-operator-memory.test.ts)
invoke the actual package build script through npm in a temporary package. A
small executable replaces Next and reports its real V8 heap limit. Tests cover
the absent and empty defaults, an operator's lower heap, complete option
preservation with webpack arguments, and failed compiler exit propagation.
Strict selected-file lint and scoped TypeScript pass.

[The controls](build-memory-controls.json) pass baseline, harmless and restored
runs. Removing the default, overriding the operator, discarding options,
removing webpack and hiding compiler failure each fail at their intended named
assertion. The [runner](verify_build_memory_controls.py) restores original package
bytes in `finally`; its final source hash matches. The 1 GiB control service
peaks at a rounded 163.7M.

These controls prove command behavior. They do not measure webpack capacity,
prove the new production build, or establish browser or release acceptance.

## Earlier reviewed-source CI

[Complete c75 CI](reviewed-c75-full-ci.json) now passes the QA and shuffled
suites. Each records 1,566 passing files, 96 skipped files, 21,622 passing tests
and 1,595 skipped tests. This source precedes the later UI join and build-command
correction. New exact-head CI remains required.
