# Bind a retained local recovery packet

The selected worker-root set is now verified, but the published default-local
backup procedure still leaves operators to bind database, Storage, protected
configuration and worker state manually. Add an offline command that seals an
already retained private packet. Reuse complete private file/directory inventory
and worker-root-set verification. Do not change running services, worker protocols,
database capture or hosted configuration.

The packet contains an exact private `point-inventory.json` declaration. It names
the database archive, Storage archive or byte directory, cluster roles, database
root key, protected configuration directory and worker-root-set directory. Bind
all declaration bytes, every ordinary packet file, all paths and private modes.
Require every declared item and a valid complete worker-root set. Treat database
and Storage bytes as retained artifacts; hashing is not a successful native
restore. Explicitly leave installation consistency unassessed.

Before final publication, sync all retained files and directories, compare the
complete packet with its initial inventory and recheck the worker-root set.
Publish a private receipt last, without overwriting any completed or interrupted
receipt. Require exit 0 and later verification. The verifier must use only the
retained packet, reject extra or missing files and verify the nested worker set.
Its manifest hash belongs in the protected encrypted backup authority. A manifest
does not authenticate itself or establish which installation items were omitted.

Test actual private packet paths and a native worker-root-set fixture. Exercise
missing declared artifacts, unsafe declaration paths/types, changed bytes/modes,
source changes during publication, invalid nested sets, incomplete and uncertain
publication, extra files and relocation without original worker paths. Opaque
test database/Storage fixtures do not establish database or Storage acceptance.
Every new test and guard needs harmless survivors and selected broken behavior,
with exact source restoration in finally. Run checks serially under memory limits.

The native continuation uses fresh copies of the accepted full point and the
five-root set. Preserve both originals. Seal and verify the complete packet,
encrypt through the existing verified free Restic binary, check all encrypted
data, restore into a fresh directory, verify the packet and independently compare
every retained file/path/mode and native journal record. Do not start a database
or worker for this transport check. Existing native database recovery remains
separate evidence. Same-host disks, declared quiescence, installation-wide
coverage, physical-host recovery, browser and scientific acceptance remain open.
