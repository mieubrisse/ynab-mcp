import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockUndoEntry } from "../test-utils.js";
import { UndoStore } from "./store.js";

// Undo history MUST outlive the server process.
//
// This is asserted directly, by name, because it has already been lost once.
// The store was rewritten to hold history in memory, and the full suite stayed
// green — the tests that would have caught it were file-manipulation tests, and
// they were removed in the same change precisely because they touched files.
// A guarantee protected only by incidental coverage is a guarantee that
// disappears the moment someone tidies up.
//
// The scenario this protects is ordinary rather than exotic: reloading a mission
// restarts the MCP server. If history did not survive that, an agent would offer
// an undo that silently had nothing behind it, at the one moment somebody wanted
// to reverse a batch.

let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "undo-durability-"));
});

afterEach(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
});

const BUDGET_ID = "budget-1";

describe("undo history durability", () => {
  it("survives the process that recorded it", async () => {
    const recordingStore = new UndoStore(dataDirectory);
    await recordingStore.appendEntries(BUDGET_ID, [
      createMockUndoEntry({
        id: "budget-1::1::survives",
        budget_id: BUDGET_ID,
      }),
    ]);

    // A second instance stands in for the server restarting — a mission reload,
    // a crash, a machine restart. It shares only the directory.
    const restartedStore = new UndoStore(dataDirectory);
    const { entries } = await restartedStore.listEntries(BUDGET_ID, {
      limit: 100,
      includeUndone: true,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["budget-1::1::survives"]);
  });

  it("survives with its undone/active status intact", async () => {
    const recordingStore = new UndoStore(dataDirectory);
    await recordingStore.appendEntries(BUDGET_ID, [
      createMockUndoEntry({ id: "budget-1::1::a", budget_id: BUDGET_ID }),
      createMockUndoEntry({ id: "budget-1::2::b", budget_id: BUDGET_ID }),
    ]);
    await recordingStore.markEntriesUndone(BUDGET_ID, ["budget-1::1::a"]);

    const restartedStore = new UndoStore(dataDirectory);
    const { entries } = await restartedStore.listEntries(BUDGET_ID, {
      limit: 100,
      includeUndone: true,
    });

    const byId = new Map(entries.map((entry) => [entry.id, entry.status]));
    expect(byId.get("budget-1::1::a")).toBe("undone");
    expect(byId.get("budget-1::2::b")).toBe("active");
  });

  it("survives its id remappings, so a chained undo still resolves", async () => {
    const recordingStore = new UndoStore(dataDirectory);
    await recordingStore.updateIdMappings(BUDGET_ID, "old-id", "new-id");

    const restartedStore = new UndoStore(dataDirectory);

    expect(await restartedStore.resolveMappedId(BUDGET_ID, "old-id")).toBe(
      "new-id",
    );
  });

  it("keeps one budget's history out of another's", async () => {
    // Per-mission isolation is enforced by giving each mission its own
    // directory; this pins the weaker in-process property that budgets do not
    // bleed into each other.
    const store = new UndoStore(dataDirectory);
    await store.appendEntries("budget-a", [
      createMockUndoEntry({ id: "budget-a::1::x", budget_id: "budget-a" }),
    ]);

    const other = await store.listEntries("budget-b", {
      limit: 100,
      includeUndone: true,
    });

    expect(other.entries).toEqual([]);
  });

  it("does not leak history between separate data directories", async () => {
    // Two missions, two directories, one machine. Neither may see the other.
    const otherDirectory = await mkdtemp(join(tmpdir(), "undo-durability-"));
    try {
      const missionOne = new UndoStore(dataDirectory);
      await missionOne.appendEntries(BUDGET_ID, [
        createMockUndoEntry({
          id: "budget-1::1::private",
          budget_id: BUDGET_ID,
        }),
      ]);

      const missionTwo = new UndoStore(otherDirectory);
      const { entries } = await missionTwo.listEntries(BUDGET_ID, {
        limit: 100,
        includeUndone: true,
      });

      expect(entries).toEqual([]);
    } finally {
      await rm(otherDirectory, { recursive: true, force: true });
    }
  });
});
