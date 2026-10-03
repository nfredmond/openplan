import { unreadableLanes, type PageTabDefinition } from "@/lib/ui/page-tabs";

type MissionTabKey = "map" | "plan" | "photos" | "processing" | "evidence";

/** Which of this mission's reads FAILED, in the page's own vocabulary. */
type MissionTabReadFlags = {
  map: { orthoPreview: boolean; packages: boolean };
  processing: { jobs: boolean; custody: boolean };
  evidence: { packages: boolean };
};

/**
 * THE FIVE TABS OF AN AERIAL MISSION: where its imagery sits, how it will be
 * flown, the photos it brought back, what processing made of them, and the
 * evidence packages that came out. The map opens first because a mission is a
 * place before it is a record. `unreadable` names every lane whose read failed,
 * because the panel that would disclose it may be behind a closed tab.
 */
export function buildMissionTabs(flags: MissionTabReadFlags): PageTabDefinition<MissionTabKey>[] {
  return [
    {
      key: "map",
      label: "Map",
      unreadable: unreadableLanes([
        ["the processed imagery preview", flags.map.orthoPreview],
        ["evidence packages", flags.map.packages],
      ]),
    },
    { key: "plan", label: "Flight plan" },
    { key: "photos", label: "Photos" },
    {
      key: "processing",
      label: "Processing",
      unreadable: unreadableLanes([
        ["processing jobs", flags.processing.jobs],
        ["the files OpenPlan holds from each job", flags.processing.custody],
      ]),
    },
    {
      key: "evidence",
      label: "Evidence",
      unreadable: unreadableLanes([["evidence packages", flags.evidence.packages]]),
    },
  ];
}
