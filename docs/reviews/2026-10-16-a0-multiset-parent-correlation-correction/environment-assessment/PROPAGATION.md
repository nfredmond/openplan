# Static propagation and minimal proposal

This trace follows frozen trial03 source and saved argv. It does not evaluate or import wrapper functions or reconstruct an actual environment receipt. Private SOURCE_REASONING.json labels its nine-key declaration and ten-key prediction accordingly.

| Boundary | Retained/source fact | Proposed effect |
| --- | --- | --- |
| environment(), lines115-118 | Reads the same retained entry INV and returns nine exact keys. | Add one PWD entry with str(PRIVATE). No ambient lookup. |
| sandbox(), lines144-149 | Keeps initial null target, rootRO, literal chdir, final null devbind then clearenv. Iterates environment() into setenv arguments before absolute Python-I-B-S command. | Iteration adds the one consistent declaration. No argument order, mount, command or flag changes. |
| bwrap argument parser | Applies clearenv and explicit environment options while storing chdir for setup. | Ten declared values instead of nine. |
| bwrap late setup | Writes PWD after the requested chdir. | Same fixed PRIVATE value replaces itself. |
| Python startup | Reviewed flags/config and nonempty LC_ALL=C do not remove PWD or require an LC_CTYPE addition. | No proposed flag/locale change. |
| POSIX/os environment mapping | Preserves the process mapping. | Static model predicts the ten declared values, not an actual receipt. |
| observe(), line203 | Uses same(dict(os.environ),environment()), refusing wrapper-private-environment. | The exact expected map contains PWD. Unknown/missing/wrong values still refuse. |
| inner(), lines264-271 | Before observation must return before the wrapper records before.json or imports prepare/controls/final. | Ordering stays unchanged. No check is reached or accepted by this proposal. |
| independent finally | After observation, source pins and artifacts attempt independently; primary failure remains primary. | No cleanup, reader or failure classification change. |

The bwrap sequencing statement rests on the immutable Ubuntu source references listed in SOURCES.md. The Python facts use separate preconfig/initconfig/pylifecycle/POSIX/os source files. Existing environment values PYTHONDONTWRITEBYTECODE and PYTHONHASHSEED remain process fields under-I; this does not mean-I consumes them as configuration. Actual bytecode suppression comes from-B. No new hash-seed determinism claim follows.

The proposed expected addition is the literal fixed PRIVATE path. It is not a getcwd attestation and does not claim path canonicalization, namespace ownership or target identity. The actual chdir source uses the same fixed string. Any future path change must remain separately pinned and reviewed.

Necessary means the strict expected map must cover bwrap's mandatory PWD assignment under these flags. It does not mean an explicit setenv is necessary to make bwrap produce PWD. Sufficient means the one-entry proposal closes this source-model gap. It does not mean the actual unknown TEST03 diff is diagnosed or the94 checks are passed. Exact installed binary/source association is pinned, but build reproduction, actual startup behavior and all dynamic/ABI/resource effects remain outside this assessment.

MINIMAL_DELTA_PROPOSAL.patch contains the sole proposed entry. No actual production/test wrapper file changes. Root must approve the next source delta before any future binding, controls/request or executable preparation. No independent successor is started.
