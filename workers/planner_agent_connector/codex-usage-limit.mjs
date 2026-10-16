const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const CODEX_LIMIT_CODES = ["usageLimitExceeded", "rateLimitExceeded", "sessionBudgetExceeded"];
// Unix seconds through 9999-12-31. Values outside the displayable contract stay unknown.
export const validReset = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799;

// One tracker belongs to one owned session and attempt. Keep only window fields;
// account identity, plan, credits and provider prose never enter the result.
export function codexUsageLimitTracker() {
  const windows = {};
  return {
    merge(snapshot) {
      if (!object(snapshot) || (snapshot.limitId != null && snapshot.limitId !== "codex")) return;
      for (const key of ["primary", "secondary"]) {
        const window = snapshot[key];
        if (window == null) continue; // Sparse notification, not evidence of recovery.
        if (!object(window) || !Number.isInteger(window.usedPercent) || window.usedPercent < 0) {
          delete windows[key];
          continue;
        }
        // A newly reported window replaces its old reset, including unknown resets.
        windows[key] = { usedPercent: window.usedPercent, resetsAt: validReset(window.resetsAt) ? window.resetsAt : null };
      }
    },
    signal(code) {
      if (!CODEX_LIMIT_CODES.includes(code)) return null;
      const exhausted = Object.values(windows).filter(window => window.usedPercent >= 100);
      const reset = code === "usageLimitExceeded" && exhausted.length && exhausted.every(window => window.resetsAt !== null)
        ? Math.max(...exhausted.map(window => window.resetsAt)) : null;
      return { code, resetAtUnixSeconds: reset, resetSource: reset === null ? null : "account_rate_limits" };
    },
  };
}
