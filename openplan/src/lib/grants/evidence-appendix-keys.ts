/**
 * Which grant programs carry evidence appendices in the packaged application,
 * and which appendices each declares, in document order. Client-safe: the
 * export panel offers these choices and the export route checks them.
 *
 * A program is matched by the catalog template its application was seeded
 * from (`identifySeededCatalogKey`). A program with no entry here gets no
 * appendices. Adding a program means declaring its keys here and its builders
 * in `evidence-appendix-programs.ts`.
 */

import { z } from "zod";
import { SS4A_APPENDIX_KEYS, SS4A_APPENDIX_TITLES } from "@/lib/grants/ss4a-appendix-keys";

/** The California ATP appendices, read from the linked project's saved records. */
export const ATP_APPENDIX_KEYS = ["scoring_packet", "crash_summary", "cost_estimate", "engagement", "equity", "bca"] as const;
export type AtpAppendixKey = (typeof ATP_APPENDIX_KEYS)[number];

export const ATP_APPENDIX_TITLES: Record<AtpAppendixKey, string> = {
  scoring_packet: "ATP screening packet",
  crash_summary: "Crash summary",
  cost_estimate: "Cost estimate",
  engagement: "Engagement summary",
  equity: "Disadvantaged-community and equity inputs",
  bca: "Benefit-cost summary",
};

export type EvidenceAppendixProgram = {
  /** The catalog template key the application was seeded from. */
  catalogKey: string;
  keys: readonly string[];
  titles: Readonly<Record<string, string>>;
};

const EVIDENCE_APPENDIX_PROGRAMS: readonly EvidenceAppendixProgram[] = [
  { catalogKey: "ss4a", keys: SS4A_APPENDIX_KEYS, titles: SS4A_APPENDIX_TITLES },
  { catalogKey: "atp", keys: ATP_APPENDIX_KEYS, titles: ATP_APPENDIX_TITLES },
];

/** The program's declaration, or null when the program carries no appendices. */
export function evidenceAppendixProgramFor(catalogKey: string | null | undefined): EvidenceAppendixProgram | null {
  return EVIDENCE_APPENDIX_PROGRAMS.find((program) => program.catalogKey === catalogKey) ?? null;
}

const DECLARED_KEYS = [...new Set(EVIDENCE_APPENDIX_PROGRAMS.flatMap((program) => program.keys))] as [string, ...string[]];

/**
 * Optional export request body. Absent or null means every appendix the
 * program declares. A key no program declares is refused here; a key another
 * program declares is refused once the application's program is known.
 */
export const evidenceAppendixSelectionSchema = z
  .object({ appendices: z.array(z.enum(DECLARED_KEYS)).max(DECLARED_KEYS.length) })
  .strict();
