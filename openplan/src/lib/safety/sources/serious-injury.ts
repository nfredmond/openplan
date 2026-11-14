/**
 * The serious-injury join and its two inputs, for server code that holds an
 * adapter.
 *
 * `serious-injury-availability.ts` owns the decision, the wording and the
 * reading of recorded crashes. This file supplies the inputs for crashes an
 * adapter just returned: its declared completeness and whether its join ran.
 * It is the only caller of
 * `CrashSourceAdapter.enrichSeriousInjury`, so the Safety acquisition, the live
 * read and the corridor scorecard cannot join differently.
 */

import type { SeriousInjuryInputs } from "@/lib/safety/serious-injury-availability";
import type { CrashRecord, CrashSourceAdapter } from "./types";

/** The inputs for crashes an adapter returned, given whether its join ran. */
export function seriousInjuryInputsForAdapter(adapter: CrashSourceAdapter, joined: boolean): SeriousInjuryInputs {
  return {
    declared: adapter.severityCompleteness,
    enrichment: adapter.enrichSeriousInjury ? (joined ? "applied" : "not_applied") : "not_supported",
  };
}

/**
 * Run the adapter's serious-injury join, if it has one.
 *
 * A failure keeps every crash and reports the join as not applied: the crashes
 * are real, and "serious injuries were not separated" is the true statement
 * about them. `enabled: false` is the caller switching the join off.
 */
export async function enrichSeriousInjuries(
  adapter: CrashSourceAdapter,
  records: CrashRecord[],
  options: { enabled?: boolean; signal?: AbortSignal } = {}
): Promise<{ records: CrashRecord[]; upgraded: number; seriousInjury: SeriousInjuryInputs }> {
  if (!adapter.enrichSeriousInjury || options.enabled === false) {
    return { records, upgraded: 0, seriousInjury: seriousInjuryInputsForAdapter(adapter, false) };
  }
  try {
    const joined = await adapter.enrichSeriousInjury({ records, signal: options.signal });
    return { records: joined.records, upgraded: joined.upgraded, seriousInjury: seriousInjuryInputsForAdapter(adapter, true) };
  } catch {
    return { records, upgraded: 0, seriousInjury: seriousInjuryInputsForAdapter(adapter, false) };
  }
}
