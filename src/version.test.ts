import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SERVER_VERSION } from "./version.js";

// src/version.ts is generated so the server needs no filesystem access at
// runtime. That generation can silently go stale after a version bump, so this
// test is the drift guard. Reading package.json here is fine — tests are not
// the thing running inside the sandbox.
describe("SERVER_VERSION", () => {
  it("matches the version in package.json", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const { version } = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf-8"),
    ) as { version: string };

    expect(SERVER_VERSION).toBe(version);
  });
});
