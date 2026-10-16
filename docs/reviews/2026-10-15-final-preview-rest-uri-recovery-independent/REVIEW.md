# REST transition passes source review; build/start recipe needs a boundary fix

Reviewed October 15, 2026 with GPT-6.1 Sol at high reasoning. No delegation.

**The bounded REST transition source has no identified blocker. One P2 finding
blocks using the documented build/start recipe unchanged.** This is preparation
and source review. It supplies no operational acceptance or new authorization.
The parent retains execution and readiness checks.

## F1, P2: protect reused dependencies and route npm cache writes privately

The [parent recipe](../2026-10-15-final-preview-rest-uri-recovery/README.md:260)
launches Python directly under systemd resource limits. The actual
[build consumer](../2026-10-15-final-preview-rest-uri-recovery/templates/rest_uri_recovery_01_launcher.py:346)
executes bare `npm run build`; the
[start consumer](../2026-10-15-final-preview-rest-uri-recovery/templates/rest_uri_recovery_01_launcher.py:375)
executes `/usr/bin/npm`. Neither adds a filesystem boundary. The candidate's
`node_modules` is a symlink to the parent's
`t3-0f743997/openplan/node_modules`. A host metadata observation confirms that
target directory is writable for this user and its mount is writable. No write
to that target is attempted.

The real `clean_env()` retains the user's home directory and drops both npm
cache environment spellings. Passing a private `npm_config_cache` to the
documented systemd command therefore does not reach npm. The installed npm
implementation at `/usr/lib/node_modules/npm/lib/npm.js`, lines 134–143 and
462–463, creates its selected cache/log directories and defaults logs beneath
the cache. Resource limits do not isolate those filesystem writes. The new
consumer tests mock npm and exec, so they cannot establish this boundary.

Before build/start, supply a reviewed outer filesystem wrapper that mounts the
resolved borrowed dependency target read-only and gives npm its own private
cache/log location. A private cache bind over the actual npm cache location can
survive `clean_env()`; an inherited cache variable alone cannot. Confirm the
wrapper with a harmless read and a refused write against child-owned specimens,
then inspect its actual mount arguments. Retain Docker access and local preview
network access for the launcher's existing checks. This can be fixed in the
parent execution wrapper without changing the frozen REST transition sources.
Do not use a broad install or change dependency permissions.

This finding does not claim that a dependency write occurred. It identifies
missing enforcement in the exact proposed execution path. It does not block
the reviewed REST-only replacement.

## Exact checkout and ownership

The assigned clean tree is
`/home/nathaniel/.t3/worktrees/openplan/t3-a1a5f6bf`, branch
`t3/review-preview-rest-uri-recovery`. It fast-forwards locally from
`05dd3e8da4a4572437f06e771b0a2477873e681f` to exact implementation commit
`d71e0aa7aa1b2c3c945ee87a54ea49d6a5772378`. No fetch or implementation edit occurs.
Ownership covers only this new report directory and:

```text
/home/nathaniel/.local/state/openplan/rest-uri-recovery-independent-20261015
```

I read AGENTS.md, planner-writing, prove-it, Supabase, local browser guidance,
the direction records, the full recovery report, templates, manifest, diffs,
preparation and evidence scripts, supplied control sources and records,
the diagnosis, final-binding report and prior CORS review. The parent's cached
Supabase monitoring/changelog documents supply documentation context. No browser
or external documentation request runs. The nested `openplan/` direction check
passes with the existing review reminders. It needs no borrowed dependencies.

The public manifest matches all three installed 0600 template copies, both
manifest hashes, every listed original file and every new input hash. The real
`pinned_files()` accepts those actual fixed-path inputs with subprocesses and
sockets blocked. The environment maps differ in exactly
`rest.PGRST_DB_URI`; the new env file equals the old file with that URI replaced
and parses to the exact new REST map. Credentials and all other values stay
private and unchanged.

The bindings retain app `06a108010ab39aa42eed4c2bcda3e1371b8aa813`, target
`openplan_project_combined_preview_0752bc2e8104b7a40faab27f`, target OID `6118831`,
cluster `a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`,
and source anchor
`82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547`.
The anchor is read from its binding, never recaptured. I do not query the source
or claim current logical source/global/Storage preservation.

## The transition preserves the intended boundary

The controller's exact stop target remains
`cb8cfc278c910f934f495007a85748a740e3b274f977e00e12fe3cc2fa7add16`.
Old-container checks bind Config, HostConfig, mounts, image, name and network
identity, plus running state, start time and restart count. The preflight also
checks the original source/global fingerprint, earlier inputs/helpers, Storage,
current target OID and the three unchanged helpers. I inspect these code paths;
I do not invoke operational preflight, which can write failure evidence.

An exclusive overall intent precedes mutation. Stop, rename, create and start
each require their own exclusive intent before the exact allowed argv, then an
acknowledgement. The stopped old ID remains retained under the specified failed
name. Name collisions refuse. The target identity is checked before stop,
create and start. The replacement create command repeats the original image,
network, limits, labels and original name with the corrected env-file path.
The returned new 64-character ID is persisted before inspection and startup.
Startup uses that exact ID. The observed old REST has no mounts or publication;
its command, entrypoint, user, health configuration and other checked creation
fields match the pinned image defaults. Empty/null Docker field normalization
is recorded explicitly. No custom restart, DNS or security setting is lost in
the examined baseline.

Active selection requires the created receipt, started receipt, four-service
receipt and their hashes. It rejects the old ID, incomplete state, changed
other-service receipt, wrong target and old receipt hash. Actual service
inspection follows file selection. Kong continues to use the original REST
container name on the unchanged network. Auth, Storage and Kong configuration
and environment stay unchanged. Docker DNS refresh remains an operational
condition to observe after replacement.

Lost acknowledgement or a failed check leaves a partial transition with its
intents and evidence. It does not roll back or retry. A lost create response
can leave an unadopted replacement under the original name; the create intent
and original-name collision prevent another blind creation. A failed start
acknowledgement can leave a running replacement without active receipts.
Preserve and inspect either state. Check-to-command races with another actor
remain possible; the controller does not claim an atomic Docker transaction.
Keep the parent's freeze and sole ownership throughout execution.

`clone`, `services` and `checkout` refuse and have no allowed CLI entries.
`active-check` avoids the occupied API bind probe. `start` still binds only the
web port, 3585. Both actual Python build/start consumers hash active receipts;
an old build receipt hash refuses. Original HTTP/CORS acquisition and policy
function sources remain unchanged, including REST HEAD 200, Auth/Storage 200,
exact own origin and the previously reviewed old-origin handling. No native
connection can substitute for these gates.

## Reproduction and independent probes

[review.py](review.py) copies the supplied controls into the new private root,
then runs them with command runners and sockets replaced before mutation.
The complete replay equals the submitted `controls-05.json` record. It retains
63 baseline cases, with 15 survivors and 48 intended refusals; 379 observations
include repeated mutation/restoration campaigns. The 607 historical rows retain
99 survivors and 508 refusals. The harmless comment and all restoration
campaigns survive; all 15 new and nine historical named faults produce their
specified failures.

Several mutation results establish a narrower claim than unsafe execution:

- Form decoding and removal of the native consumer reach the redundant exact
  input-equivalence refusal. Their changed failure reason proves the native
  subject participates; it does not prove that fault alone bypasses the pipeline.
- Removing exact input equivalence still reaches the configuration endpoint
  refusal. Removing the old-container projection still reaches `service:id`.
- The supplied overwrite-intent mutation fails at `retained-rest:Name` on a
  repeated transition. It does not directly test exclusive intent behavior.

[probes.py](probes.py) closes that last test gap directly. A harmless source
comment survives first. The actual `mutate()` and `write()` functions execute
against new private evidence directories, with the command runner replaced.
For both acknowledged and lost-acknowledgement cases, a second same-stage call
hits `FileExistsError` before a second command. Replacing `open('x')` with
`open('w')` produces the named `stage-intent-allowed-second-command` failure in
both cases. Exact function identities restore in `finally`, and restored
campaigns again permit one command only.

An independent native-policy campaign accepts the fixed URI and harmless hex
case, then refuses literal plus, encoded plus, duplicate options, double
encoding and malformed escapes. The form-decoding fault fails specifically
because it accepts the literal plus. Finally restoration rechecks the actual
pinned-file consumer. These probes produce 12 recorded observations: eight
surviving campaigns, three intended code-fault detections and one observed
recipe gap. They do not represent 12 independent runtime transitions.

A copied native replay runs five read-only observations against only the new
target. `%20` and lowercase hex connect as `authenticator`, with read-only
transactions and the expected search path. Original `+`, `%2B` and restored
`+` fail with the expected `+search_path` error. URI credentials travel through
stdin, never credential argv or public evidence. This is native parsing proof,
not REST readiness. No real HTTP/CORS request runs in this review; the frozen
implementation evidence records the existing REST 503.

Read-only current Docker inspection confirms all four original IDs retain their
frozen creation projection and start time, run, and have zero restarts. Complete
raw inspection stays private. A streaming inventory covers all 18,485 packet
files and symlinks at review start, including the recovery evidence. Final
bytes, modes and symlink text match exactly, with zero additions or removals.
It does not follow the shared dependency symlink.

## Execution limits and retained failures

All review units run serially with 512 MiB memory, zero swap, 50 percent CPU,
Python `-B` and bytecode disabled. Synthetic/native inspection units mount the
host read-only with only the new private root writable. Synthetic units also
have no network namespace access. Docker-native replay uses the local Docker
socket and the container's existing target connection. Direction runs with a
private npm cache. The initial inventory and host writability metadata check
run directly without a filesystem namespace; they write only new private output.
Resource and artifact hashes appear in [evidence.json](evidence.json).

Earlier review failures remain private. The first native wrapper redirects
output before copying its needed fixed input, so it fails before Docker runs.
Three configuration-parity attempts expose review assumptions about empty
versus null fields and a nonexistent Storage REST-URL key. The final comparison
uses the actual fields and retains all earlier logs. The first final-check
attempt assumes a numeric JSON OID; the frozen PostgreSQL observation uses
the string `6118831`, which the corrected check preserves. None is implementation
failure or acceptance evidence. No helper mutation, SQL write, build, web start,
install, full suite, browser, provider request, push, PR or merge occurs.

## Conditions before parent execution

1. Keep the exact manifest/template hashes and frozen original inputs. Run the
   controller's reviewed preflight under the parent's authorization, including
   the actual immutable source/global/earlier-helper/Storage checks and exact
   target OID. Keep exclusive operational ownership.
2. Execute transition at most once. Preserve every old file and the stopped old
   container. On failure or lost acknowledgement, stop and inspect the retained
   state; do not rerun transition, services or clone.
3. Require real active-check success, including actual REST HEAD 200, other
   service 200s, CORS and exact active IDs. Require actual source/global/Storage
   preservation before build. DNS delay or another REST 503 remains a failed
   readiness boundary, even when native URI parsing succeeds.
4. Resolve F1 before build/start, then retain the existing build hash, app/env,
   clean-tree, migrations, resource and free-web-port checks. The parent owns
   identified desktop and 390px journeys, console, artifacts, retained login
   and decryption. Prior 22,931 passes and 1,662 skips remain prior scope only.

The tests cannot establish daemon transitions, DNS refresh, crash-durable intent
files, schema-cache completion, real authorization, full logical preservation,
application capacity, planner/public usefulness or production acceptance.
