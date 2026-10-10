import { createHash } from "node:crypto";
import { fstatSync, fsyncSync, readSync, writeSync } from "node:fs";
import { z } from "zod";
import { parseGtfsFeed } from "../../src/lib/gtfs/parse";
import { resolveGtfsLimits } from "../../src/lib/gtfs/limits";

const positive = z.number().int().positive();
const limitsSchema = z.object(Object.fromEntries(
  Object.keys(resolveGtfsLimits({})).map(key => [key, positive]),
)).strict();
const requestSchema = z.object({ byteSize: positive, checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  maxOutputBytes: positive, limits: limitsSchema }).strict();

// The service manager must also supervise the process group on abrupt parent
// death. Disconnect handling cannot preempt a synchronous CSV parse.
process.once("disconnect", () => process.exit(1));
process.once("message", async message => {
  try {
    const request = requestSchema.parse(message);
    const limits = request.limits as ReturnType<typeof resolveGtfsLimits>;
    const input = fstatSync(4), output = fstatSync(5);
    if (!input.isFile() || !output.isFile() || output.size !== 0
      || (input.dev === output.dev && input.ino === output.ino)
      || input.size !== request.byteSize || request.byteSize > limits.maxArchiveBytes) {
      throw new Error("Parse descriptors do not match the retained archive and empty output");
    }
    const bytes = Buffer.alloc(request.byteSize);
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(4, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error("Retained archive is incomplete");
      offset += count;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== request.checksumSha256) {
      throw new Error("Retained archive checksum differs");
    }
    const result = await parseGtfsFeed(bytes, { limits });
    const encoded = Buffer.from(JSON.stringify(result));
    if (encoded.length > request.maxOutputBytes) throw new Error("Parsed output exceeds its bound");
    for (let offset = 0; offset < encoded.length;) {
      const written = writeSync(5, encoded, offset, encoded.length - offset, offset);
      if (!written) throw new Error("Parsed output could not be retained");
      offset += written;
    }
    fsyncSync(5);
    process.send?.({ byteSize: encoded.length,
      sha256: createHash("sha256").update(encoded).digest("hex"), parsed: result.ok }, error => {
      process.exit(error ? 1 : 0);
    });
  } catch { process.exit(1); }
});
