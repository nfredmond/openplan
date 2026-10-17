# Inner host-owner parity is unresolved before a final request

This is a SOURCE conflict and proposed policy, not an actual runner failure,
mapping probe, native observation or accepted normalization. No namespace,
privilege helper, chown, dependency, runner or manager executes.

The proposed `namespaceArgv` enters a new user namespace through bwrap, requests
UID/GID1000 for the campaign and unshares networking. An argv request is not
evidence that a particular host ID is mapped. No current UID/GID map is probed.

## The strict repeated comparison can reject an unmapped owner

The current `runner.py` call path is explicit:

1. `outer()` calls `inputs(request)` before starting its owned unit.
2. `entry()` calls `inputs(request)` before `os.execve` enters bwrap.
3. `campaign()` calls `inputs(request)` inside the proposed user namespace.
4. Each `inputs()` calls `pinned(index['files'])`. That function requires exact
   equality between `descriptor(path)` and the frozen complete host descriptor.
5. The descriptor includes raw UID/GID, in addition to mode, device/inode,
   length/hash, modification/change times and regular/nonsymlink status.

ROOT's metadata-only observations identify host UID/GID0/mode755 for the Node,
resolved Python, bwrap, systemd-run and systemctl executables. The frozen input
index records their exact paths, plus every other named input. If host0 is
unmapped in the new namespace, the visible owner can differ from host0. The
third full comparison then cannot meet its unchanged host owner descriptor.
`inputs()` also calls `aliases()`, whose complete link comparison includes raw
UID/GID. The exact host-root Python alias has the same unresolved inner-owner
comparison. The other62 listed donor links retain their own complete descriptors.
The historical A0 value65534 is not a current observation, CI cause or assigned
mapping value. No source statement here substitutes it for an actual inner read.

`REQUEST.proposal.json` marks this conflict unresolved. The current strict guard
remains intact; no final `REQUEST.json` is created and no grant can follow from
this packet alone. The namespace itself may also be unavailable on this host;
bwrap's non-setuid755 metadata establishes no runtime namespace capability.

## Proposed next source design needs ROOT disposition

Keep complete host descriptors and host preflight checks in `outer()` and
`entry()`. Keep independent host postflight checks in `outer()` after the owned
unit is terminal. Do not drop or rewrite those host UID/GID values.

For a NEW runner revision only after ROOT disposes this design, split the inner
read policy into exact path lists recorded in the frozen index:

- Source, seed, private, donor and other UID/GID1000 inputs retain exact complete
  comparisons inside the namespace. A mapped identity mismatch remains a refusal.
- Only the individually listed host-root regular inputs receive a separate
  inner-view record. The handoff index names each one. It is not a general
  rule to follow or exempt anything owned by root. Verify their complete host
  descriptors outside, and inside retain exact file kind, nonsymlink, device,
  inode, mode, length, SHA-256, timestamps and within-read metadata stability.
  Record actual inner UID/GID separately with `systemOwnerParity=UNPROVED`.
  Do not claim equality to the host UID/GID or silently replace observed IDs.
- Keep the exact62 donor links and exact Python alias policy. Record actual inner
  link metadata/stability separately where ownership is unmapped; retain exact
  link text/resolved path and separately pinned target bytes. Source/private
  owner checks remain strict. No general following, ambient search or fallback
  is added.

The next revision would record actual UID/GID maps and file views only during
a separately granted run. Even an owner value that happens to equal host0 does
not establish a mapping equivalence without its actual map. ROOT must dispose
the exact path partition, owner-comparison policy and result reader before any
such implementation or final request. It must then reread the changed NEW
runner source and its descriptors. The six-case guard sensitivity source plan
also remains pending; no source inspection substitutes for its later controls.
