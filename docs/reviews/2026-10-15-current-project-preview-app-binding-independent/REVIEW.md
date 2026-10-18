# Two P2 findings block the unchanged application preview recipe

Reviewed October 15, 2026 using GPT-6.1 Sol at high reasoning. No delegation.

**Do not execute the frozen recipe unchanged.** No P1 defect is identified.
The installed input bindings pass read-only review, but the documented nested
sandbox fails on this host. The startup attestor also rejects the application's
actual health response. These are bounded operating-recipe defects. They do
not reopen or authorize repetition of the completed REST recovery.

## R1, P2: the documented outer wrapper prevents the inner sandbox from starting

The [parent commands](../2026-10-15-current-project-preview-app-binding/README.md)
run Python inside bubblewrap. Both actual consumers then launch another
bubblewrap through
[confined_argv](../2026-10-15-current-project-preview-app-binding/templates/app_binding_v1.py).
The supplied boundary campaign exercises that inner constructor directly from
Python under systemd. It does not exercise the enclosing parent wrapper.

I run the actual constructor under the documented outer read-only mounts,
private writable root and private `/tmp`. Child-owned stand-ins replace the
candidate, donor and environment file. Python replaces npm after the complete
mount/namespace arguments. No actual checkout, npm, listener or donor write
can occur. Both build and start refuse before reaching the child:

```text
bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap> or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.
```

[nested_probe.py](nested_probe.py) records four observations: harmless-comment
and restored-source variants for both phases. All return exit 1 without reaching
the Python child. A preceding independent boundary attempt also reproduces the
failure with the outer wrapper's network sharing preserved. Thus this failure
does not depend on my initial synthetic wrapper's extra network isolation.

The same inner constructor succeeds when run directly under systemd. Its
harmless mutation survives, writable donor/env faults fail for their named
write assertions, and restoration succeeds. That control distinguishes an
actual nesting failure from an always-failing probe. The observed host has
both `unprivileged_userns_clone=1` and
`apparmor_restrict_unprivileged_userns=1`; this review does not establish which
kernel/profile rule causes the refusal.

Correct the concrete execution arrangement and demonstrate its complete
outer-to-inner path with stand-ins before consuming the one-shot build/start
intents. Preserve the resolved donor and environment read-only mounts, private
cache/log/tmp settings and resource limits. Do not disable a host protection
or bypass confinement to turn this observation green.

## R2, P2: the startup attestor expects a commit format the app does not return

The [attestor](../2026-10-15-current-project-preview-app-binding/templates/attest_start_v1.py)
at line 59 requires `health['deployment']['commit'] == a.APP_HEAD`, a
40-character SHA. The actual [health route](../../../openplan/src/app/api/health/route.ts)
at line 12 returns `trimmed.slice(0, 12).toLowerCase()`. For the intended build,
the response contains `67828c17c4c2`. The attestor therefore raises
`attest-http-identity` for a correct application.

The supplied [startup fixture](../2026-10-15-current-project-preview-app-binding/verify_attestation.py)
at line 55 returns the full SHA. Its passing baseline cannot catch this
producer/consumer mismatch.

[health_probe.py](health_probe.py) executes the current formatter and payload
function bodies in Node, removing only the formatter's TypeScript parameter
annotation. Imported commit/migration functions receive explicit inputs; no
Next server or HTTP request runs. Feeding the resulting JSON to the real
attestor, with process/systemd/HTTP observations replaced, produces the named
refusal. The synthetic full-SHA baseline and harmless-comment variant survive.
A prefix comparison in a private in-memory copy accepts the actual payload and
still rejects the helper commit's prefix. Finally restoration reproduces the
original refusal. All six observations remain private and hashed.

Bind the HTTP comparison to the route's declared 12-character format. Retain
full-SHA checkout, build-receipt and process-environment checks. Add a
source-derived payload case and a wrong-prefix case to the startup controls.
No application route change is needed to resolve this packet defect.

## Prior F1 is addressed at the inner-consumer boundary

The complete prior `159de17fa` review identifies bare npm calls and dropped
inherited cache settings. The new launcher does not call the old build/start
functions or old `clean_env()`. Its actual environment constructor supplies
private HOME, npm cache/logs, XDG cache and tmp, with explicit Node heap limits.
It does not inherit ambient provider, proxy, dotenv or Node settings.

The inner constructor mounts the whole host read-only, then the owned candidate,
execution directory and tmp writable. Later mounts protect the actual resolved
donor and `.env.local` read-only. `/run` hides both usual Docker socket paths.
The original read-only Docker checks remain outside this inner boundary;
read-only mounts do not restrict Docker API permissions.

The supplied five-case boundary campaign reproduces. My separate five-case
campaign also reads and attempts writes through the preserved `node_modules`
symlink, exercises private HOME/cache/log/XDG/tmp writes and atomic rename,
writes an owned `.next/cache` file and opens private `/dev/null`. Three reads
survive; three protected writes receive `EROFS`. Harmless source changes and
restoration survive; writable donor/env mutations fail for their specific
write-permitted assertions. Only child-owned specimens receive write attempts.
This closes F1's missing enforcement at the source/stand-in boundary. R1 still
blocks the executable parent recipe; no actual npm result is established.

## Identity, custody and resource controls retain their bounded meaning

The assigned clean branch fast-forwards locally to exact
`f29968d67c8177f33122691ad5879c675d457e08`. That commit adds only the packet
directory after application `67828c17c4c270529468eef1edd144e4a52b693a`.
Ownership covers this new review directory and the new 0700 private directory:

```text
/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015
```

I read AGENTS, planner-writing, prove-it, Supabase, openplan-browser, look,
direction/contract/roadmap/capability records, the prior independent review,
recovery sources/readiness recipe, and all current public packet sources and
evidence. The nested-app direction check passes with private npm cache/logs,
host read-only mounts and the existing age/version/change reminders. No product
status row, v1 requirement or independent-installation obligation changes.

[audit.py](audit.py) imports the installed launcher with Python `-B`, denying
subprocess/socket calls while actual `bindings`, `load_recovery`, `app_values`,
original pinned-file and active-receipt consumers run. Installed templates,
private inputs, evidence hashes, actual four completed receipt hashes and
the parent observation hash match the manifest. The helper functions retain
their original globals and fixed paths. Helper HEAD/purpose remain original
`06a108010`; application HEAD remains `67828c17c`. The active REST ID remains
`140c68675574a3705fa68aa46543d806d66d1f20739bf63273d6126108d5430d`.
The original source anchor, target OID string `6118831` and cluster binding
remain unchanged. No stored true flag substitutes for actual future readiness.

The complete sealed app environment changes only `OPENPLAN_COMMIT_SHA`.
Its private files remain 0600. Actual migration/dependency metadata consumers
accept all 419 original migration paths/bytes, 1,143 non-root lock entries,
the sole root declaration delta `@xmldom/xmldom` `0.8.15`, and all 969 installed
lock entries, versions and package-manifest hashes. These checks do not hash
every installed JavaScript byte or prove dependency security.

The checkout source uses one local shared/no-checkout clone, exact detached
HEAD, exclusive intent before clone, new 0600 env and the donor symlink.
The outer read-only host boundary protects the source object store while the
new clone uses alternates. Build/start use exclusive, file-and-parent-fsynced
intents. Lost acknowledgements and partial state refuse retries. No cleanup or
recovery path silently reuses them. This is not a cross-process atomic
transaction or protection against a hostile same-user actor, external donor
changes or every power-loss consequence.

Source inspection and replay confirm before/after 10 GiB build, zero swap,
finite CPU at most 200 percent, current memory/disk headroom, fresh `.next`,
tool/input/active hashes, exit/OOM counters and complete build inventory checks.
Start requires 512 MiB, zero swap, heap 320, exact build bindings and free web
port 3585 only. An intent is not a running-process receipt. The attestor checks
unit/listener/cwd/cgroup/environment, non-cache built bytes and expected migration
metadata, permitting runtime cache changes. Health does not census the live
schema. R2 prevents acceptance of the actual commit response.

## Reproduction, preservation and limits

[replay.py](replay.py) redirects supplied fixture/output paths before execution.
Commands, sockets, process/systemd/database observations and npm/exec boundaries
remain replaced before consumer operations. Normalizing only relocated paths
reproduces the supplied 47 consumer cases, 43 refusals and 14 mutation campaigns;
16 startup cases and six campaigns; seven small cases and four campaigns;
and five single-boundary observations. Each mutation set has its harmless
survivor, targeted faults and restoration. Redundant-guard refusals retain their
actual narrower meaning; they do not show every removed guard permits execution.

All proof units run serially at 512 MiB, zero swap and 50 percent CPU. The small
campaign reads those actual Python cgroup values. Synthetic and input-audit
units mount the host read-only and disable network access. Direct boundary
controllers run under systemd without the outer wrapper so they can distinguish
the nesting failure; their real children still use the actual inner constructor
and only new specimens. No real donor write is attempted.

Before/after inventories preserve every byte, mode and symlink text across
18,502 old-packet files/links and 3,141 current-packet files/links, with zero
additions/removals during review. The old count includes the 17 parent recovery
additions already present when this review starts. Directory modes also match.
The inventory assay accepts mtime changes, detects byte/mode/link changes and
restores in `finally`. It does not follow borrowed dependency links.

Retained failures include the initial nested-boundary attempts and an independent
health-probe JavaScript adapter missing parentheses around an object expression.
The corrected adapter uses a new fixture/output name; original logs remain.
The combined probe runner stops at the real nesting refusal, after input and
small checks pass. Remaining probes then run separately. None of these trials
changes an existing packet or service. Known-value screening detects each of
nine configured secret/full-URI injections and accepts a harmless note; unknown
secrets and short identifiers remain outside that screen.

The parent must resolve R1/R2 in a new reviewed, hash-bound recipe before
application execution. Keep the original helper/source/Storage anchors and
completed REST state immutable. Reacquire actual readiness and preservation
before each authorized operation, preserve exclusive ownership and stop on
partial state. Do not rerun REST recovery, regenerate anchors or build old `06a`.

No actual application checkout/build/start, helper transition, SQL/HTTP/provider
request, install, browser, full suite, nested agent, push, PR or main merge runs.
The current app candidate remains absent and its execution directory empty.
The parent retains actual build/capacity evidence, identified desktop and 390px
journeys, console, login/decryption and artifact custody. Prior 22,931 passes
and 1,662 skips do not cover the new workbook format. No practitioner, public,
Excel, scientific or production acceptance is claimed.
