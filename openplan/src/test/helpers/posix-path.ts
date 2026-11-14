import path from "node:path";

/**
 * Repository paths in forward-slash form, whatever the host.
 *
 * Guards compare scanned files against literal paths ("src/lib/gtfs/...") and
 * match directories with "/" in prefixes and regular expressions. On Windows,
 * `path.join`, `path.resolve` and `path.relative` return backslashes, so those
 * comparisons match nothing: a guard either fails on a correct tree or passes
 * having scanned no files. Convert at the boundary, once, with these helpers.
 */
export function toPosixPath(platformPath: string): string {
  return platformPath.split(path.sep).join("/");
}

/** `path.relative(from, to)` in forward-slash form. */
export function posixRelative(from: string, to: string): string {
  return toPosixPath(path.relative(from, to));
}
