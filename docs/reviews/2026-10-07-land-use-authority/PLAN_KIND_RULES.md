# Plan-kind rule correction

October 7, 2026. M1 requires distinct general-plan and specific-plan rules. The
installed family descriptor currently gives both kinds the general-plan
checklist. This checkpoint prepares a selector and the distinct specific-plan
data. Existing routes and forms do not yet call that selector. It is not a
completed workflow, a release or a legal-compliance finding.

## Source review and its limits

The official [Government Code section 65451](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65451)
requires detailed text and diagrams covering land uses, supporting facilities,
development and applicable resource standards, implementation and financing.
It also requires the relationship to the general plan. These become five
separate content requirements. They do not become the general plan's seven
mandatory elements.

[Section 65454](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65454)
requires consistency with the general plan for adoption and amendment.
[Section 65450](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65450)
places the specific plan after an adopted general plan.
[Section 65456](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65456)
distinguishes public inspection after adoption from furnishing requested copies.
Those official section pages were retrieved successfully in this pass.

The [section 65358 page](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65358)
also responds. Its general-plan amendment limit has exceptions and does not
define the specific-plan rule. The direct section 65453 endpoint and Article 8
page return access errors in this pass. LCI's currently linked
[2017 guidelines, chapter 9, pages 239–240](https://lci.ca.gov/wp-content/uploads/OPR_C9_final.pdf)
explain section 65453: a specific plan may use a resolution or ordinance and
may be amended as often as the legislative body finds necessary. Repeal follows
the amendment procedure. This is issued guidance corroborating the earlier
[October 7 Article 8 review](PLAN_CONTEXT_DESIGN.md), not a successful new
retrieval of section 65453. Its direct-source access limit remains explicit.

The [LCI guidance index](https://lci.ca.gov/planning/general-plan/guidelines/)
identifies the 2017 comprehensive edition and later advisories. The ongoing
guideline update is not an adopted replacement. This pass does not re-review
every general-plan content provision, referral exception, consultation trigger,
environmental procedure, local overlay or housing duty. Accordingly, the new
specific-plan selection preserves the family's earlier review date. Changing
its content is not grounds to label every inherited duty reviewed today.

The specific-plan implementation update is explicitly an agency process choice.
It has no automatic April 1 deadline and does not replace separate general-plan
reporting duties. Required content and approval prerequisites remain distinct
from a claim that software can decide statutory sufficiency.

## Selection and historical records

The shared selector receives a family, kind and adapter variants. It rejects
unknown kinds, different family IDs and a variant that does not cover the kind.
It returns detached data containing the selected kind alone. California names
and rules stay in the registry. Neutral and arbitrary synthetic adapter cases
exercise the same selector without geographic branches in the shared function.

Selection keys encode both identifiers as a tuple, avoiding delimiter collisions.
Different kinds produce different reviewed hashes. Frozen-reader tests preserve
an older two-kind descriptor exactly, including its historical general-plan
content for an area plan. That is evidence of preservation, not endorsement of
the old checklist. A new source selection cannot rewrite previously reviewed
bytes or assert that the old content met current requirements.

## Verification

The [focused baseline](plan-kind-rules/focused.log) passes 19 tests. The
[land-use regression](plan-kind-rules/regression.log) passes 470 tests; five
native suites are skipped in that ordinary run. This change adds no migration
or database call. The [controls](plan-kind-rules/controls/report.json) pass
baseline and harmless cases, then detect 18 targeted faults. Source bytes are
restored after every case. The controls protect selection, specific-plan content
and procedure declarations, detached data, tuple keys and frozen-reader behavior.
They cannot establish legal sufficiency or prove that routes use the new selector.
TypeScript and changed-file ESLint pass. No new database or browser acceptance
is claimed for this unused selector checkpoint. [Source-access notes](plan-kind-rules/sources.json)
preserve the retrieval boundary.

## Required connection work

This remains part of roadmap M1. The implementation must connect one selection
to creation, current draft reads, content/applicability validation, process
choices, freeze checks, adoption checks and legacy public references. Current
creation and freeze receipts must still replay before any new rule lookup.
The creator needs hashes for each family/kind pair and another review after a
kind changes. Frozen public packets continue using their retained rules.

Existing specific-plan drafts have sections made from the older general-plan
checklist. An explicit reconciliation path must preserve their text, maps,
evidence and earlier versions while adding the correct requirements. Existing
applicable keys cannot hide newly required content. The workbench needs to
distinguish current rules from a frozen version's rules, rather than displaying
new terminology as if it were reviewed with the older version.

The selector alone does not satisfy these jobs. Before landing the visible
correction, test fresh creation and an older draft, original and amendment
versions, changed rules, interrupted requests, cross-workspace authority and
frozen/public/export agreement. Native permission, rollback and concurrency
checks remain separate from identified desktop/390px, console and artifact
acceptance. Practitioner and counsel review of the claimed scope remains open.

## Subsequent connection checkpoint

The [connection work](PLAN_KIND_CONNECTIONS.md) now calls this selector from current routes, preparation and the creator. This supersedes the earlier unused-selector status, while retaining its source-review limits. Explicit reconciliation of older working drafts, native evidence and rendered acceptance remain open.
