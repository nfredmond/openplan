# V2 corrects R1 execution composition and R2 health identity

Prepared October 15, 2026 with GPT-6.1 Sol at high reasoning. No delegation.
This packet corrects R1 and R2, both P2, in the unexecuted `f29968d67`
application packet. R2 is also the original assigned F2 health finding. It does not change application code or the health API contract.
A new independent review must finish before the parent executes this packet.
The completed original independent review is
`bcd47064b87306fc742704a742c24ceeb873f25c`. This child reads its complete report,
`nested_probe.py`, `health_probe.py` and evidence, without changing or repeating
that review. The parent joins its historical report separately.

The assigned child checkout fast-forwards locally from clean `05dd3e8da` to exact
`f29968d67c8177f33122691ad5879c675d457e08`, the head of `t3-59122ef0`.
This child owns only this new public directory and this new private 0700 root:

```text
/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2
```

This child never writes the parent checkout `t3-e33fc359`. Its supplied
documentation head is `8a9ede996`; a read-only observation during these tests
finds clean `8bd353469`, with the same application source tree. The app target remains exact
`67828c17c4c270529468eef1edd144e4a52b693a`. No app candidate checkout, build,
startup, service transition, database write, install, push, PR or merge occurs.
Transient resource-limited units run offline fixture tests only.

## Exact producer output now reaches the real consumer

At the pinned app commit, `openplan/src/app/api/health/route.ts` calls the actual
`appCommitSha()` and its local `safeCommitSha()`. The latter trims and returns
`slice(0, 12).toLowerCase()`. The old attestor instead compares that HTTP value
with the full 40-character `APP_HEAD`. Its synthetic startup fixture supplies a
full SHA, so that fixture conceals rejection of the real producer.

The v2 attestor requires exact equality with `APP_HEAD[:12].lower()`, which is
`67828c17c4c2`. It does not accept an arbitrary prefix, a full SHA, another
length, uppercase output, unknown identity or another JSON type. The migration
expectation stays exactly 419 with latest `20261017000016`. Checkout, private
environment, build receipts and process environment still require the full SHA.

[health_producer.cjs](health_producer.cjs) reads the actual route, app-version
helper, migration-manifest helper and package JSON through local `git show` at
exact app `67828c17c`. Installed TypeScript transpiles those actual modules in
memory. Actual GET, `appCommitSha()`, `safeCommitSha()` and `expectedMigrations()`
run. `OPENPLAN_COMMIT_SHA` holds the full SHA and `VERCEL_GIT_COMMIT_SHA` is absent.
The actual payload reports the expected 12 characters, count 419 and latest 16.
A padded uppercase full SHA also exercises actual trimming and lowercase output.

The fixture adapts only NextResponse's response object and the build-time
migration environment. That environment comes from the 419 migration filenames
in the pinned Git tree, following the application's numeric-prefix format.
It does not copy the commit formatting or fabricate the baseline health JSON.
No build file exists because no build runs. This does not prove Next bundling,
HTTP transport or an installed database migration census.

[verify_attestation.py](verify_attestation.py) passes that actual payload to the
real v2 `attest()` function. Commands, service/process observations and HTTP
transport are replaced before consumer operations; the attestor, health identity
comparison and producer functions remain the test subjects. Existing fixture
builders substitute owned filesystem copies. Those substitutions exist only in
the tests, never in installed templates or parent execution.

## V2 preserves every other binding

[template-diff.patch](template-diff.patch) contains the exact runtime-template
diff. The launcher changes only its fixed ROOT path. The attestor changes only
the health commit comparison. Both script basenames remain `app_binding_v1.py`
and `attest_start_v1.py` inside the explicitly versioned v2 root. New hashes bind
those installed copies. A new fixed POSIX runner resolves R1 without changing
the runtime templates beyond the two changes above. There is no runtime patch or selectable path map.
The actual app unit remains
`openplan-current-project-preview-app-678-v1-web.service`.

The [manifest](manifest.json) retains the same app/helper identities, recovery
producer, immutable source anchor, target database and OID, active REST ID,
receipts and operation observation. Endpoints stay API
`http://127.74.19.10:29948` and web `http://127.74.19.10:3585`.
The complete private environment, optional credentials, 419 migration bytes,
dependency graph and donor remain byte-identical to f299. Only installed template
hashes and the resulting binding hash change. No old source anchor is recaptured.

The actual inner bubblewrap constructor still mounts the host read-only,
permits only owned candidate/execution/tmp writes, mounts resolved dependencies
and the environment read-only, hides `/run`, routes HOME/npm cache/logs privately,
disables build networking and retains the original local network for startup.
One-shot checkout/build/start guards and durable exclusive intents remain intact.
The [prepared parent recipe](PARENT_RECIPE.md) now runs the trusted build/start
Python controller directly under systemd and retains the actual inner npm
boundary. Read-only/checkouts/attestation phases keep one outer wrapper.
The actual web service name, ports, budgets, identities and operation order
remain intact. [recipe-diff.patch](recipe-diff.patch) shows the recipe and new
[fixed runner](run_stage_v2.sh). No host/AppArmor/sysctl or permission changes occur.

The runner checks [operation-files.sha256](operation-files.sha256) before systemd.
The manifest independently pins that list and the final runner/recipe bytes.
Direct build/start controllers have ordinary user filesystem/Docker permissions;
they are trusted source-reviewed code, not OS-confined outer controllers. Their
fixed paths and argv limit intended writes to the owned candidate/execution root.
The imported helper functions used here read frozen files, fixed identities,
HTTP state and read-only SQL; their mutator/failure CLI never runs.
The npm payload still receives the kernel-enforced read-only boundary.
The single outer checkout wrapper keeps the source Git object store read-only
while the new local shared clone uses alternates. No checkout occurs here.

[prepare_v2.py](prepare_v2.py) snapshots file hashes, directory/file modes and
symlink text before copying sealed inputs. It inventories old files, not database
content. [audit_v2.py](audit_v2.py) compares both that baseline and the original
frozen pre-transition file baseline. It also checks the exact two allowed
runtime-template transformations and all new installed bindings.

## Controls and limits remain explicit

The [evidence](evidence.json) and [test-unit records](execution.json) retain
named results, mutations, restoration, script hashes and private artifact hashes.
Tests run serially. Synthetic consumer/startup/small/direction/audit units run
in offline bubblewrap namespaces with the host read-only and only the new private
proof root writable. Direct boundary and composed-recipe controllers run under
systemd as trusted test drivers; their real payload children use the actual inner
boundary. Intended driver writes target only new specimens, copies and results.
Build payloads have separate network namespaces; start preserves its parent
namespace, without making network requests or opening listeners. Python/test
controller caps are 512 MiB, zero swap and 50 percent CPU. The single Node fixture
has a 640 MiB heap ceiling within its 512 MiB unit. No expensive tests overlap.
Borrowed dependencies are read-only; HOME/cache/log/tmp paths are new.
No full QA, install, large document, native application or provider job runs.

- The inherited consumer campaign retains all 47 cases, with 43 named refusals
  and four survivors. Its 14 mutations retain one harmless survivor and 13
  detections. The original full HEAD/env/migration/dependency/receipt checks
  still participate, with the same redundant-guard limits documented in f299.
- Startup readback retains the original 16 cases and adds 15 cases, for 31.
  Actual producer old and unknown outputs, wrong 12 characters, full 40,
  seven characters, uppercase, longer prefix, five wrong JSON types, invalid
  build migration metadata, wrong count/latest and a shortened process SHA
  refuse. Nine consumer mutation campaigns include a harmless survivor, the
  old full-SHA comparison, arbitrary-prefix acceptance, omitted migration
  identity and the original five faults.
- The old full-SHA comparison mutation rejects the actual correct payload at
  `identified readback baseline:unexpected:attest-http-identity`. Arbitrary-prefix
  acceptance fails at `full forty characters:accepted-broken-behavior`.
  Removing migration identity accepts the actual producer's null migration
  result and triggers the named test failure. Exact fixture source restoration
  occurs in `finally`; the restored serialized case rows equal baseline.
- The actual producer's harmless comment survives first. Emitting seven
  characters fails `actual route twelve-character contract`; dropping the
  self-hosted fallback fails `full environment identity`. In-memory source
  bytes stay unchanged and the restored producer passes again.
- Seven small controls retain their harmless survivor, three detected faults
  and actual Python cgroup observation. Five real bubblewrap observations
  retain readable specimens, `EROFS` write refusals, owned cache/log/tmp writes,
  a harmless survivor and two detected writable-mount faults. A Python probe
  replaces npm; no write targets actual shared dependencies or real env files.
- The composed campaign executes the final runner through real POSIX shell,
  systemd and actual inner argv/environment constructors for both phases. Its
  26 observations include harmless survivors first, exact restoration, and 20
  named detections. Correct runs reach one child, read three protected specimens,
  receive three `EROFS` refusals through the donor symlink/env/host paths, and
  perform actual private HOME/cache/log/XDG/tmp and owned build-cache writes.
  Network namespace identity confirms build isolation and retained start scope.
  Docker socket paths stay hidden. Wrong mount, HOME, cache, log and health input
  variants fail by name. Restoring the old outer wrapper reproduces the namespace
  refusal before the payload for both phases. Wrong sealed bytes refuse before
  systemd; removing the checksum guard reaches the child and triggers
  `sealed-input-accepted` in the test. The entry command clears the interpreter
  environment before Python loads; a harmless fixture `PYTHONPATH` trap stays
  unloaded. Removing the clean entry triggers `ambient-interpreter-code-loaded`. Derived recipe/subject bytes restore in
  `finally`; fresh restored cases execute successfully for both phases.
- Composition fixture adapters replace only the owned root/unit names, the
  build's large cap with the required 512 MiB fixture cap, a harmless manager
  `PYTHONPATH` fixture injection, and the business
  operation/final npm command with owned Python stand-ins. Startup retains the
  runner's asynchronous request. The driver then observes the actual child
  result; unit-request success is never treated as payload success. The payload
  executes the actual attestor AST statement selected by `attest-http-identity`,
  using actual producer JSON. The separate 31-case suite calls full `attest()`
  with replaced process/I/O boundaries and proves that statement participates.
  The fixture does not execute app readiness, npm, build, checkout or listeners.
- The file audit's harmless read survives. Changed bytes and changed mode in
  a new specimen each change the inventory; exact restoration matches again.
  Known configured secrets/full URI screening permits harmless content and
  detects each known-value injection without publishing any value.

The startup controls do not establish live process identity. File preservation
does not establish logical source/global/Storage preservation. Bubblewrap probes
do not establish actual npm/kernel/cgroup behavior during a large build. Metadata
checks do not hash every dependency JavaScript byte or protect the donor against
another host process. Known-value screening cannot identify unknown secrets.
No desktop/390px/console, login/download, native artifact, practitioner, scientific
or public-readiness acceptance follows from these tests.

The nested direction check retains its existing review reminders. No product
queue, review date, requirement or acceptance status changes. The prior independent
REST report `159de17faf9da881c77c521baabeb817178f01c3` and its F1 filesystem/cache
finding remain historical. V2 retains the f299 boundary correction for that F1.
The completed bcd review independently confirms that F1 at the inner boundary
passes, while R1 fails the documented composition and R2 rejects the real health
format. No duplicate review or second whole-product review runs here.

Retained local failures include the initial outer-to-inner refusal, two limited
namespace probes that also refuse, a direct replay stopped by its preserved
specimen directory, and an initial composed harness assumption that confused the
trusted controller with its inner payload. The corrected harness records that
the controller returns the inner failure while the payload remains unreached.
A later restoration-assertion edit has a syntax failure before any fixture
operation; its source/log are retained, then the corrected source passes the
complete campaign. New specimen/unit names preserve those receipts. No host rule, old packet or
actual service changes to address a fixture failure. Final runners use no added
namespace capabilities or user-ID changes.

The parent receives a clean local commit with this packet, exact template diff,
installed private hashes, offline proof and prepared recipe. Its next step is a
new independent review with the original brief, f299 findings, this correction,
all limits and any unresolved objections, before application execution.
