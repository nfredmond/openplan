# Exact inner owner views preserve the host pins

SOURCE IMPLEMENTATION ONLY. ROOT disposition03 accepts this design for NEW03.
It does not grant a namespace, mapping probe, helper, manager or test operation.
Preparation02 retains its original unresolved source conflict unchanged.

`outer()` preflight and `entry()` call `inputs(request)` with its strict host
default. Independent outer postflight repeats the complete input check, including
all donor and system files and all aliases. No host descriptor is rewritten.
Postflight success also requires the owned unit's independently observed terminal
state. An unknown terminal state retains partial evidence and refuses completion.

`campaign()` alone calls `inputs(request, inner=True)`. Every source, private,
seed and donor regular input requires frozen UID/GID1000 and complete descriptor
equality. The62 donor aliases retain complete exact equality too. Unknown
non-1000 paths refuse. The index must partition into these strict paths, exactly
six system regular paths and the Python alias. It must contain exactly63 aliases.

The six individually accepted regular paths are:

- `/usr/bin/node`
- `/usr/bin/python3.14`
- `/usr/bin/bwrap`
- `/usr/bin/systemd-run`
- `/usr/bin/systemctl`
- `/usr/include/node/node_version.h`

Only these six regular paths and the exact symlink `/usr/bin/python3` permit a
different inner UID/GID view. Their frozen host UID/GID must remain0/0. Every
non-owner field remains exact, including type, path, mode, device/inode, size,
timestamps, content hash for regular files and link text/resolution for the
alias. The target `/usr/bin/python3.14` is separately pinned as a regular file.
There is no rule exempting arbitrary root-owned files, following arbitrary
links or searching for alternatives.

`descriptor()` still compares complete actual lstat/fstat metadata before,
during and after its read. That stability tuple includes actual UID/GID.
`aliases()` keeps complete actual before/after metadata stability too. The
owner-view policy runs after these stable reads. It does not remove their
actual owner fields or replace them with host values.

During a separately granted campaign only, `inner-input-view.json` records all
seven actual full descriptors, actual UID/GID and the raw actual
`/proc/self/uid_map` and `/proc/self/gid_map` contents. It also lists every strict
regular and alias path. `systemOwnerParity` stays `UNPROVED`, including if an
actual owner happens to equal host0. No map has been read in this preparation.
Historical65534 evidence supplies no current owner or mapping claim.

The complete input index retains the host descriptors and exact path partition.
`pinned()` and `aliases()` dispatch through `compare_descriptor()`. P-METADATA
uses real tiny local metadata changes and separately supplied synthetic owner
views to cover strict owner refusal, each of the seven explicit system views,
other-field refusal and an unknown root-owned path refusal. Those supplied
descriptors establish policy sensitivity only. They do not represent an actual
system file, namespace map, ownership change or host/inner equivalence.

Bwrap is host mode755 and non-setuid. Those metadata facts establish no usable
namespace capability. Cost fit and actual inner metadata behavior remain
unmeasured. No current CI cause or candidate defect is inferred from this policy.
