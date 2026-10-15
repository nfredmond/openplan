# The isolated preview passes database and readiness checks

This record covers actual parent-operated V6 stages on October 15, 2026.
The application remains exact `49e3fa2004c1336ffa36c134a8f21bcc2d72d327`,
an unreleased local candidate. It does not establish a release or v1 acceptance.

The parent reads and accepts independent ROUND3
`2802a23641cfe92eebe2df4868a3fc94ae7aa30e` at its source/fixture boundary,
with no P1/P2 finding. It joins as `1acca979b`. Parent readback checks 148
bindings and the saved 48 observations, comprising three survivors, 40 refusals
and five detected code faults. The parent does not rerun those controls.
The readback receipt has SHA-256
`e4871299d17025fa0be379698a87758d09487e90658dee23728256ed13e55145`.
Review acceptance permits operating checks; it does not establish their results.

## Preflight passes against current protected state

One preflight invocation, `f1f84099c6cf40e7b55faa007a3d792a`, exits zero in
31.465 seconds. It checks the original source fingerprint, fixed dump, protected
files, old Storage, four typed active helpers, two protected databases, old web
identity and proposed names/ports. The saved baseline and readiness precede the
next stage. Private `preflight-result.json` has SHA-256
`6533e6bd1835960a359af160cef7616bb959bf737baaf26cde446fbac9b05190`.

The parent first expects retained final unit properties, but the user manager
has already collected the unit. That readback assertion fails and is retained.
It is not an operating failure or a reason to rerun preflight. Saved launch
output, domain receipts and journal evidence supply the corrected readback.
An in-flight read observes a 512 MiB controller cap, zero swap allowance and
241,246,208-byte peak at that instant. The final launch summary reports rounded
230M peak and 0B swap. Final unit properties and memory-event counters are
unavailable and are not inferred.

## The new target restores the retained 419 baseline

One restore invocation, `bec20c3d086e44a8868684dd3663aef2`, exits zero in
75.778 seconds. It creates only:

```text
openplan_project_portfolio_preview_8f43260b95a071cc4e6d2b90
OID 6150036, owner postgres
```

Restore consumes the fixed 16,232,305-byte dump, SHA-256
`181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398`.
No fresh source dump or source fingerprint capture occurs. The original table,
history, sequence and property projection and copied Storage inventory match
before `clone-ready.json` publishes. That receipt has SHA-256
`1e59ff6e41e7899ef52d5ac7f6bfc09d59bdf928cf3b092ade220381b5d3fa54`.

An independent parent read-only query confirms the exact target/OID/owner,
419 migrations through `20261017000016`, eight fixture projects, zero portfolio
import batches and zero import audit rows. Counts match the retained source.
Private `restore-result.json` has SHA-256
`5fe4bdc84fed918f6e8c57b4f7033f11e0c9ee46d6f74d33ef4bf647c680079d`.
The launch summary reports rounded 339.3M peak and 0B swap. The controller requests
512 MiB and zero swap. No final memory-event counters are captured. The existing
PostgreSQL server remains uncapped; this is not a server memory-budget claim.

## Upgrade passes with actual PostgreSQL normalization

One upgrade invocation, `77a66d9f06a94bd7b2cadeb58f5686e5`, exits zero in
81.336 seconds. Only the new target receives candidate 17 and its history row.
The stage checks all 420 versions, original 419 history rows, exact function
body, stored candidate SQL and both complete fixed CHECK definitions. Actual
PostgreSQL normalization matches the independently sealed expectations. Existing
non-history data and sequences and the protected old state match afterward.

The parent separately reads the target's current 420/latest-17 census, function
body digest, original history digest, candidate statement digest and both complete
constraint definitions. These match. `upgrade-ready.json` has SHA-256
`a8062749a5f4e031d356d051be8c2384f2e0ac51e72638d34bfd6d05ed8d9930`;
private `upgrade-result.json` has SHA-256
`c83b617fdcd677f9e915f72a6d3a59aff8a8e9cbef61fdb6ef85e564b94f6f40`.
The launch summary reports rounded 92.9M peak and 0B swap. Final memory-event
counters are not captured.

## Startup failure remains distinct from later readiness

The services stage exits 1 in 33.144 seconds, invocation
`12b668cf796b4dacbb9b26b058318e7b`, with `ConnectionResetError`. It has already
created and started all four new helpers and retained their exact IDs. The
failure and reserved request remain. No helper is recreated, restarted or stopped.

Fresh read-only inspections find all four running, unpaused, non-restarting and
not OOM-killed, with restart count zero. Auth, REST and Storage return 200, and
the gateway returns the new expected CORS origin. Startup timing is a plausible
cause of the first reset, but that request's endpoint and exact timestamp are
not retained. The cause is not established. Private `services-result.json` has
SHA-256 `b2d39f7c0ffb9e76aac64ffc8f13bde8adf7e4beffe2f8dba78e290734de6cb7`.
The original stage remains a failure, not a retrospective pass.

The parent inspects that partial state and runs the already-reviewed read-only
`active-check` stage once. It exits zero in 31.480 seconds, invocation
`a84467c409e348429a217ce2b144b690`. This reacquires effective helper configuration,
HTTP/CORS readiness, upgraded schema, source and old protected state. The real
wrapped entrypoint also reaches the fixed V6 host observer, which identifies
the original old web invocation and listener PID. Its nonce-bound caller and
transport receipts match, as do the actual observer resource checks. Controller
memory-event counters remain unavailable. Private `active-check-result.json`
has SHA-256 `62adc2a3d5c5adda5a1fe3600343a81ebbd826cdfa219befe3a3b122f027aa52`.

The separate successful acquisition supports continuation without retrying the
services mutator.

## Checkout passes and one fresh build is running

One checkout invocation, `86c310ef51304efb9e54a378085e542d`, exits zero in
69.516 seconds. The new private repository is clean at exact APP49. All 420
migration files match, the environment bytes match their seal, and the dependency
symlink resolves to the fixed donor. No `.next` output exists before build.
`checkout-ready.json` has SHA-256
`af59977bf8745c263afb41809f19eba9449df5c46bd9036727a88d8622c01309`;
private `checkout-result.json` has SHA-256
`6f90317f29bdd1a55958d60e2f194bf00b4d2da355308849ea6563f790280aee`.
The checkout summary reports rounded 512M peak and 0B swap. No final memory-event
counters are captured; exit zero is not a zero-pressure claim.

Before build, the parent observes 17,236,426,752 bytes of available memory and
11,292,024,832 bytes of free disk. One fresh build then starts as invocation
`382d4e9515014dc393e79e8f3d0046e3`. The reviewed controller requests 10 GiB,
zero swap, CPU 50 percent and a 6 GiB Node heap. npm uses the original inner
wrapper, read-only host/dependencies, private caches and no build network.
No old build output is copied.

The build result is pending at this checkpoint. One Sol-high child observes
only that running unit and its saved receipts. It cannot start another build,
compiler, service or browser. Root must read the actual terminal result and
accepted domain receipts before startup. No new BUILD_ID or build pass is claimed.

Private evidence sits under
`portfolio-skip-preview-v6-parent-operation-20261015` and the sealed V6 packet.
The old 215/419 preview, retained native 419 proof, source anchor and demo receive
no mutation from these operations. Fresh application build/runtime, corrected
desktop/390px import, console/artifacts and final preservation remain pending. No hosted migration,
provider setting, pull request, main merge or release occurs here.
