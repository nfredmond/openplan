# Explicit installation worker inventory

The selected-root command cannot identify omitted worker families. Add an offline
operator command that requires a status for each worker family in the current
software, retains exact private configuration bytes and emits the existing
worker-root selection format. This records the operator's assessment. It does
not discover installed services or establish installation completeness.

## Sources and declarations

The software catalogue covers the five Python worker entrypoints, the nine Node
worker entrypoints and the installed Planner Agent connector. AequilibraE and
ActivitySim also have npm launch aliases. Synthesis generation and execution
have separate entrypoints and may share a root. Compare the catalogue with all
current `worker:*` npm scripts and `workers/*/main.py` files. An unknown entrypoint
requires catalogue review. Native helper programs and externally installed
services remain a stated discovery limit.

Each private operator profile records an installation label, selected roots,
configuration file IDs and an assessment for every known family. States are
`configured`, `not_deployed` or `unassessed`. Configured workers declare custody
as `local_roots`, `database_and_storage`, `external` or `unassessed`. Local custody
requires a selected root. Configured workers require retained configuration.
Every assessment needs an explanation; a missing environment variable never
implies absence. Historical roots may remain selected for a stopped or
unassessed worker. Shared roots use one ID referenced by several workers.

The command never sources environment files, starts services or contacts a
provider. It does not resolve a default directory on behalf of the operator.
The source audit must distinguish configuration from original inputs, journals,
saved outputs, dependencies and genuinely reconstructible caches. In particular,
ActivitySim's bundle/runtime roots and NodeODM's separate task volume are not
covered by a generic AequilibraE work-directory entry.

## Durable output

Use a new private destination outside selected roots. Retain the exact profile,
entrypoint catalogue and configuration files before publishing a compatible
`inventory.json`. Preserve IDs, selected absolute paths, configuration hashes
and assessment metadata in that selection. The root-set command preserves its
exact bytes. Retain this whole inventory package with the recovery point's
protected configuration; selecting roots does not copy configuration separately.

Reuse current privacy, streaming hashes, finite deadlines, file and directory
sync, exclusive destinations and last-receipt publication. Recheck every source
configuration, profile and entrypoint catalogue before publication. Require an
operator-declared maintenance interval, exit 0 and independent package verify.
Verification uses retained bytes without needing the original machine or roots.
Failures remain private and are not reused. Only the declared files are copied;
no database, Storage object or worker root is captured by this command.

## Evidence boundary

Test real private files, mutation refusal, complete catalogue assessment, shared
and historical roots, exact configuration custody, source changes, durability,
deadline, relocation and controlled diagnostics. Each changed test needs a
harmless control and an intended broken variant. Full-root capture continues
through the existing root-set command; complete recovery continues through the
existing packet and native restore checks. Test records and catalogue coverage
do not establish live writer fencing, correct operator declarations, every
installed external service, useful 45-minute computation, separate-hardware
recovery, clean commissioning, scientific acceptance or public readiness.

Hosted coordination and the main merge hold remain with the relaunch owner.
This lane changes no worker contract, deployment configuration or schema.
