# A0b/T1 preserves exact CLI acceptance in one dated registry

This implementation starts from `607ee0895a79457181eda1d2ebbda1de4f2a4d40`
on the separate `t3/a0-tested-cli-version-registry` branch. It changes only the
three connector launchers, new registry files, one focused Node test file and
this review directory. Parent-owned application, schema and preview work stays
outside this lane. This is a local implementation candidate for root review,
not full T1, A0 or v1 acceptance.

## The registry preserves three existing contracts

The real launchers now read `tested-cli-versions.json` through
`tested-cli-versions.mjs`. Their exported protocol version constants still return
Codex `0.154.0`, Claude Code `2.1.263` and OpenCode `1.18.30`. Version discovery
still uses the existing timeout, environment and exact trimmed stdout contract.
All other versions refuse before profile access. Codex still requires a resolved
binary inside a `bin` directory. No protocol, sandbox, permission, credential
mount, account mode or provider fallback changes.

The manifest records an October 16 registry review, not an October 16 native
acceptance. Each entry separately identifies a hashed synthetic fixture source,
a hashed historical installed-CLI report, live-provider evidence and limits.
`observedAt: null` leaves the exact native observation timestamp unknown.
`recordedNativeFrames: "unknown"` leaves recording provenance unresolved.
Scripted fixtures are not described as recordings of live providers.

Existing evidence remains at its original level:

- [Codex report](../2026-09-10-planner-agent-provider-connection/VERIFICATION.md)
  records actual installed CLI/local-fixture tests and a separate real
  ChatGPT-account answer journey. Its live-provider status is a historical
  report, not a current account or availability check. The referenced
  `codex-native-isolation.test.mjs` supplies synthetic local Responses data.
- [Claude report](../2026-09-10-claude-native-spike/VERIFICATION.md) records the
  installed CLI with synthetic OAuth and a scripted Messages server. It
  explicitly excludes live Claude generation. The referenced
  `claude-native-isolation.test.mjs` retains that synthetic fixture source.
- [OpenCode report](../2026-09-10-opencode-native-spike/VERIFICATION.md) records
  installed-executable generation with synthetic API credentials and local
  scripted Responses data. It excludes real provider use. The referenced
  `opencode-native-filesystem.test.mjs` is a separate physical filesystem
  canary source, not a recorded generation trace. The generation report and
  physical fixture source do not establish recorded native-frame provenance.

Missing recording proof does not silently disable these previously accepted
versions. The manifest calls their acceptance `preserved-exact-version` and their
native evidence `historical-report`. It grants no new readiness claim.

## Parser checks cannot admit a copied proof record

The parser bounds input size, requires the exact schema and three distinct
providers, validates version/output formats and evidence-reference shapes, and
rejects unknown acceptance, invented native dates and recording claims. Parsed
records are deeply frozen. A source-controlled SHA256 pin binds the complete
reviewed manifest bytes. It also rejects duplicate JSON properties, crossed
provider references and a new version with copied proof.

Updating the manifest requires an intentional code review of its evidence and
pin. A discovery or health probe cannot update it. The pin is a reviewed
snapshot boundary. It does not authenticate historical claims, protect against
a local owner changing both code and evidence, or establish current provider
behavior. Runtime loading requires the two new registry files beside the
launchers. Historical documents need not be distributed with the connector;
the repository tests check their exact bytes separately.

## Focused checks pass with mutation controls

All checks use Node builtins, Node 24.22.0, a 1024 MiB heap and one test
concurrency under
`/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock`.
The checkout has no application `node_modules`; none were installed or borrowed.
The direction check passes with its existing review/version reminders.

The new file passes eight tests. Combined with the three existing launcher
files, the focused run passes 73 tests with zero failures and zero skips.
Synthetic executable stubs report version text. Tests construct launch
descriptors but do not execute bubblewrap or provider binaries. A separate child
mocks only the registry seam to prove each real launcher calls it with the right
provider and discovered output. Real parser and refusal tests cover that seam
independently. Retaining an old hardcoded version check fails the wiring test.

[Controls](controls.json) records five harmless survivors and 39 targeted
failures. [The driver](verify-controls.mjs) restores exact source bytes in
`finally`, verifies their SHA256 hashes and reruns the eight tests afterward.
It requires the intended named test to fail through an assertion; import errors,
process timeouts and unrelated failures do not qualify as killed mutations.
Controls cover malformed/duplicate/wrong-provider records, proof tiers, native
dates, reference paths/hashes, manifest integrity, immutable records, exact
version refusal, evidence-byte binding and each launcher's registry call.

Three earlier campaigns remain failed evidence. The first size-bound mutation
survived because invalid JSON still failed elsewhere. The second version-format
mutation survived because the unchanged output format still rejected it. A
third campaign exposed the same overlap between live-status and report-null
checks. Tests now send oversized valid JSON, a matching invalid version/output
pair and an invalid live status with a null report. The final campaign catches
all three for the intended assertion. These corrections change tests, not
acceptance criteria.

Run the controls from the repository root:

```bash
umask 077
flock /home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock \
  env NODE_OPTIONS=--max-old-space-size=1024 \
  TMPDIR=/home/nathaniel/.local/state/openplan/a0-tested-cli-version-registry-20261016/tmp \
  node docs/reviews/2026-10-16-a0-tested-cli-version-registry/verify-controls.mjs
```

Private logs and synthetic scratch files stay under
`/home/nathaniel/.local/state/openplan/a0-tested-cli-version-registry-20261016`.
Final successful controls are in `campaign-wxhgw8`; the focused regression log
is `focused-launchers.log`. Directories are private. Executable synthetic stubs
need owner execute permission while tests run; retained regular artifacts have
mode 0600 after collection. No histories, credentials or account fields are
captured. Disk was about 1.3 GB free at entry. No large copies or downloads run.

## T1 still needs separate acceptance

The parser proves the reviewed static compatibility boundary and its diagnostics.
It cannot establish that historical native reports are accurate or that a
provider still behaves the same. The hash check detects changed source bytes;
it cannot establish that scripted content originated from a native recording.
The launcher tests prove construction and pre-profile refusal. They cannot
establish actual mount isolation, authentication, native generation or browser
behavior.

Recorded native-frame provenance and replay through the real adapter remain
unresolved. No new installed-CLI acceptance runs here. Recording with Nathaniel's
account allowance requires his consent and remains unauthorized. Usage-limited
state, reported versus unreported reset times, no automatic retry, installer-owned
update guidance, desktop/390px journeys and current native acceptance remain
root integration and later T1 work. This candidate changes no UI or usage-state
behavior. No service, database, migration, cloud, account, install, update,
push, PR, main merge or release operation occurs.
