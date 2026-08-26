# Technical records index

Files in this directory are dated evidence: they preserve what was observed,
tested, accepted, or rejected at the time. They are not the development queue
and should not be rewritten to match current behavior.

Current sources of truth:

- `docs/ROADMAP.md` — the only active development queue.
- `CHANGELOG.md` — shipped operator-visible behavior and migration order.
- `openplan/docs/SELF_HOSTING.md` — current operating instructions.
- `openplan/docs/ops/BACKUP_AND_RESTORE.md` — current recovery procedure.
- `docs/ops/KNOWN_ISSUES.md` — current quality boundaries and recovery cadence.
- `docs/ADRs/` — durable architecture decisions.

## By period, as of 2026-08-25

| Period | Count | What it covers |
|---|---|---|
| 2026-03 | 60 | Modeling architecture, engine and network specs, zone/corridor/connector contracts, the county-onramp contracts, LAPM and stage-gate provenance, the Nevada and Placer validation era. |
| 2026-04 | 1 | County containment rerun. |
| 2026-05 | 3 | Caveat-gate and KPI SQL proofs, county-run manifest proof UI. |
| 2026-07 | 17 | Grants/BCA/TDM screening, grants.gov live sync, the modeling 1.1 arc, wave hardening, the first local browser walks. |
| 2026-08 | 19 | Local smoke records per module, the v0.27 land-use correction, v0.31/v0.32 browser and mutation proofs, operational health proof, and the independent Claude v1 review. |

Files here are cited by path from shipped code and from `COMMENT ON POLICY`
statements in applied migrations, so they are not moved into subdirectories. A
migration is history; rewriting one to chase a moved file would falsify a
shipped record.

## Evidence groups

- Modeling architecture and specifications: the March 2026 engine, network,
  zone, corridor, worker, skim, and evidence records.
- Modeling validation: dated Nevada and Placer screening studies, later
  nationwide count evidence, rejected candidates, and calibration results.
  Negative results remain evidence and do not become future work by default.
- County validation onramp: the March contract records and May proof UI.
- Planning and legal provenance: stage-gate, reimbursement, plan, adoption, and
  jurisdiction source records.
- Release and browser proof: dated local smoke, first-week, RLS, mutation,
  build, and release evidence.

Git history is the archive for deleted implementation queues. ADR-004 preserves
the MCP server decision; MCP/Buzz scheduling lives only in the canonical
roadmap.
