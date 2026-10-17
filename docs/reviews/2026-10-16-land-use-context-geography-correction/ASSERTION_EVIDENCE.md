# Actual named assertion failures and restored population

These are evidence readbacks from ROOT trial01. They are not new test runs.
The final baseline contains the same 31 distinct file/fullName pairs.
Raw JSON, stdout and stderr remain in the private unit-controls directory.

## harmless-comment-survived

Return code: `0`.

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/harmless-comment-survived.{json,stdout,stderr}`.

## restored-baseline

Return code: `0`.

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/restored-baseline.{json,stdout,stderr}`.

## allow_patch_geography_after_context

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context refuses retained-place conflict {"geographyLabel":"SYNTHETIC replacement"} before any identity or applicability write
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:65:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:65:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context refuses retained-place conflict {"geographyGeojson":{"type":"Polygon","coordinates":[[[10,0],[11,0],[11,1],[10,0]]]}} before any identity or applicability write
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:65:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:65:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context refuses retained-place conflict {"geographyLabel":"SYNTHETIC replacement","geographyGeojson":{"type":"Polygon","coordinates":[[[10,0],[11,0],[11,1],[10,0]]]}} before any identity or applicability write
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:65:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:65:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context requires explicit context save for pre-existing label divergence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:77:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:77:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context requires explicit context save for pre-existing geometry divergence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:77:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:77:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/allow_patch_geography_after_context.{json,stdout,stderr}`.

## check_label_but_ignore_geometry

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context refuses retained-place conflict {"geographyGeojson":{"type":"Polygon","coordinates":[[[10,0],[11,0],[11,1],[10,0]]]}} before any identity or applicability write
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:65:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:65:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/check_label_but_ignore_geometry.{json,stdout,stderr}`.

## allow_patch_repair_of_divergent_context

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context requires explicit context save for pre-existing label divergence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:77:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:77:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context requires explicit context save for pre-existing geometry divergence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:77:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:77:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/allow_patch_repair_of_divergent_context.{json,stdout,stderr}`.

## mask_database_conflict_as_500

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context maps the exact database conflict after a pre-save legacy read and stops applicability
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:143:29`

Exact saved failure message and stack:

```text
AssertionError: expected 500 to be 409 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:143:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/mask_database_conflict_as_500.{json,stdout,stderr}`.

## relabel_generic_database_error

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context does not relabel unrelated database error {"code":"23514","message":"Land-use plan geography must match saved context"} as geography conflict
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:154:29`

Exact saved failure message and stack:

```text
AssertionError: expected 409 to be 500 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:154:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context does not relabel unrelated database error {"code":"PT409","message":"Unrelated database conflict"} as geography conflict
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:154:29`

Exact saved failure message and stack:

```text
AssertionError: expected 409 to be 500 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:154:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context does not relabel unrelated database error {"code":"XX000","message":"PRIVATE database diagnostic"} as geography conflict
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:154:29`

Exact saved failure message and stack:

```text
AssertionError: expected 409 to be 500 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:154:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/relabel_generic_database_error.{json,stdout,stderr}`.

## legacy_absence_on_unreadable_context

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context does not treat missing-column as legacy absence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 503 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context does not treat malformed as legacy absence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 503 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context does not treat normalized as legacy absence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 503 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context does not treat missing-hash as legacy absence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 503 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context does not treat null-with-hash as legacy absence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 503 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context does not treat missing-identity as legacy absence
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 503 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:112:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context fails closed on missing read
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:118:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 404 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:118:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context fails closed on database read
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:118:29`

Exact saved failure message and stack:

```text
AssertionError: expected 200 to be 503 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:118:29
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/legacy_absence_on_unreadable_context.{json,stdout,stderr}`.

## load_context_for_unrelated_patch

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context permits unrelated edits without a context read {"title":"SYNTHETIC title"}
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:101:43`

Exact saved failure message and stack:

```text
AssertionError: expected 503 to be 200 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:101:43
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context permits unrelated edits without a context read {"authorityLabel":"SYNTHETIC joint responsible bodies"}
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:101:43`

Exact saved failure message and stack:

```text
AssertionError: expected 503 to be 200 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:101:43
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context permits unrelated edits without a context read {"applicableRequirementKeys":["locally_defined"]}
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:101:43`

Exact saved failure message and stack:

```text
AssertionError: expected 503 to be 200 // Object.is equality
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:101:43
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/load_context_for_unrelated_patch.{json,stdout,stderr}`.

## wrong_workspace_in_context_read

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context refuses retained-place conflict {"geographyLabel":"SYNTHETIC replacement"} before any identity or applicability write
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:67:21`

Exact saved failure message and stack:

```text
AssertionError: expected [ { table: 'land_use_plans', …(2) } ] to deeply equal [ { table: 'land_use_plans', …(2) } ]
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:67:21
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context refuses retained-place conflict {"geographyGeojson":{"type":"Polygon","coordinates":[[[10,0],[11,0],[11,1],[10,0]]]}} before any identity or applicability write
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:67:21`

Exact saved failure message and stack:

```text
AssertionError: expected [ { table: 'land_use_plans', …(2) } ] to deeply equal [ { table: 'land_use_plans', …(2) } ]
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:67:21
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context refuses retained-place conflict {"geographyLabel":"SYNTHETIC replacement","geographyGeojson":{"type":"Polygon","coordinates":[[[10,0],[11,0],[11,1],[10,0]]]}} before any identity or applicability write
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:67:21`

Exact saved failure message and stack:

```text
AssertionError: expected [ { table: 'land_use_plans', …(2) } ] to deeply equal [ { table: 'land_use_plans', …(2) } ]
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:67:21
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/wrong_workspace_in_context_read.{json,stdout,stderr}`.

## omit_write_workspace_filter

Return code: `1`.

Full name:

```text
PATCH geography agreement with retained plan context permits semantically identical geography and scopes the matched write
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:84:22`

Exact saved failure message and stack:

```text
AssertionError: expected [ { table: 'land_use_plans', …(3) } ] to deeply equal [ { table: 'land_use_plans', …(3) } ]
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:84:22
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Full name:

```text
PATCH geography agreement with retained plan context permits legacy geography changes only after a valid explicit-null context read
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:92:25`

Exact saved failure message and stack:

```text
AssertionError: expected { table: 'land_use_plans', …(3) } to deeply equal { table: 'land_use_plans', …(3) }
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts:92:25
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:20
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/omit_write_workspace_filter.{json,stdout,stderr}`.

## omit_database_geography_invariant

Return code: `1`.

Full name:

```text
land-use geography SQL source intent, not native enforcement attaches an invoker guard to inserts and updates without rewriting history
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts:10:17`

Exact saved failure message and stack:

```text
AssertionError: expected '\nCREATE FUNCTION public.guard_land_u…' to match /CREATE TRIGGER land_use_plan_context_…/
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts:10:17
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:302:11
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:26
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2326:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2323:10)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2305:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2272:10)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2956:64
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/omit_database_geography_invariant.{json,stdout,stderr}`.

## database_ignore_geometry_on_new_context

Return code: `1`.

Full name:

```text
land-use geography SQL source intent, not native enforcement requires exact label and JSON geometry agreement, with fail-closed null predicates
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts:17:17`

Exact saved failure message and stack:

```text
AssertionError: expected '\nCREATE FUNCTION public.guard_land_u…' to contain 'AND NEW.geography_geojson = shape) IS…'
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts:17:17
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:302:11
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:26
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2326:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2323:10)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2305:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2272:10)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2956:64
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/database_ignore_geometry_on_new_context.{json,stdout,stderr}`.

## database_revalidate_unrelated_history

Return code: `1`.

Full name:

```text
land-use geography SQL source intent, not native enforcement keeps no-op history edits separate from context/geography transitions
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts:24:17`

Exact saved failure message and stack:

```text
AssertionError: expected '\nCREATE FUNCTION public.guard_land_u…' to contain 'IF NEW.plan_context IS NOT DISTINCT F…'
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts:24:17
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:302:11
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:26
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2326:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2323:10)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2305:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2272:10)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2956:64
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/database_revalidate_unrelated_history.{json,stdout,stderr}`.

## database_broad_conflict_identifier

Return code: `1`.

Full name:

```text
land-use geography SQL source intent, not native enforcement uses the narrow conflict identifier expected by PATCH
```

Class: `AssertionError`. Actual locations:

- `/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts:33:29`

Exact saved failure message and stack:

```text
AssertionError: expected Set{ 'ERRCODE = \'23514\', MESSAGE =…' } to deeply equal Set{ 'ERRCODE = \'PT409\', MESSAGE =…' }
    at /home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts:33:29
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:302:11
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:26
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2326:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2323:10)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2305:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2272:10)
    at file:///home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/node_modules/@vitest/runner/dist/chunk-artifact.js:2956:64
```

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/database_broad_conflict_identifier.{json,stdout,stderr}`.

## final-restored-baseline

Return code: `0`.

Raw trial files: `/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016/unit-controls/final-restored-baseline.{json,stdout,stderr}`.

## First harmless inventory

Exact saved file/fullName population:

```json
[
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not relabel unrelated database error {\"code\":\"23514\",\"message\":\"Land-use plan geography must match saved context\"} as geography conflict"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not relabel unrelated database error {\"code\":\"PT409\",\"message\":\"Unrelated database conflict\"} as geography conflict"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not relabel unrelated database error {\"code\":\"XX000\",\"message\":\"PRIVATE database diagnostic\"} as geography conflict"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not treat malformed as legacy absence"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not treat missing-column as legacy absence"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not treat missing-hash as legacy absence"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not treat missing-identity as legacy absence"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not treat normalized as legacy absence"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context does not treat null-with-hash as legacy absence"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context fails closed on database read"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context fails closed on missing read"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context maps the exact database conflict after a pre-save legacy read and stops applicability"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context permits legacy geography changes only after a valid explicit-null context read"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context permits semantically identical geography and scopes the matched write"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context permits unrelated edits without a context read {\"applicableRequirementKeys\":[\"locally_defined\"]}"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context permits unrelated edits without a context read {\"authorityLabel\":\"SYNTHETIC joint responsible bodies\"}"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context permits unrelated edits without a context read {\"title\":\"SYNTHETIC title\"}"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context preserves access refusal before context reads or writes"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context refuses changed context scope current_working_version_id"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context refuses changed context scope descriptor_id"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context refuses changed context scope plan_kind_key"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context refuses retained-place conflict {\"geographyGeojson\":{\"type\":\"Polygon\",\"coordinates\":[[[10,0],[11,0],[11,1],[10,0]]]}} before any identity or applicability write"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context refuses retained-place conflict {\"geographyLabel\":\"SYNTHETIC replacement\",\"geographyGeojson\":{\"type\":\"Polygon\",\"coordinates\":[[[10,0],[11,0],[11,1],[10,0]]]}} before any identity or applicability write"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context refuses retained-place conflict {\"geographyLabel\":\"SYNTHETIC replacement\"} before any identity or applicability write"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context refuses without a working version before reading context"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context requires explicit context save for pre-existing geometry divergence"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-patch.test.ts",
    "PATCH geography agreement with retained plan context requires explicit context save for pre-existing label divergence"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts",
    "land-use geography SQL source intent, not native enforcement attaches an invoker guard to inserts and updates without rewriting history"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts",
    "land-use geography SQL source intent, not native enforcement keeps no-op history edits separate from context/geography transitions"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts",
    "land-use geography SQL source intent, not native enforcement requires exact label and JSON geometry agreement, with fail-closed null predicates"
  ],
  [
    "/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan/src/test/land-use-plan-geography-source.test.ts",
    "land-use geography SQL source intent, not native enforcement uses the narrow conflict identifier expected by PATCH"
  ]
]
```
