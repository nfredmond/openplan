# ADR-001: Canonical Repository for OpenPlan

## Status
Accepted (2026-02-21)

## Context
Development has occurred across multiple repositories (`SaaS`, `Saas.Claude`, and other experiments), creating fragmentation, duplicated logic, and inconsistent architecture.

## Decision
Adopt **`/mnt/c/Users/nfred/code/Saas.Claude/openplan`** as the canonical product codebase.

## Consequences
### Positive
- Single source of truth for architecture and roadmap.
- Faster delivery with reduced context switching.
- Clear migration path from prototype to sellable SaaS.

### Negative
- Some existing features in `SaaS/saas-platform` must be ported instead of reused directly.
- Requires short-term consolidation effort before net velocity improves.

## Implementation Notes
- Freeze net-new feature work in non-canonical repos.
- Port useful UX/report features through tracked backlog issues.
- Archive legacy repos after parity milestones are met.
