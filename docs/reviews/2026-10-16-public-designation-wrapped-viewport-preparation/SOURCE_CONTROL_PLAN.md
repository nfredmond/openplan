# Source candidate controls remain prospective

No control runs now. The original `TEST_PLAN.md` remains historical and immutable.
This additive plan binds the drafted tests to the current source choices. ROOT
must grant a later finite test window, including any compiler lock, runner donor,
private caches and one-worker configuration. The prepared CLI-only window does
not authorize that test window.

For each later selected check, record the exact file hash, test-name filter,
argv, baseline, harmless survivor, named wrong change, intended failing assertion,
restored bytes and final result. A comment-only subject change must survive.
The recorder must label that survivor correctly before relying on any kill.
Apply wrong changes individually. Restore exact pinned bytes in a finally path,
verify restoration, then run the same selected final check. Do not use checkout,
reset or a failed import/compile as evidence of the intended behavior failure.

## Helper controls

Select named cases from `wgs84-query-viewport.test.ts`. Candidate mutations:

- `clip-east-at-180`: replace raw camera east with its old clipped value. The
  `[170,-10,190,10]` case must fail on the expected crossing tuple.
- `modulo-before-width`: wrap endpoints before testing width. The `[0,-12,360,34]`
  case must fail on the required full-world tuple and retained latitude band.
- `offset-canonical-longitude`: apply a +180/modulo formula even to canonical
  values. The tiny canonical interval case must fail through collapsed endpoints.
- `remove-absolute-safety-ceiling`: remove only the raw longitude ceiling.
  `unsafe narrow copy` must fail because its safe width does not independently
  reject the out-of-ceiling endpoints. `remove-width-safety-ceiling` separately
  targets `unsafe computed width`, whose individual endpoints remain safe.
- `accept-equivalent-seam-zero`: omit the explicit `[180,s,-180,n]` refusal.
  The equivalent-seam case must fail instead of accepting a full-world alias.
- `blank-coordinate-is-zero`: remove the complete-token blank check. The
  `10,,12,35` and whitespace cases must fail on acceptance of false latitude zero.

Blind category: these tests do not load SDKs, observe camera output, evaluate
PostgreSQL envelopes or prove precision not present in raw floating-point input.

## Component and route controls

For `public-designation-map-viewport.test.tsx`:

- `keep-old-shapes-on-invalid-view`: restore the invalid early return without
  clearing. The prior-source case must fail on nonempty retained source data.
- `world-fallback-on-missing-bounds`: return a world viewport from absent bounds.
  The initial-unavailable case must fail on an unexpected fetch.
- `accept-old-generation`: remove the successful-response generation refusal.
  The deferred-response case must fail when synthetic-stale redraws after an
  unavailable move. A later valid request must still recover in the restored case.

For `land-use-plan-map-viewport-routes.test.ts`, mutate one route at a time:

- `route-uses-old-strict-reader`: restore its old reader. Its wrapped acceptance
  case must fail before the map boundary receives a tuple.
- `route-bypasses-nonempty-parser`: restore direct Number conversion. Its blank
  query case must fail on 200 or on a packet/auth call that should not occur.
- `route-drops-scoped-client`: remove the report loader's scope argument. Its
  exact forwarding assertion must fail. Native RLS is not this assertion's subject.

Blind categories: component boundaries use a mocked SDK/fetch. Routes use mocked
packet, snapshot and data dependencies. Their checks cannot establish real public
packet integrity, installed SQL, grants, RLS, WebGL or human reachability.

## Loader and changed historical expectations

Use the named `designation query viewport loader contract` group in
`land-use-plan-report-map.test.tsx`, plus only the changed historical call and
equivalent-seam refusal cases. Do not replay its whole historical campaign.

- `old-rpc-name`: restore `workspace_gis_features_in_bbox`. Exact one-call
  expectations in the changed historical test and new loader cases must fail.
- `two-window-calls`: introduce a second RPC call. The exact call-count assertion
  must fail; a green tuple-only check would not prove the atomic-call contract.
- `accept-duplicate-id`: omit the duplicate-ID refusal. Its 503 assertion must
  fail while two different IDs with equal geometry still succeed at the cap.
- `accept-short-reply`: omit the complete-count/list comparison. `short reply`
  must fail on drawing a subset instead of returning 503.
- `drop-version-projection-field`: remove `workspace_id`, `feature_hash` or
  `ingest_status` from the version projection. The exact scoped projection must
  fail even if the mock still returns that field.
- `geometry-intersection-density-copy`: restore the old positive intersection
  count wording. The focused above-cap sentinel's complete coverage-note
  assertion must fail. This copy check does not prove the SQL predicate.

Blind category: the fake RPC cannot compute a union, count overlap, reproduce
PostgREST truncation or enforce RLS. Exact one-call assertions establish caller
wiring only. Preserve the source/native distinction in the result ledger.

## SQL structure and native controls stay deferred

After actual CLI generation and a separately granted SQL-authoring window, bind
the new migration guard to that returned path, inspect executable statements
with comments excluded, and add harmless and named-wrong controls. Target missing
western interval, count-after-limit, duplicate-producing joins, altered invoker
or ACL, and missing positive/negative seam terms. Until then, source review of
`QUERY_VIEWPORT_RPC.sql.txt` is review-data evidence only.

Native tests must independently cover zero, cap, cap+1, overlapping multipart
envelopes counted once, equal geometry under distinct IDs, both physical ±180
edges, actual latitude, version/workspace separation, invalid/NaN/infinite/null
input, anon denial, member/nonmember/revoked access and intentional service-role
access. Keep their permission/SQL results distinct from source-pattern kills.

A mutation's failure covers only its named selected assertions. Any remaining
test/table case without an observed intended failure remains unproved. Record
survivors, blind categories and restoration outcomes without aggregate promotion.
The later desktop/390px identified-build journey and actual planner usefulness
remain outside these checks and outside the current grant.
