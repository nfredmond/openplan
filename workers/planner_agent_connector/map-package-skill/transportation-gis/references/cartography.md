# Figure programme and design rules

Read this when choosing which maps a project needs and when judging a render.

## Which figures a deliverable needs

Start from the scoring criteria, the scope of work or the report outline; they are the authority. Where they are silent, these sets are what reviewers expect.

| Deliverable | Typical figures |
|---|---|
| Grant application (ATP, SS4A, RAISE, HSIP, Clean California, Sustainable Communities) | Project location and regional context; project limits and proposed improvements; destinations served (schools, transit, jobs, parks); crash history by severity and mode; disadvantaged community status under the programme's own definition; existing conditions (gaps, counts, speeds). Use `figure-6.5x4.5` pages when the application limits pages, so figures drop into the narrative |
| Active transportation or bicycle and pedestrian plan | Study area; existing bikeways by class; existing pedestrian facilities and gaps; crashes; level of traffic stress; destinations and demand; equity priority areas; recommended bikeway network (existing solid, proposed dashed); recommended pedestrian projects; priority projects. Add a map book for the recommended network |
| Corridor study | Corridor location; existing conditions strip maps; volumes and speeds; crashes; land use and destinations; alternatives; recommended concept strip maps (`coverage: strip`) |
| Local road safety plan or safety action plan | Crashes by severity; killed or seriously injured crashes by mode; high injury network; equity overlay; emphasis-area maps; priority locations |
| Regional transportation plan or circulation element | Functional classification; volumes; transit network; truck routes; planned projects by horizon; equity areas |
| Transit plan | Routes and stops; frequency; ridership by stop (graduated points); transit-supportive density; quarter-mile and half-mile access; equity areas |

Programme definitions of "disadvantaged community" differ (CalEnviroScreen percentile, median household income, free or reduced price meals, tribal lands, regional definitions). Map the definition the programme names, state it in the subtitle, and cite the data vintage. `data-sources.md` lists current layers.

### Corridor studies

- Make the corridor line with `tgis.py corridor` or from the client's centreline, then build the study area from it with `buffer_mi`.
- When the figure is about what is on the street (bike lanes, stops, crashes), draw the corridor as `corridor_band` listed last among the lines, so it sits under them. Use `project_corridor` (gold on a dark casing, listed first) only on location maps where the corridor itself is the subject.
- Label the corridor with its street name (`label:` on the corridor layer).
- Show the city limit or other jurisdiction line when the study area crosses it.
- Strip sheets: say the sheet limits in the atlas `subtitle` or `notes` when the sheets have natural break points.

### Disadvantaged community figures for grant applications

Read the programme guidelines for the cycle first; definitions and thresholds change. The usual tests and where the data is:

| Test | Data | Typical threshold |
|---|---|---|
| Median household income | ACS table B19013 by tract or block group, compared with the state median from the same vintage. Needs `CENSUS_API_KEY`, or the keyless Esri Living Atlas ACS layers in data-sources.md | Below 80 percent of the state median |
| CalEnviroScreen | OEHHA layer in data-sources.md | Worst 25 percent of tracts statewide |
| Free or reduced price meals | CDE school data | 75 percent or more of students |
| Healthy Places Index, regional definitions, tribal lands | See the programme guidelines | Varies |

State the test, the vintage and the threshold in the subtitle. If no area qualifies under a test, say so in `notes:`. Put the state median in `compute:` as a number with its source and year in `description:`, and flag it `[VERIFY]` until checked against the guidelines.

### Posters

A 24 by 36 inch board for an open house is not a letter figure enlarged. The kit scales type for wall reading; the content is yours to supply:
- Put the meeting ask in `subtitle` or `notes`: what the board shows, what you want people to tell you, where to send comments. Leave real placeholders (`[MEETING DATE]`, `[COMMENT ADDRESS]`) when the user has not supplied them.
- Label landmarks people navigate by (schools, parks, the station) with `label:` on those layers.
- Choose an extent that fills the frame with the study area; crop the surroundings.
- A poster is exported separately and is left out of the combined figures PDF.

## Design rules the kit applies

- One projected CRS for the whole package: the State Plane zone in US survey feet, or what the client uses.
- Round scales (1 inch = 500, 1,000, 2,000 feet and so on). The scale bar is in feet below 1 inch = 1,250 feet and miles above.
- Base map recedes: pale land, white streets with gray casings, muted water and parks. Thematic layers carry the colour.
- Every thematic distinction differs by more than hue: line width, dash, marker shape or pattern. Check `qa/contact_sheet_gray.jpg` and `qa/contact_sheet_deuteranopia.jpg`.
- Red is for crash severity. Project lines are gold on a dark casing. Proposed facilities are dashed versions of the existing symbol, one dash pattern per class (`bikeway_class_proposed`).
- Type is Inter, 5.5 pt minimum (14 pt on posters), with white halos on map labels. The scale bar, north arrow and legend sit outside the map frame. The one panel that overlays the map (the banner template's inset) is opaque and goes to the emptiest corner.
- Legends list only what the map shows. Classes with no features are dropped.
- The area outside the study area is dimmed so the eye lands on the study area.
- Each page carries figure label, title, client, status and date, sources, CRS and scale statement.

## Judgement the kit cannot make

- **Extent.** The default frames the study area. A corridor map usually wants `extent: {layer: corridor}`; a regional context map wants a `bbox` that includes the nearest city or highway people know.
- **Layer count.** Three or four thematic layers is the limit for a letter page. Split a crowded map into two figures.
- **Classification.** Quantile breaks suit screening maps. Programme thresholds (for example CalEnviroScreen 75th percentile) need `breaks:`. State the method in the subtitle or `unit_note`.
- **Small numbers.** With few features per class (six census tracts), a choropleth overstates precision. Label the values or use a table.
- **Titles.** Say what the map shows, in title case, without "Map of". Subtitles carry the year, the unit and the source definition.
- **Labels.** Add `label:` to a thematic layer only when names matter (schools, project segments). Street names come from the base map.

## Honesty rules

- A source that has not been checked against the agency's records is labelled as such on the map (`notes:`) and in the figure notes. OpenStreetMap themes are draft inventories.
- Do not draw what the data does not show. A schematic alignment is labelled schematic. A geocoded address is not an entrance. A zoning boundary is not a building footprint.
- Missing values stay "No data" with their own swatch. They are never zero.
- Crash data: state the years and the source in the subtitle. Provisional years are named as provisional. Never show a crash location more precisely than the source geocode supports.
- Anything not verified stays a visible placeholder in text: `[ALT TEXT NEEDED]`, `[VERIFY TERMS]`.
- Client data that may not be redistributed stays out of the ZIP, the website and the KMZ. Say so in the README.

## Voice

Map text follows the planner-writing skill: plain words, no marketing tone, no em dashes, numbers with their source and year. Pages are written in the client agency's voice; the consultant appears only in `prepared_by` when asked for.
