# Full project compiler passes after two bounded repairs

The unchanged full-project TypeScript command exits zero at
`21510042e94bcaf80f262205ad156a7bb639e35c`. The compiler emits no diagnostics.
This resolves the seven type errors exposed by the failed application build.
It does not establish a successful production build or a running application.

## Changes and retained controls

The parent reads and joins two isolated repairs:

- [Project row repair](../2026-10-15-project-row-jurisdiction-type-repair/README.md)
  adds required `jurisdiction_context: unknown` to the selected row type. The
  existing query already selects this nullable JSON field. The editor retains
  responsibility for validating it. Two complete typed fixtures add null, and
  four page cases exercise raw context and the selected projection. Production
  JavaScript from the type module remains byte-identical.
- [Report test repair](../2026-10-15-report-jurisdiction-test-type-repair/STATUS.md)
  asserts metadata presence and source-context shape before reading readiness.
  The captured payload remains optional and unknown until those assertions.
  Existing canonical values, hashes, actor exclusion, HTML, bundle JSON and
  GeoPackage comparisons remain. Production report code does not change.

The row repair reports 121 focused passing cases. Its harmless control survives;
removing the field reproduces TS2339, and broken context wiring or projection
fails named page assertions. The report repair reports 72 passing cases. Its
harmless control survives compiler and runtime checks; the original unsafe
accesses reproduce six compiler diagnostics. Seven mutations of the actual
route's inserted metadata fail the intended runtime assertions. Both reports
retain rejected setup attempts and exact source restoration. Their scoped
compiler checks are distinct from the full-project result below.

## Full compiler result and resource failure

Both attempts run from the actual application package with the same source,
unchanged tsconfig and this command:

```text
node node_modules/typescript/bin/tsc --project tsconfig.json --noEmit --incremental false --pretty false
```

The host, source and borrowed dependency tree are mounted read-only. A private
proof directory and temporary filesystem receive writes. The network is isolated.
The shared compiler-repair flock serializes these commands with child checks.
The configuration retains all implementation and test roots. No source-specific
diagnostic filter, new exclusion or type suppression supplies the result.

| Attempt | Node heap | Memory cap | Exit | Elapsed seconds | Peak bytes | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | 4 GiB | 6 GiB | 134 | 116.831 | 4,615,688,192 | V8 heap exhaustion, no compiler verdict |
| 02 | 6 GiB | 8 GiB | 0 | 92.595 | 5,874,405,376 | Empty compiler log |

Both cgroups prohibit swap. Their retained counters show no kernel OOM or
OOM-kill events. Attempt 01's compiler log contains Node's heap-exhaustion
diagnostic and `OOMErrorHandler`; its failed result remains intact. Increasing
the heap changes the resource envelope, not the compiler's source scope.
Attempt 02 records the same exact HEAD and clean status before and after.

The compiler includes 446 hashed declaration inputs, including `next-env.d.ts`,
copied read-only from the retained failed build's generated Next types. The
application route-path inventory is unchanged. Generated imports resolve
relatively into the corrected source. The old absolute path in generated
comments does not select another source tree. Parent readback confirms all
copied declaration hashes still match. No compiled JavaScript, build cache,
accepted build inventory or build identity is copied into this checkout.

[Evidence](evidence.json) retains the actual commands, both result objects,
resource counters and proof-file hashes. Private proof directories are
`project-combined-full-types-20261015-01` and
`project-combined-full-types-20261015-02` under
`/home/nathaniel/.local/state/openplan/`.

## Remaining operation and acceptance

The failed v2 application checkout, partial output, intents and receipts remain
frozen. They have no accepted build result. A separate v3 packet binds application
source to exact `21510042e94bcaf80f262205ad156a7bb639e35c`, with fresh fixed unit
names. Its mechanical preparation and independent review precede any new
checkout, build, application start or attestation.

TypeScript checks assignability, not runtime correctness, query enforcement,
native downloaded artifacts, browser rendering, legal applicability, scientific
validity or practitioner acceptance. This run adds no database, hosted, provider,
migration, main-merge or release acceptance. The earlier frozen 06a full QA and
exact ced6 main-delivery records retain their own source boundaries.
