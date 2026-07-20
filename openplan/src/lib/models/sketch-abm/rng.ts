/**
 * Deterministic PRNG for the sketch ABM so a run is reproducible: same inputs +
 * same seed → identical trips/tours/summary. mulberry32 — byte-identical to the
 * generator the benchmark-validation test uses, so seeding here matches the
 * historical fixture exactly. The ABM draws `Math.random` across six modules;
 * `runABM({ seed })` installs this generator for the duration and restores the
 * real `Math.random` afterward (no per-call rng threading needed).
 */

/** Default reproducibility seed for production sketch runs. */
export const DEFAULT_ABM_SEED = 20260718;

/** mulberry32: fast, well-distributed, seedable [0,1) generator. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run `fn` with `Math.random` replaced by a seeded generator, restoring the real
 * one afterward even if `fn` throws. Synchronous callback only — the ABM
 * pipeline is synchronous per household, so all draws happen inside the swap.
 */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const real = Math.random;
  Math.random = createSeededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}
