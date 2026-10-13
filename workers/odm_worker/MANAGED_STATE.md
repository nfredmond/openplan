# Keep managed aerial state across worker replacement

Managed admission is opt-in. Keep `ODM_WORKER_MANAGED_ADMISSION=0` until the
installation has retained storage and its relevant recovery checks pass.
To enable admission, configure `ODM_WORKER_MANAGED_ADMISSION=1`, an explicit
`ODM_WORKER_INSTALLATION_ID` and `ODM_WORKER_MANAGED_STATE_DIR`.

`ODM_WORKER_MANAGED_STATE_DIR` must name an absolute, private directory on storage
that survives worker replacement. For a container, mount that storage at the
configured path, such as `/var/lib/openplan/odm-state`. Retain the same installation
identity with its state. Create or mount the private root before startup. A missing
root refuses without creating a replacement registry or scratch directory. Include the whole managed-state root in the installation's
backup and recovery inventory. A new empty root cannot recover prior admissions.

`ODM_WORKER_WORK_DIR` remains separate scratch for per-job files and outputs.
The container's default is `/tmp/odm_worker_jobs`. Managed state cannot use that
default or overlap the configured scratch tree. Resolved path aliases and parent
or child overlap refuse before startup creates scratch. The image supplies no
managed-state default.

For an independent container installation, mount a retained private host directory
at `/var/lib/openplan/odm-state` and set `ODM_WORKER_MANAGED_STATE_DIR` to that
container path. Set its owner to the worker's user and remove group/other access
before starting the worker. The existing journal enforces its private-file rules.
Do not copy a live writer's root or discard its original database after a restart.

These configuration checks establish a declared separate location. They cannot
prove that the backing mount persists or that a backup includes every worker,
engine, database and Storage object. Verify those facts for the installation.
The [dated correction](../../docs/reviews/2026-10-13-odm-managed-state-root/STATUS.md)
records its local evidence and limits. This does not activate hosted managed
admission, commit processing or adoption.
