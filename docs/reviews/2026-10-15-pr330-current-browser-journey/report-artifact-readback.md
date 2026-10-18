# Actual report artifact readback, October 15, 2026

The downloaded HTML exactly matches the stored artifact's `metadata_json.htmlContent`. Both synthetic jurisdiction declarations remain unverified and unassessed. The earlier readiness download and the report differ only in project revision and their corresponding payload hash. A separate geography sentence creates a wording concern.

## Identity and input custody

The lead operator supplied PR330 head `f0cbeddff5ae3fc37e0dd8b91c02601429d977a6`, app commit `a13c491da3ad3ba5b237ca5fa8802b236c4ef27b` and BUILD_ID `Z9s8u410cuLfXdEF5aeoi`. This readback does not independently attest the running build. Saved metadata records OID `6181197`, report `0ba0720e-8a6b-4f1c-ac90-379ae161a9f1`, artifact `b1c5b9d1-2249-4086-8bd3-5538e33d9c3a` and project `a5b3eaad-7aa4-4693-b56a-3c77cc606abc`. The report is generated; the artifact kind is HTML. Generation time is `2026-10-16T03:14:43.694+00:00`, October 15 at 8:14 p.m. Pacific time. UTC falls on October 16; the records retain that date.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Downloaded HTML | 43053 | `ae40a50aad7b4480476e2768e0038132c5f5aa92e9e640f8058fdfe0f593b500` |
| Saved native metadata | 81265 | `b1bacef600a4e5af01668328b6e62f2c2bc4fce3c2a23afbe58bfd7cfe301ba3` |
| Earlier readiness JSON download | 13892 | `6e353130edfbc2534221615de1af98bab959c3ff4dd7149c196052727a1f7973` |

The saved metadata hash matches the lead operator's supplied hash. The HTML comparison uses literal UTF-8 bytes, without HTML normalization. Input paths and source-file hashes appear in `report.json`. The readback does not copy signed URLs, actor identifiers, raw HTML or raw metadata into its outputs.

## Declaration and readiness comparisons

The report uses schema `openplan.project-jurisdiction-readiness-export.v3`, scope `external_handoff`, and context source `project_declaration`. Its exported declaration records `2026-10-16T03:13:15.292076+00:00`. Both context entries match the lead operator's expected labels, kind, scopes, identity and null reference/country/subdivision fields. The report and earlier readiness JSON retain equal context, readiness entries, disclosure, attribution, project identity, schema, scope and registry values. External declaration context omits the internal actor identifier.

| Declaration | Scope | Identity | Assessment |
| --- | --- | --- | --- |
| Synthetic UI sovereign context, unverified | sovereign | staff_declared | All five cells unassessed |
| Synthetic UI overlapping context, unverified | overlap | staff_declared | All five cells unassessed |

All ten cells retain no registered evidence sources. Both assessment identities have null country, subdivision, identifier and assessment kind. Neither entry substitutes administrative guidance. HTML text contains both labels, both scope readouts, ten `Not assessed here` labels and ten `No evidence-backed claim is registered for this cell.` statements. It retains the legal-applicability and adopting-authority disclosure.

## Revision and hash differences remain explicit

| Field | Earlier readiness download | Frozen report |
| --- | --- | --- |
| projectRevision | `2026-10-16T03:13:15.292153+00:00` | `2026-10-16T03:14:23.894167+00:00` |
| payloadSha256 | `ae7c988ab310e552af91c434deca50ccac305fafe19a795a3fc7af1e62f90c4d` | `18c8c2c527fecc41515e021c361fd7c1612a1d06c7a56890ec7db3cfd6f3afd6` |

Full payload equality is false. These are the only differing top-level keys. The report's revision equals `sourceContext.projectUpdatedAt`. This readback does not establish what changed the project revision. Each payload's canonical SHA-256 recomputes exactly after excluding its own `payloadSha256` field. Recalculation follows the inspected recursive key-sort specification; it does not import or execute project code.

Registry version `2026-10-11.1` and registry hash `531dca87cc6621786d4cff27b0fb52dd5b99105c3a78c6307a9a35322201c158` match both payloads. SHA-256 of the parsed shipped registry serialized with `JSON.stringify` recomputes that hash. The raw file has a different hash because file formatting is not the registry hash contract.

## Geography stays separate; one sentence needs review

Oakland appears in the separate project geography section and its accessible figure description. It does not appear in the jurisdiction section. No jurisdiction assessment inherits Oakland or its country/subdivision.

The actual geography text nevertheless says, "so the boundary, the county filter and the jurisdiction can all be re-derived from it." Source is `candidate/openplan/src/lib/reports/geography-figure.ts:367`. This phrase could imply jurisdiction inference from the searched study place. The report's jurisdiction payload does not make that inference. This is an unresolved wording concern, with no source fix in this review. The report does not establish adopting or legal authority.

## Limits of this review

The structured metadata reports zero linked runs, zero cited model runs, zero cited county runs, zero modeling evidence records and no modeling claim statuses. HTML says `Modeling evidence 0` and `Modeling claim posture Not linked`. This synthetic packet is not scientific validation or an evidence-backed capability acceptance.

- No DB calls: the saved native metadata record is input evidence, not an independent live database observation.
- No browser or render calls: HTML text/bytes do not establish desktop or 390px layout, navigation, accessibility, console state, native application behavior, or human acceptance.
- No independent live build attestation: head, app commit, BUILD_ID and full schema posture come from the lead operator.
- No underlying scientific outputs were inspected; this synthetic project has no linked/cited model evidence and does not establish scientific validity or evidence-backed capability.
- The current full schema does not exercise the missing-column schema_pending runtime branch.
- The earlier readiness download and frozen report use different project revisions; neither hash can substitute for the other. The cause of the revision change is not established by these artifacts.
- No fresh direction review, release acceptance, legal applicability or adopting authority is declared.
- No tests, test guards or mutation harnesses were authored or run. Direct byte, field and digest comparisons could expose mismatches and did expose the revision/hash difference.

Only the new private readback directory is written. Directory mode is 0700; report files are 0600. No source, checkout, Git, database, browser, service, provider, network, dependency or native GUI operation occurs in this review.
