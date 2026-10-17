import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, writeSync } from "node:fs";

function writeAll(fd, data) {
  let offset = 0;
  while (offset < data.length) {
    const count = writeSync(fd, data, offset, data.length - offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > data.length - offset) {
      throw new Error("report_invalid_actual_write_count");
    }
    offset += count;
  }
  return offset;
}

const meta = (value) => [value.dev, value.ino, value.mode, value.uid, value.gid, value.size, value.mtimeNs, value.ctimeNs].map(String);
const same = (left, right) => JSON.stringify(meta(left)) === JSON.stringify(meta(right));
const sha = (data) => createHash("sha256").update(data).digest("hex");

function saved(path, length, hash) {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("report_not_regular_nonsymlink");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    if (!same(before, fstatSync(fd, { bigint: true }))) throw new Error("report_changed_at_open");
    bytes = readFileSync(fd);
    if (!same(before, fstatSync(fd, { bigint: true })) || !same(before, lstatSync(path, { bigint: true }))) {
      throw new Error("report_unstable_metadata");
    }
  } finally {
    closeSync(fd);
  }
  if (bytes.length !== length || sha(bytes) !== hash) throw new Error("report_saved_length_or_hash_mismatch");
  return { path, bytes: length, sha256: hash, metadata: meta(before) };
}

// Future reporter output only. Saved-file readback is not a durability claim.
export function journal(path, maximum) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let written = 0;
  const hash = createHash("sha256");
  return {
    emit(value) {
      const data = Buffer.from(`${JSON.stringify(value)}\n`);
      if (written + data.length > maximum) throw new Error("report_byte_limit");
      const count = writeAll(fd, data);
      if (count !== data.length) throw new Error("report_actual_count_mismatch");
      hash.update(data);
      written += count;
    },
    finish() {
      const errors = [];
      let readback;
      try { fsyncSync(fd); } catch (error) { errors.push(error); }
      try { closeSync(fd); } catch (error) { errors.push(error); }
      try { readback = saved(path, written, hash.digest("hex")); } catch (error) { errors.push(error); }
      const receipt = Buffer.from(`${JSON.stringify({ readback, errors: errors.map(error => ({ name: error.name, message: error.message, stack: error.stack })), complete: errors.length === 0 })}\n`);
      let receiptFd;
      try {
        receiptFd = openSync(`${path}.receipt.json`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeAll(receiptFd, receipt);
        fsyncSync(receiptFd);
      } catch (error) { errors.push(error); }
      if (receiptFd !== undefined) {
        try { closeSync(receiptFd); } catch (error) { errors.push(error); }
        try { saved(`${path}.receipt.json`, receipt.length, sha(receipt)); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "report_recording_incomplete");
      return { path, sha256: readback.sha256, receiptSHA256: sha(receipt) };
    },
  };
}

export function completeSignal(value) {
  writeAll(1, Buffer.from(`PR332_REPORT_COMPLETE ${JSON.stringify(value)}\n`));
}
