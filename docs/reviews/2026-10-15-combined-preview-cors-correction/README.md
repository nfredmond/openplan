# F1 correction accepts Kong's restricted fixed-origin response

Prepared October 15, 2026 using GPT-6.1 Sol at high reasoning, without delegation.
This packet corrects the local preview launcher's F1 health assertion. It does
not establish operational readiness or approve execution. The parent owns the
fresh bounded independent review, combined QA and subsequent operational work.

## Finding and correction

The independent report at commit
`93b2aa1fe01df1960dd311a2b51527ce28058eef` identifies one concrete finding.
It reviews preparation `c636b7eecbd66970217421da7bead960f262323b` under
`docs/reviews/2026-10-15-combined-preview-configured/`. Its exact report SHA-256
is `8b09679ae8a59fc04e00be4360cc44ec124766d592d886eb89291794e1c0617a`.
The report remains in the reviewer's checkout at
`/home/nathaniel/.t3/worktrees/openplan/t3-43740634`.

Pinned Kong 2.8.1 returns the single configured literal origin even when a
different origin requests access. The earlier oracle requires an absent header
for that request. It therefore refuses a correctly restricted response as
`health:oldOrigin`. This blocks service verification, build and start. F1 is a
local harness correctness blocker, not an observed product access-control breach.

The new `policy.health()` requires integer 200 responses for Auth, REST and
Storage, and the exact configured web origin for `ownOrigin`. It accepts
`oldOrigin` only when the header is absent or equals that configured web origin.
It refuses reflected old origins, wildcard, unrecognized origins, empty values,
the literal `null`, origin lists and altered origin spellings. Missing observation
fields also refuse. `launcher.health()` calls this policy after acquiring all
five responses. The configured Kong origin list stays exactly `[WEB]`.

The exact original `c636` health function reproduces F1 against the synthetic
fixed-origin response. The corrected function accepts it. No earlier gateway,
origin list, helper, application guard or database setting changes.

## Packet identities and custody

The assigned tree starts clean at `05dd3e8da`, fetches `origin/main`, and
fast-forwards only its branch to `4ea6a8ca3b43c6712952fc4e527a8538237a9adb`.
The direction check succeeds there. It retains expired registry/matrix dates,
the review-version difference and intervening-change reminders. No direction
record is redated. Active-thread inspection identifies the parent and prior
reviews; this work uses its separately assigned checkout and no browser.

Ownership is limited to this public directory and this new private packet:

```text
/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-combined-preview-cors-20261015
```

Public templates begin as exact git-object copies from `c636`. Changes consist
of the health policy/caller, acquisition controls, a mutation driver, the new
private purpose/root and the local repository path for future detached checkout.
The complete hashes appear in [preparation.json](preparation.json).

The app candidate stays `b4dbcac21a58f61bd480ccade4dec69383dacbc7`.
The retained source stays
`openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up`, in exact cluster
container `a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`.
It has 419 migrations through `20261017000016`.
The fresh planned target is
`openplan_project_combined_preview_44eed2f8f58a9c7623c1e7e0`.
It does not exist at the read-only absence observation.

The API stays `http://127.74.19.10:29948` and the web origin stays
`http://127.74.19.10:3585`. Both bind probes succeed; they do not reserve ports.
Only one packet may use these ports. The new packet supersedes the configured
packet for proposed execution, without modifying it. Fresh helper names appear
in the manifest; none exists at the absence observation. No candidate checkout,
dump or operational intent exists in the new private directory.

The private binding manifest SHA-256 is
`7bce46a41838b4d70f07d11c1ad917307f9e58e87fdeb3d267d2e19d4ae53ccc`.
The template binding manifest SHA-256 is
`e57630ebb36e6da1232f9a87a2c92a1a458a87bfe1d783ed9aa44dd59b64cdaa`.
The original logical source fingerprint remains
`82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547`.
There is no capture phase or source rebaseline.

Private preparation copies the bound inputs from the configured packet. It
changes only the new target, helper identities, root and fresh local JWT/API
material in executable configuration. The ACL text changes only its target
database name. Engine role connection credentials remain identical. The new
local token signatures, roles, future expiry and difference from prior tokens
are checked without printing values. Historical provenance copies remain
historical; the new private provenance records this preparation separately.

The fixed configuration source remains
`/home/nathaniel/.local/state/openplan/project-map-integration-20261015/openplan/.env.local`.
Its entire byte hash and the three retained values are unchanged:
`CENSUS_API_KEY`, `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` and
`OPENPLAN_INTEGRATION_KEY_SECRET`. Their binding file is byte-identical to the
prior packet. No value appears here. GTFS managed ingestion remains `0`; AI
and email credentials remain absent. No provider or spend is added.

The new directory is 0700 and private files are 0600, with no Python bytecode
cache. Inventories confirm byte/mode equality for every recorded file in both
earlier private packets and the configured and independent public report
directories. Read-only preflight also compares retained source state, roles,
settings, earlier helper configuration and Storage bytes against existing
bindings. These comparisons cover observation times, not concurrent or transient
activity. The parent QA checkout and canonical checkout receive no edits.

## Controls expose the earlier blind spot

[historical-controls.json](historical-controls.json) is the exact public control
summary from `c636`: 567 observations, 474 refusals and 93 survivors. Rerunning
its exact control source while `health()` always refuses still produces the
same 567 rows. That proves the acquisition blind spot. It does not prove health.

The new [control summary](controls.json) records 607 observations: 508 intended
refusals and 99 survivors. Forty new observations call the real `health()` with
synthetic HTTP responses. They cover all three health status fields, the exact
own header, fixed configured and absent old headers, old reflection, wildcard
and unrecognized values. They assert all five actual Request URLs, methods,
headers, timeout and response context entries/exits. They inspect proxy removal
and redirect refusal. Three observations also call real `verify_services()`
with its unrelated file/container acquisition replaced.

The first 567 serialized result rows equal the historical rows. **Their meaning
is not wholly unchanged.** Seventeen health rows now call `policy.health()`;
they formerly called a None-only typed comparator. The other 550 checks retain
their meaning. The 40 added rows comprise 34 refusals and six survivors. An
identical row label/result cannot prove unchanged semantics.

The mutation driver first accepts baseline and a harmless comment. It then
requires these exact failures, restoring function identities, full control
results and original template bytes after every trial:

- Always-refusing health fails the fixed-configured baseline with the named
  `health-always-refuses` refusal.
- Skipping the health policy fails `auth-status-201` because its required
  `health:auth` refusal disappears.
- Supplying fixed status values without requests fails `request-0`.
- Skipping the old-origin request fails the baseline with `health:oldOrigin`.
- Skipping health inside `verify_services()` fails `requests-not-acquired`.
- Restoring the None-only assumption fails the fixed-configured baseline with
  `health:oldOrigin`.
- Allowing reflected or wildcard old origins fails the matching required
  `health:oldOrigin` refusal.
- Ignoring own-origin validation fails the missing-own-header case because
  its required `health:ownOrigin` refusal disappears.

Nine named faults are killed. A different exception, import failure, timeout
or unrelated runtime error does not count as a kill. Separate unrelated
`RuntimeError` and `ValueError` trials exercise that classifier boundary.
All mutation patches are in memory; operational files receive no mutant bytes.
Both successful mutation trials remain private. The final driver simplification
does not change production templates or control results.

Synthetic units run serially with `MemoryMax=1G`, `MemorySwapMax=0`,
`TasksMax=32` and `CPUQuota=100%`. Reported peaks range from 15.9M to 73.7M;
each reports zero swap. Full unit names and outcomes appear in the manifest.
Python runs with `-B`, and no shared cache is used. A final public-credential
scan accepts the packet and harmless wording, refuses 15 injected complete
secret/connection-URI values, then accepts exact restoration. No value is printed.
It also checks final template/manifest hashes, syntax and prior-packet file custody.

## Read-only checks, failed audit and parent handoff

Two launcher `check` runs succeed with private logs. The first separate
target-absence audit then fails with `JSONDecodeError`: PostgreSQL returns `f`
for EXISTS while that audit expects JSON. The failed audit source, failure
record and first preflight log remain private. Changing the audit query to
`SELECT to_json(EXISTS(...))` resolves it. No launcher check, binding, refusal
or source anchor is relaxed. The corrected audit confirms target/helper
absence and the custody statements above.

The parent can inspect hashes against the manifest and run read-only preflight:

```bash
COMBINED_PREVIEW_DIR=/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-combined-preview-cors-20261015
sha256sum "$COMBINED_PREVIEW_DIR/private-bindings.json" \
  "$COMBINED_PREVIEW_DIR/template-binding.json" \
  "$COMBINED_PREVIEW_DIR/launcher.py" "$COMBINED_PREVIEW_DIR/policy.py" \
  "$COMBINED_PREVIEW_DIR/controls.py" "$COMBINED_PREVIEW_DIR/mutation_controls.py"
python3 -B "$COMBINED_PREVIEW_DIR/launcher.py" check
```

The committed mutation driver is reproducible in a separate copied synthetic
directory or through its `run()` function. Its command-line entry exclusively
creates its result file; the existing result must not be overwritten for retry.
Use the same serial one-GiB/zero-swap unit envelope. Do not print private
configuration, environment files, source rows or raw operational logs.

No clone, dump, restore, database write, ACL execution, Docker create, service
startup, candidate checkout, dependency install, build, start, browser or provider
request runs here. No full application suite or live RLS suite runs. No PR,
push or merge occurs. The correction is committed locally only.

HTTP acquisition controls replace the opener; they cannot prove real sockets,
Kong enforcement, helper readiness or startup migrations. Status checks model
the three health endpoints; CORS controls check acquired headers, not a browser's
complete preflight algorithm. Container, filesystem and service prerequisites
in the integration probe remain synthetic. Hashes bind bytes, not permission
enforcement against a same-user writer or privileged Docker operator.

The parent still owns fresh independent round-two review and combined QA before
execution. Remaining evidence includes serial clone/ACL compatibility, actual
source/global/helper/Storage preservation across operational phases, retained
accounts and encrypted records, provider key validity, capacity, identified
build/start bindings, and desktop/390px navigation, console and artifact review.
Green synthetic controls do not authorize those phases or establish planner,
agency, scientific or production acceptance.
