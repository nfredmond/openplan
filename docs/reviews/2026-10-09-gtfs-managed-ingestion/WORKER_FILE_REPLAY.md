# Terminal recovery from encrypted-backup-restored worker files

The [file-only backup](WORKER_FILE_BACKUP_PLAN.md#completed-file-only-probe)
retains an encrypted Restic snapshot of the stopped CTA worker. This follow-on
copies that verified restoration into another private root and runs the actual
owned-attempt coordinator in fresh Node processes. It does not change the worker
contract or installation identity. Application source is frozen bf1f6ffa; the
original files and parser output were produced at ba1b497f.

## Native results

[Nine native cases](worker-file-replay-20261011/result.json) pass. Cached receipt,
harmless extra configuration and final restored cases read the native claim and
attempt before returning the retained completion. The uncertain-reply case
marks only the copied terminal record unresolved, retaining its exact payload,
identifier and attempt. The native completion RPC returns the original receipt
and restores the copied record exactly. No work callback runs in any case.

Changed target and installation refuse before an RPC. A wrong original actor
refuses before an RPC. A changed retained terminal actor reaches claim/read,
then refuses before completion delivery. A changed byte in the copied archive
refuses before an RPC. Mutated terminal and archive bytes restore in finally.
The original worker root and the backup restoration receive no writes.

The probe checks the restored private archive and parser hashes before replay.
The actual parser-output decoder agrees on 132 routes, 11,138 stops and 5,920,320
stop-time rows. These remain published-schedule parser counts. Native calls use
the original claim arguments; the uncertain case additionally calls
`complete_gtfs_ingest`. Public observations retain argument hashes without tokens.

Independent native reads compare all 18 transit tables before and after every
case, and again after the service ends. Counts and complete-row hashes agree.
The final relocated worker copy also matches all 787 original file names, bytes
and modes. These comparisons cover original claims, completion receipts, saved
submissions, archive cleanup state, feed/version pointers and derived rows.

The serial service exits zero after 118.077 seconds of reported wall time. It
uses 1 GiB, no swap and one CPU; its journal reports a 947.6M peak. The owned
service is inactive afterward. No other service stops and no database resets.

## Controls and preserved boundaries

[Scope controls](worker-file-replay-20261011/scope-controls.json) pass three
positive cases, six broken scope refusals and six omitted-guard oracle failures.
They extract the actual runner guards before native access. Separate
[result controls](worker-file-replay-20261011/result-controls.json) pass three
positive and 17 broken observations at their intended assertions. They challenge
source/snapshot identity, repeated computation, native call sequence, cached
versus native reply, parser counts, file/database changes and refused writes.
Those controls change copied observations, not the app or native records.

The retained Python and Node runners support source review. They retain exact
local fixture paths and are not a customer installation or recovery recipe.
Private configurations, command tokens, raw journals, archive and parsed source
bytes remain outside the repository.

This advances terminal recovery after restoring external files. Both file copies
remain on the same physical host. The server is the original isolated recovered
installation, not a database restored together with this worker snapshot. The
trial does not establish a coordinated database/Storage/configuration point,
SQLite/WAL capture, physical-host loss, a new parse, installed queue commissioning,
either demand model's computation, agency acceptance or scientific validity.
Continue those distinct requirements in M3. Nathaniel confirms that the relaunch
agent retains hosted coordination and the main-merge hold.
