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
