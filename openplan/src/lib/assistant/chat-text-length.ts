import { z } from "zod";

/**
 * Chat text limits in UTF-16 code units, the unit the installed chat
 * database function `assistant_chat_private.string_length` counts (two per
 * astral character). Zod 4.6 counts code points, so `.max(n)` alone lets
 * astral-heavy text through that the database then refuses. Each limit is
 * checked in both units, so the app and the database refuse the same text.
 */
export function chatText(min: number, max: number, options: { trim?: boolean } = {}) {
  const base = options.trim ? z.string().trim() : z.string();
  return base.min(min).max(max).refine(
    (value) => value.length >= min && value.length <= max,
    { message: `Must be ${min} to ${max} characters, counting each emoji or other supplementary character as two` },
  );
}
