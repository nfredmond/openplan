# Retain image slots derived from the original ZIP

The existing local source candidate retains the original ZIP. Engine intake also
needs a durable ordered mapping to each selected member's actual bytes. This
M3/M5b.2 step reuses that source custody before opening the archive. It preserves
the original admission, actor/context and raw archive size/hash. No URL fetch,
image decoding, engine request, runtime dispatch or authority assertion runs.

Before the standard ZIP reader builds its index, inspect the archive's bounded
footer and central-directory records. Count actual records rather than trusting
the declared count. Support contiguous single-file ZIP and ZIP64 directories;
refuse unsupported spanning or prefixed layouts. Explicit metadata, member-count,
expanded-byte and elapsed-time limits persist with the original derived plan.
The raw archive stays available in its original retained source set.

Reject noncanonical paths, repeated members, encrypted entries and special-file
members. Select the existing intake image extensions and sort original paths.
Each selected member receives a distinct fixed image-slot filename, so equal
basenames in different archive folders cannot overwrite each other. Keep the
original member name and archive metadata in the plan. Extensions do not prove
that the content is imagery or that a planner may use it.

Hash actual decompressed bytes before publishing the original derived plan.
Publish each verified copy to its fixed slot only after file synchronization.
Retain interrupted plans and partial files. Recovery verifies existing slots and
creates only missing slots from the exact retained original archive. Publish the
derived manifest after all slots match. Complete replay needs no original URL or
download file. No changed archive, actor, mapping or limit can replace that plan.

Tests need harmless and targeted source controls. Native proof must interrupt
actual slot publication, capture stopped roots, resume a fresh copy and compare
all original identities, bytes and logical journal records. Kernel I/O, physical
power loss, distributed locking, image accuracy, largest-job capacity and full
worker recovery remain separate. Engine-journal integration follows this byte
boundary; it must verify the derived set rather than accept a custody boolean.
Main merges remain held pending explicit relaunch, guidance and Opus clearance.
