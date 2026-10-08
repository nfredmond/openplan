import { open, realpath, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/** Keep each traversed directory open so renamed parents cannot redirect a read. */
export async function readPinnedLocalFile(root: string, file: string): Promise<Uint8Array> {
  if (process.platform !== "linux") {
    throw new Error("Secure local artifact reads require the Linux reference host; use Storage artifacts on this host.");
  }
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Local artifact target escapes this run's scope.");
  }
  const handles: FileHandle[] = [];
  try {
    let directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(directory);
    if (await realpath(`/proc/self/fd/${directory.fd}`) !== root) {
      throw new Error("Local artifact run directory changed before opening.");
    }
    const parts = relative.split(path.sep);
    for (const part of parts.slice(0, -1)) {
      directory = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      handles.push(directory);
    }
    const descriptor = await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    handles.push(descriptor);
    if (!(await descriptor.stat()).isFile()) throw new Error("Local artifact is not a regular file.");
    return new Uint8Array(await descriptor.readFile());
  } finally {
    // Attempt every close even if one fails; no failed read may leak descriptors.
    const closed = await Promise.allSettled(handles.reverse().map((handle) => handle.close()));
    if (closed.some((result) => result.status === "rejected")) throw new Error("Local artifact file handle cleanup failed.");
  }
}
