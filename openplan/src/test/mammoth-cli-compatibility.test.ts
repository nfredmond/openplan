import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const mammothRoot = dirname(require.resolve("mammoth/package.json"));
const cli = join(mammothRoot, "bin/mammoth");
const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });

describe("Mammoth CLI with the dependency-free argparse override", () => {
  it("resolves the maintained compatibility parser and retains CLI help", () => {
    const mammothRequire = createRequire(join(mammothRoot, "package.json"));
    const metadata = mammothRequire("argparse/package.json") as { version: string; dependencies?: Record<string, string> };
    expect(metadata.version).toBe("2.0.1");
    expect(metadata.dependencies ?? {}).not.toHaveProperty("sprintf-js");
    const help = run("--help");
    expect(help).toContain("--output-format {html,markdown}");
    expect(help).toContain("--style-map");
    expect(help).toContain("docx-path");
  });

  it("converts a real DOCX through positional, format and output-file arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openplan-mammoth-cli-"));
    try {
      const zip = new JSZip();
      zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic planning note</w:t></w:r></w:p></w:body></w:document>');
      const input = join(directory, "input with spaces.docx"), output = join(directory, "output.html");
      await writeFile(input, await zip.generateAsync({ type: "nodebuffer" }));
      expect(run(input)).toBe("<p>Synthetic planning note</p>");
      expect(run(input, "--output-format", "markdown").trim()).toBe("Synthetic planning note");
      run(input, output);
      expect(await readFile(output, "utf8")).toBe("<p>Synthetic planning note</p>");
      const invalid = spawnSync(process.execPath, [cli, input, output, "--output-dir", directory], { encoding: "utf8", timeout: 10_000 });
      expect(invalid.status).toBe(2);
      expect(invalid.stderr).toContain("not allowed with argument");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
