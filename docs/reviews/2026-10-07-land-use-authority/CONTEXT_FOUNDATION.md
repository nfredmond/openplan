# Plan-context validation and storage preparation

This checkpoint implements the data contracts in [the M1 design](PLAN_CONTEXT_DESIGN.md).
The create/edit/freeze routes and the interface are not connected yet. The
workspace-home gate therefore remains in the running application. No cross-client
workflow or M1 completion is claimed here.

## Implemented boundaries

A staff assessment names its responsible bodies, their roles, declared kinds,
jurisdiction, supporting URLs and the subset to which the selected checklist
applies. Neutral work preserves unresolved or unsupported bodies. A configured
checklist requires an explicit staff assessment, cited authority references and
adapter coverage for every selected body. Other listed bodies retain their own
roles without silently inheriting that checklist. These are attributed staff
statements, not verified legal findings or proof of a body's powers.

The California adapter declares city/county scope. Shared code contains no list
of US states or California authority names. This uses the existing descriptor's
stated scope; it does not refresh its source-review date or complete the pending
general/specific-plan rule correction. The authority-kind metadata is also
retained by the frozen-descriptor schema. Existing frozen editions remain
unchanged. Reconciling a changed installed descriptor remains necessary before
this wider M1 work can be accepted.

A selected study place is re-resolved through the existing server resolver. The
returned kind and ID must match the request; resolver failures do not become
empty or guessed geography. Resolver identity, extent and geometry stay with the
place. Drawn and uploaded areas preserve separate capture sources and null
jurisdiction/identity fields. The existing WGS84/ring validator rejects projected
coordinates and open rings. This check is not complete topology validation.

The context command refuses client-supplied attribution. Preparation assigns the
server caller and time. Reading stored context distinguishes historical null,
invalid/missing projection and a valid retained copy. The route still needs to
supply its authenticated actor; these helper tests do not establish endpoint
authentication or database attribution enforcement.

The additive migration defines nullable context and a generated hash on the plan
row. Its native probe runs only in rolled-back transactions on the isolated
restore target. No persistent column or fixture remains from that probe. This is
storage preparation, not a deployed schema change or an accepted write path.

## Verification

All 130 tests in 13 land-use suites pass. Full TypeScript and changed-file ESLint pass. The new suite has 21 tests covering
configured/neutral scope, multiple selected bodies, sovereign-kind refusal,
country and subdivision matching, duplicate/dangling references, required
sources, attribution, resolver errors, source capture and historical absence.

The [application controls](context-foundation/controls/report.json) include a
passing harmless comment and 21 detected faults. All changed source is restored
byte for byte. An earlier country test changed both country and subdivision,
masking the country fault. The revised case keeps the subdivision text equal so
country matching must carry the rejection. The source-URL case also now tests
an unsafe URL separately from an empty assessment-source list.

The [database controls](context-foundation/migration-controls/report.json) prove
valid DDL, nullable legacy context, generated hashing, missing-place refusal and
nonempty authority structure. Removing null-safe CHECK handling or replacing
the generated hash with a constant fails its intended assertion. The initial
missing-fields probe removed several fields together; remaining NOT NULL-style
conditions masked the nullable CHECK defect. The corrected probe removes only
the place, and detects the defect. No acceptance assertion was removed.

The storage check is deliberately shallow. RLS, trustworthy database attribution,
concurrent context/freeze behavior, actual route writes, browser recovery and
public/exported version agreement remain unproved and must be implemented or
verified before this branch can claim the plan-owned context workflow.
