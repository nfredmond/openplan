import { z } from "zod";

/** The SS4A evidence appendices a planner can include, in document order. Client-safe. */
export const SS4A_APPENDIX_KEYS = ["hin_map", "crash_summary", "countermeasures", "bca", "engagement"] as const;
export type Ss4aAppendixKey = (typeof SS4A_APPENDIX_KEYS)[number];

export const SS4A_APPENDIX_TITLES: Record<Ss4aAppendixKey, string> = {
  hin_map: "High-injury network map",
  crash_summary: "Crash summary",
  countermeasures: "Countermeasures",
  bca: "Benefit-cost summary",
  engagement: "Engagement summary",
};

/** Optional request body. Absent or null means every appendix, the default. */
export const ss4aAppendixSelectionSchema = z
  .object({ appendices: z.array(z.enum(SS4A_APPENDIX_KEYS)).max(SS4A_APPENDIX_KEYS.length) })
  .strict();
