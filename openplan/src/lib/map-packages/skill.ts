/**
 * The transportation-gis skill a map package run must use, identified by the
 * tree hash in `workers/planner_agent_connector/map-package-skill/MANIFEST.json`.
 * A connector whose copy differs refuses the run, so every package names the
 * kit that built it. Update this hash only together with that manifest.
 */
export const MAP_PACKAGE_SKILL = {
  name: "transportation-gis",
  treeHash: "ba4a3a0a4c0b75c3b075fec6708943f0a192061970467b367350617234e2d503",
} as const;
