#!/usr/bin/env node
// Regenerates the sources that must be compiled in rather than read at runtime:
//   - src/methodology/content.ts, from the sibling .md files
//   - src/version.ts, from package.json
//
// The methodology documents used to be read from disk at runtime with
// readFileSync. This server now runs with no filesystem access — the sandbox
// grants network to api.ynab.com and nothing else — so the content is compiled
// in instead. Edit the .md files, run this, and commit the regenerated module.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const methodologyDir = join(repoRoot, "src", "methodology");

// Keep in sync with the `topics` list in src/methodology/index.ts.
const TOPIC_NAMES = [
  "terminology",
  "credit-cards",
  "targets",
  "overspending",
  "reconciliation",
  "api-quirks",
];

const toIdentifier = (name) => name.replaceAll("-", "_").toUpperCase();

const sections = [
  "// Generated from the sibling .md files so the server needs no filesystem",
  "// access at runtime. Edit the .md files and re-run scripts/inline-methodology.mjs.",
  "",
];

for (const name of TOPIC_NAMES) {
  const markdown = readFileSync(join(methodologyDir, `${name}.md`), "utf-8");
  sections.push(`export const ${toIdentifier(name)} = ${JSON.stringify(markdown)};`);
  sections.push("");
}

sections.push("export const METHODOLOGY_CONTENT: Record<string, string> = {");
for (const name of TOPIC_NAMES) {
  // Quote only when the key is not a bare identifier, matching what the
  // formatter would produce — otherwise running this script emits code that
  // fails the project's own lint.
  const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
  sections.push(`  ${key}: ${toIdentifier(name)},`);
}
sections.push("};");
sections.push("");

writeFileSync(join(methodologyDir, "content.ts"), sections.join("\n"));

// The server reports its version over MCP. Reading package.json at runtime
// would be a filesystem access, and this server is meant to run with none, so
// the value is compiled in. `src/version.test.ts` fails if the two drift.
const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
writeFileSync(
  join(repoRoot, "src", "version.ts"),
  [
    "// Generated from package.json so the server needs no filesystem access at",
    "// runtime. Re-run scripts/generate-inlined-sources.mjs after a version bump;",
    "// src/version.test.ts fails if this drifts.",
    "",
    `export const SERVER_VERSION = ${JSON.stringify(version)};`,
    "",
  ].join("\n"),
);

// Formatted by the project's own formatter rather than by hand-matching its
// output here. Without this, following the instructions at the top of this file
// produces code that fails `npm run lint`, and every build leaves a spurious
// diff in a tracked file.
execFileSync(
  "npx",
  [
    "biome",
    "format",
    "--write",
    "src/methodology/content.ts",
    "src/version.ts",
  ],
  { cwd: repoRoot, stdio: "ignore" },
);

process.stdout.write(
  `Inlined ${TOPIC_NAMES.length} methodology topics and version ${version}\n`,
);
