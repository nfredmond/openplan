# October 6 dependency correction

The combined QA gate found eight registry advisories after the earlier branch checks. The lockfile now resolves MCP SDK 1.32.1, proxy-addr 2.0.8, sharp 0.35.5, smol-toml 1.9.0 and source-map-js 1.2.2. The audit reports zero vulnerabilities after installation.

Mammoth 1.12.0 depends on argparse 1, which brings in the affected sprintf-js package. The [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) lists no patched release. A scoped npm override resolves Mammoth's argparse to 2.0.1. That parser retains the legacy aliases used by Mammoth's CLI and has no sprintf-js dependency. This avoids downgrading Mammoth to the old version suggested by an automated force repair. The [argparse 2 changelog](https://github.com/nodeca/argparse/blob/2.0.1/CHANGELOG.md) describes the parser rewrite.

The compatibility test executes the installed Mammoth CLI with a generated DOCX, HTML and Markdown output, positional filenames containing spaces, an output file and conflicting output arguments. The existing extraction tests cover the application's document-library path. These 20 focused tests pass. The mutation record retains a harmless CLI comment and a broken argument-forwarding change that fails on the requested output format. Neither mutation remains installed.

`npm ci` succeeds with the regenerated lockfile. The repository dependency audit also passes its existing vendored-braces integrity and regression checks. Registry audit results are time-bound dependency information, not a whole-application security assessment. CLI compatibility does not establish fidelity for every Word document or native Word acceptance.
