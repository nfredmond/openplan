# Geographic exclusion addendum, 2026-10-23

This additive decision precedes both model runs and any TBI outcome access.
The frozen source, preregistration, split and prior result records remain unchanged.

Masking MVTA transit endpoints alone is insufficient. It would leave households
and destinations in the mode-choice domain while representing missing MVTA
service as unavailable transit. The integration therefore preserves the full
704-zone source archive and derives one shared 638-zone runtime bundle for both
coefficient arms.

The derivative excludes the 66 zones identified in
`integration-evidence/coverage.json` by positive-area intersection with the seven
published MVTA member cities. It removes resident synthetic households and all
their persons, removes those destinations, and slices every skim matrix by the
same ordered zone positions. It does not renumber the source zone IDs. The
existing ActivitySim zero-based input recoding applies at runtime. No coefficient,
weight, source population record, frozen assignment or outcome changes.

The parent population remains a seven-county population. The derivative manifest
records exact parent and retained synthetic counts, excluded zone IDs, matrix
positions, source and output hashes, and the exclusion reason
`mvta_member_city_overlap_service_missing`. It is a direct CLI preparation
artifact, not an assertion that the full common-population manifest describes
its smaller geographic domain.

This conservative member-city exclusion does not identify every trip that uses
MVTA outside its member cities. The frozen roster exposes county only, so
MVTA-dependent TBI household and trip exclusions remain uncomputed. Unknown
counts remain null. The lead must resolve that eligibility boundary before any
frozen opening. Both arms remain preparation runs, regardless of completion.

The generic helper tests cover ordering, whole-household conservation, parent
preservation, destination and matrix removal, and invalid-input refusals. They
do not establish historical MVTA route coverage or scientific admissibility.
