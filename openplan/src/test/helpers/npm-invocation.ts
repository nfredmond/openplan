import path from "node:path";

/**
 * How a test runs the real `npm` CLI as a child process.
 *
 * On Windows `npm` is a `.cmd` shim, and Node refuses to spawn a `.cmd` file
 * without a shell (`spawnSync npm ENOENT`, or EINVAL since the 2024 fix). A
 * shell would re-parse the arguments, so this runs npm's own JavaScript entry
 * with the current Node instead. Elsewhere it returns the plain command.
 */
export function npmInvocation(args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") return { command: "npm", args };
  const fromNpm = process.env.npm_execpath;
  const cli =
    fromNpm && path.basename(fromNpm) === "npm-cli.js"
      ? fromNpm
      : path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return { command: process.execPath, args: [cli, ...args] };
}
