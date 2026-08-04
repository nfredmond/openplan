/**
 * The crash analysis year window — ONE definition for every crash lane.
 *
 * WHY THIS FILE EXISTS. There were two answers to "which years do we ask a
 * crash source for", and they disagreed:
 *
 *   * `src/lib/data-sources/crashes.ts` derived a rolling window from the clock
 *     (`recentCrashYears`), which is correct — national fatality files publish
 *     roughly two years in arrears while state files run closer to real time, so
 *     a fixed list rots into "no crashes found";
 *   * the Safety workspace posted a HARDCODED `[2025, 2024, 2023, 2022, 2021]`,
 *     which was already one year stale when it was written and silently changes
 *     meaning every January.
 *
 * The two callers therefore asked different questions of the same registry, and
 * the corridor scorecard and the Safety map could report different crash
 * histories for the same place without either surface being wrong about itself.
 * A shared capability living inside one of its callers gets reimplemented
 * wrongly by the other; this is that capability, extracted.
 *
 * JURISDICTION-NEUTRAL BY CONSTRUCTION. It names no country, no agency and no
 * publication calendar. Every adapter clamps this window against its own
 * `earliestYear` (and, for a fatality census two years in arrears, simply
 * answers nothing for a year it does not hold yet), so widening coverage to a
 * new country never means editing this file.
 */

/**
 * How many recent calendar years a crash query asks for.
 *
 * Four is the window the corridor scorecard has always used and the one the
 * Safety module's five-element hardcoded list approximated. It is a window
 * rather than a vintage on purpose — see the file header.
 */
export const CRASH_ANALYSIS_YEAR_WINDOW = 4;

/**
 * The most recent complete calendar years, newest first.
 *
 * `now` is injectable so the behaviour is testable without freezing the clock,
 * and UTC is used deliberately: a local-timezone read would flip the window a
 * few hours early or late depending on where the server runs.
 */
export function recentCrashYears(now: Date = new Date()): number[] {
  const mostRecentComplete = now.getUTCFullYear() - 1;
  return Array.from({ length: CRASH_ANALYSIS_YEAR_WINDOW }, (_, index) => mostRecentComplete - index);
}
