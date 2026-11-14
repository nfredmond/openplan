/**
 * The server half of the evidence-appendix declarations in
 * `evidence-appendix-keys.ts`: for each program, how its appendices open and
 * how their records are read and built. The export route asks this module and
 * never names a program itself.
 */

import { ATP_APPENDIX_FRAME, buildAtpEvidenceAppendices } from "@/lib/grants/atp-evidence-appendices";
import { loadAtpEvidenceRecords } from "@/lib/grants/atp-evidence-loader";
import type { EvidenceAppendix, EvidenceAppendixFrame } from "@/lib/grants/evidence-appendices";
import type { SafetySeedProvenance } from "@/lib/grants/safety-seed-origin";
import type { Ss4aAppendixKey } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices, SS4A_APPENDIX_FRAME } from "@/lib/grants/ss4a-evidence-appendices";
import { loadSs4aEvidenceRecords } from "@/lib/grants/ss4a-evidence-loader";

type AssemblyInput = {
  workspaceId: string;
  projectId: string | null;
  seedHistory: readonly SafetySeedProvenance[];
  /** Keys the program declares; anything else was refused before this point. */
  selected: ReadonlySet<string>;
  generatedAt: string;
  /** The workspace calendar's zone. */
  timeZone: string;
};

export type AssembledEvidenceAppendices = {
  frame: EvidenceAppendixFrame;
  appendices: EvidenceAppendix[];
};

type ProgramAssembler = (supabase: unknown, input: AssemblyInput) => Promise<EvidenceAppendix[]>;

const ASSEMBLERS: Record<string, { frame: EvidenceAppendixFrame; assemble: ProgramAssembler }> = {
  ss4a: {
    frame: SS4A_APPENDIX_FRAME,
    assemble: async (supabase, input) => {
      const selected = input.selected as ReadonlySet<Ss4aAppendixKey>;
      const records = await loadSs4aEvidenceRecords(supabase, { ...input, selected });
      return buildSs4aEvidenceAppendices(records, selected);
    },
  },
  atp: {
    frame: ATP_APPENDIX_FRAME,
    assemble: async (supabase, input) => {
      const records = await loadAtpEvidenceRecords(supabase, input);
      return buildAtpEvidenceAppendices(records, input.selected);
    },
  },
};

/** The program's appendices, every one listed whatever its state; null when the program declares none. */
export async function assembleEvidenceAppendices(
  catalogKey: string | null,
  supabase: unknown,
  input: AssemblyInput
): Promise<AssembledEvidenceAppendices | null> {
  const program = catalogKey && Object.hasOwn(ASSEMBLERS, catalogKey) ? ASSEMBLERS[catalogKey] : undefined;
  if (!program) return null;
  return { frame: program.frame, appendices: await program.assemble(supabase, input) };
}
