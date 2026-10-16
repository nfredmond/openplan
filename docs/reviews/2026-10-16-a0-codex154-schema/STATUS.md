# Cached Codex 0.154 emits the selected usage-limit contracts

October 16, 2026. This is offline native schema evidence for roadmap A0.
It adds no application capability, registry acceptance, migration or release.
Source base is `f8a571bb0a18b8b6501870acb5ef1e760d487e1c`. The application
and connector trees remain `d577a9cd955018b3253f42b3d9af2a96a9a10b53` and
`228ce912b1cf63dba408445422dc6e2b690d91f4`.

## Three metadata commands finish without provider generation

The retained package is
`/home/nathaniel/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl`.
Its native `--version` returns `codex-cli 0.154.0`. The commands then read
`app-server generate-json-schema --help` and generate the default schema bundle.
No account, authentication, model, thread, turn or reset-credit request runs.
No download, install, updater or global symlink change runs.

Each native command uses Bubblewrap with an empty root, read-only `/usr` and
package mounts, a writable private proof root, cleared environment and private
network namespace. Host home, Codex profile and configuration files are absent.
The namespace constructors receive fixed resolved package and proof paths.
Private command records retain intent, returned PID, stdout, stderr, exit and
stream hashes. The outer user unit retains its manager intent, PID, full stream
and terminal exit. Both the controller and manager finish with exit zero.

Unit `openplan-a0-codex154-native-schema-20261016-01` has invocation
`6937be2368d0477798ed363585ca7a25`. It runs under the shared compiler flock,
1 GiB memory maximum, zero swap, 50 percent CPU and 120-second unit limit.
The controller observes 282,488,832 bytes peak memory and zero memory events.
The manager reports 2.578 seconds runtime and 269.4M peak memory. All three
commands also have individual 30-second waits.

The binary SHA-256 is
`3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022`.
Metadata SHA-256 is
`b039964d28d57b2a7e929ee9986303582501c7cc9787f6c018b6d3c7b35c87d7`.
Both match before and after execution. The 305 generated files total
3,492,670 bytes. The output-kind, nonempty-output and 64 MiB validation checks
pass. That byte check runs after generation; it is not a disk reservation.

The official documentation describes generated schemas as version-specific.
The observed native help labels this command experimental. This capture uses
the default output and does not pass `--experimental`.
[Official Codex app-server schema documentation](https://learn.chatgpt.com/docs/app-server).

## Seven selected types preserve the current reset boundary

[Selected definitions](selected-definitions.json) come from the actual generated
bundle. All seven match the previously retained usage-limit input structurally:
RateLimitSnapshot, RateLimitWindow, RateLimitReachedType,
GetAccountRateLimitsResponse, AccountRateLimitsUpdatedNotification, TurnError
and CodexErrorInfo. The previous packet's global-version observation is dated;
this capture does not execute the current global launcher.

TurnError exposes additionalDetails, codexErrorInfo, message and misalignment.
It supplies no causal bucket identity, reset timestamp or model identity.
The current tracker recognizes usageLimitExceeded, rateLimitExceeded and
sessionBudgetExceeded. Default-bucket windows remain observations. Generic
failure receipts keep their reset unknown. This result requires no parser change.

The full bundles differ. The new bundle SHA-256 is
`f3487938786b729cb6773dbc9e83a7efab9c78c845db7094e8f539f373cbacc9`;
the retained historical bundle is `7b9e7d385fffef8d428cc5490b56ce9c393bd3ed7bc7ccd730956387e723ec05`.
The structural comparison records 191 differing paths outside the selected
contracts. Their cause is unassessed. Selected equality does not establish full
protocol equivalence or account and model compatibility.

## Controls exercise the stated boundaries

The three final campaigns retain 15 named broken behaviors, harmless survivors
and restoration. Kernel controls use owned temporary fixtures. The donor test
reads its specimen but receives EROFS when writing; a later writable override
reaches `donor-write-reached`. The offline probe sees a different network
namespace and no host profile. Removing network isolation fails
`host-network-visible`. Mounting an owned empty specimen at the excluded profile
path fails `host-profile-visible`, without mounting or reading the real profile.
No shared donor is touched by these controls.

Capture predicate controls replace the native command boundary. They detect
wrong metadata, wrong native version, symbolic-link output, excess bytes, changed
package bytes and empty output. Path and exclusive-record controls detect
relative, unresolved, missing and donor-as-writable-root paths, plus overwriting
an existing record. Copied mutation subjects and owned specimens restore after
each fault. These controls do not execute a provider.

The first five-predicate capture campaign and two-fault kernel campaign remain
private and unchanged.
The second campaign adds empty-output refusal. Two earlier units' complete
manager streams exist in parent tool activity; the later predicate, primitive
and actual native units retain complete streams in the private proof root.
The source and output pins are in [evidence.json](evidence.json).

The separate budget and earlier usage-limit test lanes wrote the shared donor's
Vitest cache before correcting their configurations. Their failures stay in
their reports. This packet does not restore unknown preceding cache bytes.
`scoped()` provides a kernel read-only donor mount after writable checkout and
private mounts. The owned specimen demonstrates that order. Future tests must
apply that protection from their first dependency command. It is not evidence
that those earlier shared writes never happened.

## Native provider and product acceptance remain open

Schemas describe types, not real rate-limit observations or installed provider
compatibility. No real account, generation, receipt publication, SQL18, native
RLS, cancellation, concurrency, route, reader, UI or desktop/390px journey runs.
The wrapper's separate manager-environment finding still blocks its admission.
T1, T15 and v1 remain open. No main merge, hosted change or release runs.

Namespace controls cover owned local fixtures, not hostile-owner resistance.
Stream and file hashes do not establish physical power-loss durability. A lost
acknowledgement or timeout leaves an incomplete operation fenced; this capture
has no automatic retry. The finite wait and outer unit limit do not prove every
process-lifetime case. Independent review of this new proof is pending.

## Later experimental capture resolves the full-bundle difference

The separate [experimental follow-up](EXPERIMENTAL.md) uses the same retained
binary with `--experimental`. Its full v2 output reproduces the historical bundle
byte for byte. This supersedes the earlier unassessed difference for these two
observed modes. It preserves the original default capture and its limits, and
does not establish historical invocation provenance or provider acceptance.
