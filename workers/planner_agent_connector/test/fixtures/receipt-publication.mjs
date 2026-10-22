import { openSync, closeSync, writeFileSync, renameSync } from "node:fs";

// A forced fixture shutdown can interrupt any write. Readers keep the last
// complete receipt until the next complete snapshot replaces it.
export function saveReceipt(path, receipt, beforeData = () => {}) {
  const temporary = `${path}.partial`;
  const descriptor = openSync(temporary, "w", 0o600);
  try {
    beforeData();
    writeFileSync(descriptor, JSON.stringify(receipt));
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
}
