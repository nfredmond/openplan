# Visual review

The automated checks cannot see. A package is finished only after someone has looked at every figure. Do the self-review first, then get an independent review.

## Self-review: look at every PNG

Read each file in `maps/png/` and every sheet of each map book in `atlas/sheets/` with the Read tool, at full page first and then zoomed into the busiest part. For a tabloid or larger page, crop to the map frame so details are legible. Also read `qa/contact_sheet_gray.jpg`.

Fix what you see by editing `project.yaml` and running `tgis.py render <project> --only <id>`, then look again. Common findings and their fixes:

| You see | Fix |
|---|---|
| The subject is small in the frame, or the frame is mostly empty land | Set `extent:` to the layer that matters, or a `bbox`, or a `scale` |
| A panel, inset or scale bar covers data | `corners: {furniture: br}` and so on, or `inset: false` |
| Legend runs past its space (also a QA failure) | Shorter labels, fewer layers, `legend_columns`, a larger page, or `inset: false` |
| Labels collide with data or each other | Lower the layer's label `size`, raise `priority` on the labels that matter, or drop `label:` |
| Two classes look alike in gray or deuteranopia sheets | Change the dash, width or marker in the style, not only the colour |
| Thematic lines vanish against the base roads | Add `casing: "#ffffff"`, raise `width`, or set `quiet_base: true` |
| "Other or not stated" in a legend | The style's `values:` do not match the data. Fix the values or the data |
| Choropleth with one class dominating | Wrong method. Use programme thresholds with `breaks:` |
| Title wraps to three lines | Shorten it; move detail to `subtitle` |
| Some points of a labelled layer have no label | The label engine dropped colliding names. Use a numbered key: `label: {field: name, number: true}` |
| The subject street or project has no name on the map | Add `label:` to the corridor or project layer |
| The project line hides the bike lane or stops on the same street | List the corridor last and use the `corridor_band` preset |
| Data outside the study area competes with the subject | `clip: study_area` on that layer, with a note that only features inside the study area are shown |
| A detached parcel leaves a third of the frame empty | `extent: study_area_main`, or a `bbox` |
| One class hides another inside a layer | List the class that matters first; the first class draws on top |
| Figures in one set are at different scales | Same `extent:` and `scale:` on each |
| Existing and proposed look alike | Proposed needs a dash unlike any existing class (see spec.md, style) |
| A legend entry for something not on this map or sheet | Remove that layer from the map, or set `legend: false` on its entry; for the boundary, `legend_study_area: false` |
| An overview claims to index a map book but shows no sheets | Add `atlas_<atlas id>_index` to its layers |
| Several points sit on one spot (crashes at an intersection, two schools on one campus) | The kit does not displace points. Add `show_counts: true`, say in `notes:` that symbols overlap, or map counts per intersection with `graduated_points` |
| A city or neighbourhood name sits on the data | `place_labels: false` |
| Report figure: the map is squeezed by the legend and footer | Fewer layers, shorter notes, `legend_columns: 3`, or a taller page such as `figure-6.5x5.5` |
| Poster reads like an enlarged letter page | See "Posters" in cartography.md |
| Place name sits on the project line | Acceptable if legible; otherwise change `extent` slightly or `pad` |

Done when you have looked at every figure after the last change and none shows an item from this table.

## Independent review

A reviewer who did not make the maps catches what the maker no longer sees. Start a fresh subagent (or ask the user to look) with this brief, the PNG paths, `docs/figure_notes.md`, and the project's factual constraints (what the figures must show, per the scope or scoring criteria). Do not tell the reviewer what you think of the maps.

> Review these transportation planning figures as a senior planner would before they go to a client. For each figure give: (1) blocking problems: wrong or misleading content, unreadable or clipped text, data hidden by a panel, legend that does not match the map; (2) major problems: weak hierarchy, crowded labels, symbols that cannot be told apart in grayscale, an extent that does not suit the subject, missing source or year; (3) minor polish. Quote what you see and where on the page. Then score each figure 0 to 100 for: reads in five seconds (25), accuracy and honesty (25), legibility at print size (20), hierarchy and colour (15), completeness of page elements (15). Do not rewrite the maps. Do not be kind.

Give the reviewer every map book sheet, not a sample. Fix every blocking and major item, rebuild, and send the reviewer the new renders. Stop after three rounds or when every figure scores 85 or more with no blocking or major item open.

Save each round's reviewer report in the project folder (`review_rounds/round-N.md`). If the last round met the target, record the gate with `tgis.py attest <project> cartography --reviewer "independent subagent" --note "round N: scores" --evidence review_rounds/round-N.md` and rebuild. If it did not, leave the gate pending and put a one-line summary in `project.review:` (for example "Independent review 2026-10-01, round 2: 71 to 78, open items listed in the hand-off report"). Never record a gate for a review that did not happen or did not pass.

Report the scores as given, with the round they come from. Scores for renders you have since changed are scores for the old renders; say so. Findings you could not fix go in the report as open items, sorted into: needs input from the user (project limits, meeting details, client data), needs a kit change (name it), or a judgement you chose to keep (say why). If no separate reviewer was available, say the independent review was not performed.

## Acceptance of the native ArcGIS Pro build

When `ARCGIS_BUILD_REPORT.md` and `native_build_report.json` come back from the computer with ArcGIS Pro:

0. If the report says the build matched the reference figures, record the gate: `tgis.py attest <project> arcgis --reviewer "<who ran it>" --note "<Pro version, date>" --evidence <ARCGIS_BUILD_REPORT.md>`.
1. Read every warning and failure. For each fix the builder needed, apply the same fix to `assets/arcgis/build_arcgis_pro.py` in this skill so the next package ships with it.
2. Add a one-line dated entry to "Lessons from native builds" in `arcgis-pro.md`.
3. Record in the package README which Pro version built it and what differed from the reference figures.
