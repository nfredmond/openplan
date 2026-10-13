# Retain a declared set of private worker roots

The supported root command captures one selected root. An installation operator
still assembles several roots manually. A source can change after its individual
snapshot while another root is being copied. The private configuration that
selects those roots also needs exact retained bytes and a protected binding.

Add a Python command that accepts a private JSON inventory, preserves those exact
bytes before copying roots, and delegates each component to the existing root
operator. Inventory entries name a safe package ID and an absolute source path.
Keep opaque metadata in the original inventory bytes. Refuse duplicate IDs,
resolved duplicate or overlapping source roots, aliases and unsafe destinations.
An explicitly empty selection remains zero selected roots, not proof of no
configured installation workers.

Inventory every selected source before component capture. Compare each component
with that initial durable inventory and recheck all selected sources at the end.
Reuse the root operator's explicit SQLite normalization and recognized reader
sidecar rules. Preserve complete ordinary paths, modes and bytes. A changed
inventory file or observed durable source change refuses the set. Nested component
receipts cannot establish set completion when the final set manifest is absent.

Publish the set manifest last, with the exact inventory binding and every component
manifest hash. Require files/directories/parent sync and a fresh private destination.
Verification must operate on the package alone, including after original source
paths become unavailable. Bind every declared ID, original declared path, component
source identity and component hash. Refuse missing or extra packages and changed
inventory bytes. Keep the immutable set unchanged when copying roots for recovery.

This covers the explicitly selected set. It does not discover omitted roots,
stop or fence writers, prove a simultaneous atomic cut, align PostgreSQL/Storage,
encrypt a package, resume computation or complete independent agency installation.
The installation consistency claim remains unassessed. No worker protocol,
scientific method, hosted deployment, migration or main merge changes.

Tests use actual private roots and native SQLite/WAL records. Include source
changes after an earlier component finishes, changed inventory bytes, failed later
components, incomplete publication, alias/overlap/reuse refusals, zero selection,
self-contained verification and corrupted component/mapping bindings. Every changed
test and guard needs harmless survivors and targeted broken behavior with source
restoration in finally. Run memory-limited checks serially. Preserve failed native
trials and the T3 host-disconnection boundary from the previous checkpoint.
