# Land-use plan jurisdiction research

Reviewed 2026-08-23. This note uses only official legislative, Navajo Nation, and federal sources. It verifies the requested registry facts. It does not establish that any plan is legally sufficient, and it does not by itself establish that a California bundle is complete. Housing-element law, open-space law, CEQA, local charters, notice law, and every cross-referenced consultation rule would need their own source review before OpenPlan could describe the California bundle as complete.

## California general plans

### Verified requirements

- Each California city and county must adopt a comprehensive, long-term "general plan." The plan may be one document or several documents, and elements may be combined. State law intends the whole plan to be integrated, internally consistent, and compatible. [Government Code §§ 65300-65301](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=5.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.)
- The statutory element list is land use, circulation, housing, conservation, open space, noise, and safety. The plan must address each subject to the extent it exists in the planning area, but that qualification does not relax the housing-element requirement. The plan must contain diagrams and text setting out objectives, principles, standards, and proposals. [Government Code §§ 65301 and 65302](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65302.)
- Environmental justice is conditional. If the planning area contains a disadvantaged community, the jurisdiction must either add an environmental-justice element or integrate the required goals, policies, and objectives into other elements. The adoption or review trigger is concurrent adoption or revision of two or more elements. [Government Code § 65302(h)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65302.)
- Some place and event conditions attach requirements to existing elements rather than create another element. For example, cities and counties in the San Joaquin Valley Air Pollution Control District must add specified air-quality material to appropriate elements and send draft amendments to the district at least 45 days before adoption. [Government Code § 65302.1](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65302.1)
- Preparation or amendment must offer public-involvement opportunities, including public hearings. Before adoption or substantial amendment, the planning agency refers the proposal to listed public bodies and affected entities, which generally receive 45 days to comment. [Government Code §§ 65351-65352](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=6.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.)
- Before adoption or any amendment, the city or county must consult California Native American tribes on the Native American Heritage Commission contact list for the specified preservation and mitigation purpose. A contacted tribe has 90 days to request consultation unless it agrees to less time. The city or county must protect confidential information about the identity, location, character, and use of covered places, features, and objects. The statute defines consultation as a mutually respectful process that recognizes sovereignty and confidentiality needs. [Government Code §§ 65352.3-65352.4](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=6.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.)
- If a locally authorized planning commission reviews the proposal, it must hold at least one noticed public hearing and send a written recommendation to the legislative body. The legislative body must hold at least one noticed public hearing. It adopts or amends the plan by resolution with at least a majority of its total membership. [Government Code §§ 65353-65356](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=6.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.)
- Adopted documents, including diagrams and text, must be available for public inspection within one working day. [Government Code § 65357](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65357.)
- A mandatory element generally may not be amended more than four times in a calendar year. Each amendment may contain more than one change. Section 65358 lists exceptions, so "four" cannot be a simple unconditional counter. [Government Code § 65358](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65358.)
- A specific plan implements an adopted general plan for all or part of its area. It must state its relationship to the general plan and cover land use, infrastructure, development and conservation standards, and implementation measures. It follows the general-plan preparation process, but may be adopted by resolution or ordinance and may be amended as often as the legislative body considers necessary. A specific plan must be consistent with the general plan. When a general-plan amendment affects the same area or subject, the city or county must review the specific plan and amend it as needed for consistency. [Government Code §§ 65359 and 65450-65454](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=8.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.)
- By April 1 each year, the planning agency must send an annual report to the legislative body, the Office of Land Use and Climate Innovation, and the Department of Housing and Community Development. It must cover plan status and implementation progress plus the detailed housing and other items in section 65400. The housing portion is considered at an annual public meeting that accepts oral testimony and written comments. [Government Code § 65400](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65400.)

### Registry inferences

- Model the seven named elements as descriptor content requirements, not shared enum values. Model environmental justice and San Joaquin Valley air-quality rules as conditionally triggered requirements with source citations.
- A process step needs an applicability rule. A planning-commission hearing is conditional on the local body and its authority; the legislative-body hearing is not. Likewise, a deadline needs a start event, duration, and exception or override rule.
- Store the decision body, vote, adoption instrument, adopted artifact, and exact frozen version hash. OpenPlan can verify that the record is complete and internally consistent. It cannot decide that statutory findings or the plan itself are legally adequate.
- Treat tribal-consultation status and non-sensitive dates as structured records. Keep consultation content and cultural-resource locations private by default. The source itself creates the confidentiality duty.
- A specific plan is a related plan with its own instrument and amendment rules. It is not an element of the general plan and should not inherit the general plan's four-amendments-per-year rule.

## Washington comprehensive plans

### Verified requirements

- The Growth Management Act requirements apply to counties and cities that must or choose to plan under RCW 36.70A.040. A descriptor must test that applicability before presenting the element list as law. [RCW 36.70A.040](https://app.leg.wa.gov/rcw/default.aspx?cite=36.70A.040)
- For those jurisdictions, the plan contains maps and text, must be internally consistent, and all elements must be consistent with the future land-use map. RCW 36.70A.070 names land use, housing, capital facilities, utilities, transportation, economic development, parks and recreation, and climate change and resiliency. Counties also need a rural element. A city that has chosen to be a residential community is exempt from the economic-development element. The resiliency subelement is mandatory for all Growth Management Act jurisdictions, while the greenhouse-gas subelement applies only to the jurisdictions identified in RCW 36.70A.095. [RCW 36.70A.070](https://app.leg.wa.gov/rcw/default.aspx?cite=36.70A.070)
- New or amended element requirements enacted after January 1, 2002 are intended to enter plans at the scheduled update. The requirement is void unless the state appropriates and distributes enough money for applicable local costs at least two years before the update deadline. [RCW 36.70A.070(10)](https://app.leg.wa.gov/rcw/default.aspx?cite=36.70A.070)
- A county or city generally sets a public process in which the governing body considers updates and amendments no more often than once each year, with listed exceptions. Proposals ordinarily must be considered together so their cumulative effect can be assessed. [RCW 36.70A.130(2)](https://app.leg.wa.gov/rcw/default.aspx?cite=36.70A.130)
- Periodic review is a staggered ten-year cycle by county group. The current statutory deadlines run from 2024 through 2027, followed by dates in 2034 through 2037 and every ten years after that. The statute also contains small-jurisdiction and implementation-report qualifications. [RCW 36.70A.130(5)-(10)](https://app.leg.wa.gov/rcw/default.aspx?cite=36.70A.130)
- A county or city must notify the Washington Department of Commerce at least 60 days before final adoption and send the adopted plan within 10 days after adoption. The same rule applies to amendments. [RCW 36.70A.106](https://app.leg.wa.gov/rcw/default.aspx?cite=36.70A.106)

### Registry inferences

- Washington disproves a California-shaped shared checklist. Requirements depend on Growth Management Act status, government type, population, county group, local choices, and funded statutory triggers.
- Store the future land-use map as a versioned plan artifact and run consistency review against it, but keep "future land-use map" as a descriptor label. The shared relationship is between a mapped policy artifact and plan content.
- Represent the annual amendment process separately from the ten-year periodic review. They are different clocks with different exceptions.
- Represent pre-adoption notice and post-adoption transmission as distinct steps with distinct deadlines.

## Texas municipal comprehensive plans

### Verified requirements

- A Texas municipality may adopt a comprehensive plan, but Chapter 213 does not require one. The municipality may define its content and design. State law says it may include land use, transportation, and public facilities and may be one plan or a coordinated set organized by topic and geography. The municipality may define the plan's relationship to development regulations in its charter or by ordinance. [Texas Local Government Code § 213.002](https://statutes.capitol.texas.gov/Docs/LG/pdf/LG.213.pdf)
- Adoption or amendment is by ordinance after a hearing where the public may testify and submit written evidence, plus review by the planning commission or department if one exists. A charter or ordinance may add local procedures. [Texas Local Government Code § 213.003](https://statutes.capitol.texas.gov/Docs/LG/pdf/LG.213.pdf)
- A future-land-use map must state that a comprehensive plan does not constitute zoning regulations or establish zoning-district boundaries. [Texas Local Government Code § 213.005](https://statutes.capitol.texas.gov/Docs/LG/pdf/LG.213.pdf)
- Chapter 213 sets no statewide periodic review or amendment cycle. [Texas Local Government Code Chapter 213](https://statutes.capitol.texas.gov/Docs/LG/pdf/LG.213.pdf)

### Registry inferences

- `required_elements: []` is a valid verified state descriptor result for Texas. It means the state statute lets the municipality define content. It does not mean "requirements unknown" and must not cause OpenPlan to insert California's elements.
- Local charter and ordinance sources must layer onto the state descriptor before OpenPlan presents a local workflow as configured. Until then, show a plain "local legal requirements not configured" notice.
- The map disclaimer should travel with every exported future-land-use map. The statute is also direct evidence for the product-wide statement that a future-land-use map is not zoning.

## Navajo Nation and tribal sovereignty

### Verified requirements and source limits

- BIA states that comprehensive tribal community planning is conducted by tribal governments and their citizens, has no single prescribed form, and may cover whatever topics the tribal society considers important. BIA also states that tribes, as sovereign nations, may accept or reject outside recommendations. [BIA, How Comprehensive Community Planning Helps Tribes](https://www.bia.gov/service/community-planning/how-comprehensive-community-planning-helps-tribes)
- The Navajo Nation Office of Management and Budget's Local Governance Act page says a Chapter that wants to administer land must develop a community-based land-use plan from a community assessment. The Chapter acts by resolution, establishes a Community Land Use Planning Committee, uses inventories and assessments, presents the plan at public meetings, allows 60 days for written or hearing comments, and submits the finalized plan for Navajo Nation committee approval. The listed subjects include open space, future land use, thoroughfares, community facilities, and related utilities. The page calls for reevaluation every five years. [Navajo Nation Local Governance Act, Title 26](https://omb.navajo-nsn.gov/Mandates/Local-Governance-Act)
- The same page uses the historic name "Transportation and Community Development Committee." Current official Navajo Nation records show the Resources and Development Committee certifying Chapter plans. A June 2026 record describes Chapter approval by resolution, a Navajo Nation Department of Justice legal-sufficiency determination, and separate Resources and Development Committee certification as final authority. [Navajo Nation Council, Red Mesa Chapter recertification](https://www.navajonationcouncil.org/wp-content/uploads/2026/06/RDC_0110.pdf), [Navajo Nation Council, Manuelito Chapter certification](https://www.navajo-nsn.gov/Portals/0/Press%20Releases/2023/Nov/RDC%20Certifies%20Manuelito%20Chapter_s%20Community%20Based%20Land%20Use%20Plan.pdf)
- The official code portal publishes a Title 26 consolidation only through December 2009 and separately lists amendments. A February 2026 Navajo Nation Council release says the Act was amended seven times between 2005 and 2024 and that further amendments were under public review. The online sources therefore do not support calling a machine-readable Navajo descriptor complete or current. [Navajo Nation Code portal](https://www.navajonationcouncil.org/code/), [2026 Title 26 public-hearing release](https://www.navajonationcouncil.org/wp-content/uploads/2026/02/RDC_holds_public_hearing_on_proposed_amendments_to_Title_26.pdf)

### Registry inferences

- Use the Navajo case only as a neutrality fixture for the first release. Mark its legal configuration as incomplete until OpenPlan checks a current consolidated Title 26 and applicable amendments from an official Navajo source.
- Do not treat a tribe as a county-like jurisdiction under state law. The adopting community, public process, approving body, plan subjects, review cycle, and authority all come from Navajo law and Navajo institutions.
- Body labels must be source-versioned data, not enum members. Keep a stable role such as `certifying_body` separate from its public name.
- The shared process must support Chapter approval and a separate sovereign-government certification, each with its own body, instrument, vote, date, and evidence.
- A tribal descriptor must allow community-defined content, culturally specific participation, sovereign decision bodies, and private or restricted evidence. A generic state or county workflow is not an acceptable fallback.

## Minimum descriptor shape supported by the sources

The following are model-design conclusions, not legal text:

- applicability rules keyed to facts supplied by the workspace, never hardcoded geography checks;
- public terminology for the plan, content units, mapped policy artifacts, process steps, decision bodies, and instruments;
- required, conditional, optional, and locally configured content requirements, each with a trigger and source;
- ordered process steps with conditional bodies, notice or comment periods, vote rules, deadlines, exceptions, and confidentiality class;
- plan relationships with direction and effect, including implementation, consistency, and supersession;
- recurring review and reporting duties stored separately from amendment-frequency limits;
- source URL, source owner, `verified_at`, `review_due_at`, and support status on every legal claim.

For the first registry records, use `verified_at: 2026-08-23` and `review_due_at: 2027-01-15`. The review date is a product-control choice, not a statutory deadline. Recheck earlier if any cited legislature or the Navajo Nation publishes a relevant amendment. The California, Washington, and Texas findings above are verified only for this note's stated scope. The Navajo descriptor remains a neutrality fixture with legal requirements explicitly unconfigured.
