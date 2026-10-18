# Exact finite window request, ungranted

October 16, 2026 local time. This request supersedes earlier timing/configuration
proposals in STATUS. Root's migration-generation window is released. Its scope
does not authorize this window. No import, dependency command, test, compiler,
lint, direction, manager, lock or native operation runs during this preparation.

## Requested bounds and fixed steps

Request one window with maximum 360 seconds, 1 GiB memory, zero swap, CPU 50
percent and 64 tasks. Root owns exactly one nonblocking exclusive compiler lock
at `/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock`.
The child contains no second lock or resource-manager invocation.

Prepared private controller `window-controls.py` has a 340-second aggregate
deadline. The focused campaign has a 230-second inner deadline, at most 35
seconds per Vitest invocation, and a 240-second outer phase cap. These leave
restoration time before the resource-manager limit. The exact serial phases are:

1. `python3 -B classifier-controls.py`, maximum five seconds. Twelve supplied
   report evaluations include a harmless comment survivor, restored and named-only
   controls, ordinary mixed-TypeError refusal, suite-import-error plus named
   AssertionError refusal, unexpected name, wrong file, empty suite and renamed
   inventory refusals, and two deliberate in-memory broken guards. Expected
   refusal class/message and the wrong-behavior AssertionError traceback are
   retained. This does not replay an old suite.
2. `python3 -B focused-controls.py --node /usr/bin/node --vitest
   <app>/node_modules/vitest/vitest.mjs --config <private>/vitest.focused.mjs
   --authorized-window root-allocated-finite-unit-window`. It runs the same 31
   distinct cases across harmless-first, restored baseline, 13 named faults and
   final restored baseline. There are at most 16 Vitest invocations, not 16
   independent test populations. Each invocation retains JSON and full raw
   stdout/stderr. Fault acceptance requires the exact baseline name mapping,
   AssertionError class, full message and actual stack/location. Every mutated
   byte/mode is restored, with a second outer finally restoration.
3. `/usr/bin/node <app>/node_modules/typescript/bin/tsc --project
   <private>/tsconfig.focused.json`, maximum 60 seconds. Roots are the route and
   two new tests with their actual transitive imports. No full-tree type claim.
   No emit or incremental file writes.
4. `/usr/bin/node <app>/node_modules/eslint/bin/eslint.js --no-cache
   --max-warnings 0` followed by exactly the route and two new test paths,
   maximum 25 seconds. It uses the repository ESLint configuration.
5. `/usr/bin/npm run product:direction:check` from the assigned nested app,
   maximum 10 seconds. This is an actual future direction run, separate from
   root's already supplied earlier result. Preserve any reminders or failure.

Each phase is clipped to the remaining aggregate deadline. Any setup, source,
report, timeout or unexpected harness failure stops later phases without retry.
No cap increases, skipped requirements or successor grant follow a failure.
There are no timing measurements for this campaign yet, so completion within
these caps is unknown. A timeout is retained failure, not a reduced acceptance
scope. Root may change the proposed caps before granting the exact window.

## Exact layout before the first dependency process

Private root is
`/home/nathaniel/.local/state/openplan/land-use-context-geography-correction-20261016`.
App remains the assigned path
`/home/nathaniel/.t3/worktrees/openplan/t3-532d34c8/openplan`.
The sole donor is
`/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules`.
No install, copy from another donor, resolver/network fallback or tool upgrade.

Root prepares only the empty app `node_modules` mountpoint if absent, then
constructs the final namespace before the first dependency command. Bind the
host root and old evidence read-only, then this new private root writable. Bind
the donor read-only at the app's node_modules path. Bind only the two prepared
private owned-overlay files onto the route and newly allocated migration paths.
The actual host source/test files stay read-only. The original historical draft
also stays read-only. Tests and all other source need no mutation write access.
Private copies hold all intentional mutations and finally restoration writes.

The controller refuses before any subject write unless the two source paths are
the exact same files as their private overlays, the dependency alias matches the
selected donor, the source directory/donor/alias mounts are read-only, and the
network namespace differs from captured host `net:[4026531833]`. These named
checks do not establish a host-wide absence of writable inherited submounts.

Use unshared network and PID namespaces, proc inside that namespace, empty /run,
private /tmp, no Docker/database socket mount, and a final devnull-only dev-bind
before the private `env -i`. No broad /dev bind. Do not read host credentials or
inherit provider, database or npm authentication variables. Use private HOME,
TMPDIR, XDG cache/config/runtime, npm cache/logs and empty npm user config.
Suggested fixed environment includes PATH=/usr/bin:/bin, LANG/LC_ALL=C.UTF-8,
PYTHONDONTWRITEBYTECODE=1, NODE_ENV=test, NODE_OPTIONS=--max-old-space-size=512,
CI=1, NO_COLOR=1, FORCE_COLOR=0, VITEST_MAX_WORKERS=1,
NEXT_TELEMETRY_DISABLED=1 and npm offline/update-notifier/audit/fund controls.
RLS opt-in variables remain unset. The prepared Vitest config now sets envDir to
the new empty private `vitest-empty-env-20261016` directory, mode 0700. Its
source-preparation listing records zero entries. Root must retain that directory
empty at launch; it may bind that empty directory read-only inside the otherwise
writable private root. This directs Vite environment discovery away from the
application directory. Actual Vite/Vitest loading remains unexecuted here.
Root should mask any app environment/credential files in the namespace without
reading their values. The resource manager, lock and namespace precede
`/usr/bin/python3 -B <private>/window-controls.py`.

No manager/namespace/lock invocation is dispatched by this preparation. Root
must seal its actual final outer argv and any filesystem-only mountpoint setup
before issuing the separate exact grant. The inner controller's argument arrays
are concrete in its pinned source. If the layout cannot be constructed, stop.

## Reporter closure and exact finite oracles

Source reading of installed Vitest 4.1.11 JSON reporter confirms file-level
`message`, assertion arrays/fullName and optional assertion location. It does
not emit `numRuntimeErrorTestSuites`. Root's retained old JSON schema has the
same omitted key. No old suite is replayed. That missing key is not proof that
runtime errors are absent.

The new reader requires exactly the two absolute expected test-file identities,
nonempty assertion arrays, explicit empty suite messages, no suite error(s),
31 distinct `(file, fullName)` identities, only passed/failed assertion states,
and aggregate counts/success consistent with those assertions. The first
harmless report supplies the actual complete name inventory. Every later report
must match it exactly. Each intended stem resolves only to names in the expected
file from that inventory. Supplemental stems explicitly include collateral
assertions protecting the same behavior. No unexpected failed name is allowed.
Every failed assertion must carry only AssertionError messages and a real
reported location or a file/line/column in its actual stack. Full stderr still
requires review; finite JSON metadata cannot prove absence of every global
unhandled error. Unknown or mixed reasons refuse rather than becoming kills.

Private `vitest.focused.mjs` uses the explicit empty private envDir, actual repository setup.ts, globals,
jsdom, dialog shim, one worker and private Vite cache. It does not replace setup
with empty/custom matchers or import a second matcher implementation. The
`SETUP_CLOSURE.sha256` manifest pins 372 files: setup.ts and shim plus the entire
installed jest-dom package and its direct/transitive matcher dependencies,
including nested dom-accessibility-api. Both CJS/ESM variants are retained.
This finite closure does not claim every Vitest/jsdom/toolchain dependency is
hashed. The final donor is read-only from the first dependency command.

`SUBJECT_PINS.sha256` and `SUBJECT_MODES.txt` bind the source/test/fixture/draft,
new production migration and focused harness. `WINDOW_PINS.sha256` binds the
private classifier/controller/configurations, overlays, selected tool entry
points, setup-closure manifest and tool package manifests. The controller checks
all three byte manifests and subject modes before starting the first phase.
Nothing in a manifest grants runtime permission.

The pre-envDir config and affected source-preparation manifests/documents are
preserved byte-for-byte under private `envdir-preparation-before`. Only envDir
is added to the config. No production, test, fixture, assertion, type config,
classifier or controller source changes accompany this correction.

## Evidence limits and landing hold

The two focused test files are mocked PATCH behavior and inert SQL source intent.
They cannot establish SQL parsing, installation, trigger permissions, RLS,
direct-writer behavior, save/PATCH serialization, frozen A/fork/save B custody,
browser recovery, desktop/390px usability, exports or human acceptance. The
SQL fixtures remain future native oracles on a new exclusive root-allocated
target. Canonical three, A0, budget, source and demo databases remain untouched.
No clean implementation commit precedes the applicable focused checks. Root's
fresh independent final review still precedes a join. No push, PR, main,
release, hosted, provider or paid action is included.
