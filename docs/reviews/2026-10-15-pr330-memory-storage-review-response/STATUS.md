# Correct the three storage findings before operation

The independent storage review at `cd9663d7133689b820e4aa2339eb3c66a97c9490`
finds three P2 defects in the preparation-only `97c310944` draft. Root reads
the full report, probes and readback driver. Thirty candidate hashes, five
review-file hashes and both public/private result copies match actual bytes.
The tracked link appears unchanged in old72 and accepted sourcef0. Source
inspection also confirms that the helper writes stage records below the
volatile root before the later durable archive.

The findings are accepted for correction. The archive must retain the exact
tracked symlink map without following targets. Build and startup must see
controller and seal files through a read-only root, with narrow writable
candidate and execution mounts. External mutators need exclusive durable
intents and returned-identity records before proceeding, including failure
and lost-acknowledgement custody. Fsync of a tmpfs file does not provide
reboot persistence. The admitted archive and manifest hashes also belong
in the durable startup intent.

The existing final-binding-r2 preparation task receives these findings as
in-flight steering. No duplicate implementation or review task starts. Its
accepted source remains `f0cbeddff5ae3fc37e0dd8b91c02601429d977a6`, app tree
`a13c491da3ad3ba5b237ca5fa8802b236c4ef27b`. A fresh independent final review
must assess the corrected revision and affected harmless/fault controls.
The earlier storage review approves no operation.

Root does not repeat the review specimens. They use small disk fixtures in
private namespaces; they do not establish real tmpfs page attribution,
application loading, runtime capacity or crash recovery. The third finding
follows from source and storage location, without a reboot experiment.
Earlier failed reviewer harness attempts remain retained.

The proposed preview root stays unallocated. Durable disk capacity remains
insufficient and npm download-cache cleanup approval remains pending. No
cache deletion, database/helper/application/build/start/browser/hosted operation
or new release occurs. Candidate420 versus last verified hosted418 remains
a promotion hold. Native target full catalog preservation remains unaccepted
with cause unknown. PR330 stays watched on pushed sourcef0; these review
records stay local until a later verified checkpoint to avoid a docs-only
CI restart.


## Final independent review accepts the corrected preparation

Candidate `2545bb5e8` implements the three required corrections and binds exact
sourcef0/application tree a13. Independent review `77da95d6373fcb3cbd83eed728611a96f2322364`
finds no new P1/P2 defect and confirms R1, R2 and R3 are addressed. Root reads
the complete report and both private drivers, checks all seven review evidence
pins and compares the two public/private review results. Earlier parent readback
separately matches 42 runtime inputs, 43 hash edges, 420 migrations, 44 public
pins, ten public/private reports and the preparation archive hash.

Root accepts this exact preparation design at its stated evidence tier. This
is not operating admission. About 238 MB remains free against 4,597,706,396 bytes
required; actual capacity still refuses. Cache cleanup approval remains pending.
No admission file or real preview allocation, database/helper/application stage,
build/start/browser journey or hosted change occurs. Current CI has not been
accepted, and the 420-versus-418 promotion hold remains. These preparation/review
records stay local so a documentation push does not restart the watched CI.

The review checks actual Git modes, blobs and sizes for 17,349 source entries,
without rehashing all 528 MB of source content. It streams 421 regular members
in the 665-member preparation archive. It does not extract or restore that
archive. Retained helper descriptors remain dated metadata, not fresh health.
The disclosed preparation readback pressure, native catalog difference with
unknown cause and all historical/frozen acceptance boundaries remain visible.
