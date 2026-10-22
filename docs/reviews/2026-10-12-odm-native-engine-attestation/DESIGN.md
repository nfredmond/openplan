# Observe the configured original native engine before draft work

Continue existing M3 and M5b.2 above the frozen combined PR263. The private
application authority already requires a separate engine attestor, but the
current fixture supplies one. Implement a Linux adapter for the cached native
NodeODM 2.2.4 image. Keep every default and processing commit unchanged.

Use the Docker [container inspection API](https://docs.docker.com/reference/api/engine/version/v1.51/)
through an explicitly selected local Unix socket and the same host's procfs. A worker in another PID namespace is unsupported. The adapter only sends GET
container and network inspection requests. It never starts, stops, executes inside or changes a
container. Supervise the single observer process under the caller's actual
deadline, strict ownership callback and parent-lifetime pipe. Bound response
and diagnostic bytes, refuse malformed/duplicate-key responses and never print
the daemon's configuration or credential values. Verify socket type and the
configured daemon UID through Unix peer credentials. The local operator remains
responsible for choosing the trusted daemon.

The original engine instance must be its full container ID. Require the exact
configured image ID, current running/unpaused state, a read-only application
filesystem and the supported launch profile. The initial profile uses the
already observed NodeODM image
`sha256:cb07d06e21fd6189cfad287c6fedfa0b72568100355635cd9035cb86eed42ee2`.
A read-only copy of that image's package metadata identifies NodeODM 2.2.4.
Other image IDs and launch profiles remain unsupported by this adapter.

Bind the original configuration hash to a versioned canonical projection of
Docker Config, HostConfig and destination-sorted Mounts, plus the actual bytes/hash of the profile's
read-only configuration file. Read those bytes through the inspected running
process's root in Linux procfs. Open the process directory, anchor its root and
refuse a symlink or nonregular configuration leaf. Bound the file read and compare
its descriptor metadata and the process's PID/start identity afterward. Re-observe
the original container and process/configuration before returning. Missing procfs
permission refuses. A host pathname can refer to a different inode after replacement
while the container retains its mounted file. Native06 also shows that Docker's
archive endpoint can later read the replacement instead of the process's original
mounted file. That prototype is superseded and remains unaccepted. Hash in the observer; return only bounded
identity observations and digests. A declared configuration hash alone does not
establish mounted bytes. Writable mounts are limited to the engine's
existing tmp/data locations. Reject other application overlays.

The endpoint must use the inspected container's literal IPv4 address on its
one verified internal bridge, the profile's declared HTTP port and no URL state.
Inspect that exact network ID and require the container's membership. A hostname,
host port, substituted network or another address cannot establish this binding.
The configured original API/version and credential reference stay unchanged.
This observation verifies their retained identity, not the credential's validity.

Compare the complete configured original before opening the observer and check
owner/deadline again afterward. Invalid, unavailable and mismatched observations
refuse. No fallback, new engine adoption, image pull or inferred success is
permitted. The existing application authority must still make its fresh access
read before invoking this adapter.

Prove every new test with harmless and selected broken behavior. Use an owned
Unix-socket fixture for bounded/stalled/malformed response controls, then a new
capped private native engine fixture for actual daemon and restart observations.
Preserve source bindings, failed trials and stopped services. Any later pipeline
check must use the actual adapter rather than a supplied true result.
Preserve a native regression that distinguishes host path bytes from retained
bind-mount bytes.

This adapter does not fence another engine writer, provide an atomic remote
authorization boundary, prove stored draft contents, reconcile an uncertain
command or grant processing commit. A container can change after inspection;
its hash does not validate photogrammetry or scientific output. Cross-host
recovery, other engines/images/profiles, complete results/callback custody,
clean installation and full M3/v1 remain open.
