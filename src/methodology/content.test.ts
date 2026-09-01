import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { METHODOLOGY_CONTENT } from "./content.js";
import { getKnowledgeTopics } from "./index.js";

// content.ts is generated from the sibling .md files so the server needs no
// filesystem access at runtime. `src/version.ts` has a drift guard; this file is
// the equivalent for the documents, and it exists because their absence had a
// real cost: api-quirks.md was edited to describe behaviour the server no
// longer has, and nothing failed. These documents are served to the model as
// authoritative reference, so stale content actively misinforms it.
const methodologyDir = dirname(fileURLToPath(import.meta.url));

describe("inlined methodology content", () => {
  it("matches the markdown it was generated from", () => {
    for (const [name, inlined] of Object.entries(METHODOLOGY_CONTENT)) {
      const onDisk = readFileSync(join(methodologyDir, `${name}.md`), "utf-8");
      expect(
        inlined,
        `${name}.md has changed since content.ts was generated — re-run scripts/generate-inlined-sources.mjs`,
      ).toBe(onDisk);
    }
  });

  it("covers every topic the server serves", () => {
    for (const topic of getKnowledgeTopics()) {
      expect(topic.content.length).toBeGreaterThan(0);
    }
  });
});
