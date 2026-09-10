import { open, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { openCodeAccountSummary, OpenCodeAccountError } from "./opencode-account.mjs";

// Called with paths inside the launcher's validated profile and private scratch.
// Read once through a non-following file descriptor, inspect those bytes, then
// mount a private snapshot. Native login changes cannot swap the running account.
export async function prepareOpenCodeCredentials(authPath, snapshotDirectory) {
  let file;
  try { file = await open(authPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (error.code === "ENOENT") return { account: openCodeAccountSummary({}), snapshotPath: null };
    throw new OpenCodeAccountError("native_credentials_not_private");
  }
  let raw;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
      throw new OpenCodeAccountError("native_credentials_not_private");
    }
    const buffer = Buffer.alloc(256_001);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > 256_000) throw new OpenCodeAccountError("native_credentials_not_private");
    try { raw = JSON.parse(buffer.subarray(0, size).toString("utf8")); }
    catch { throw new OpenCodeAccountError("native_account_unreadable"); }
  } finally { await file.close(); }
  const account = openCodeAccountSummary(raw);
  if (account.status !== "connected") return { account, snapshotPath: null };
  // Other providers and unrecognized fields never enter the native sandbox.
  const credential = { type: "api", key: raw.openai.key,
    ...(raw.openai.metadata === undefined ? {} : { metadata: raw.openai.metadata }) };
  await mkdir(snapshotDirectory, { mode: 0o700 });
  const snapshotPath = join(snapshotDirectory, "auth.json");
  await writeFile(snapshotPath, JSON.stringify({ openai: credential }), { mode: 0o400, flag: "wx" });
  return { account, snapshotPath };
}
