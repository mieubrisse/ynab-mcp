import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "./harness.js";
import { dateStr, seedStandardBudget } from "./seed.js";

// `update_transactions` refuses edits that would delete and recreate a split.
// That refusal is worth nothing if `undo_operations` does the same deletion one
// call later — and it did: the undo engine treated "the transaction is a split"
// as "use delete-and-recreate", so undoing a memo change on a split destroyed
// the record and reissued it under a new id.
//
// The distinction that matters: an undo only needs the destructive path if it
// actually has to change the split's category or subtransactions. Restoring a
// memo does not.

let harness: IntegrationHarness;

beforeEach(async () => {
  harness = await createIntegrationHarness({ seed: seedStandardBudget });
});

afterEach(async () => {
  await harness.close();
});

async function createSplit(memo: string): Promise<string> {
  const created = (await harness.callTool("create_transactions", {
    budget_id: "budget-1",
    transactions: [
      {
        account_id: "acct-checking",
        date: dateStr(0, 15),
        amount: -100.0,
        memo,
        subtransactions: [
          { amount: -60.0, category_id: "cat-groceries" },
          { amount: -40.0, category_id: "cat-dining" },
        ],
      },
    ],
  })) as { transactions: Array<{ id: string }> };

  return created.transactions[0].id;
}

describe("undoing a permitted edit to a split", () => {
  it("restores the memo without deleting and recreating the transaction", async () => {
    const splitId = await createSplit("original memo");

    const updated = (await harness.callTool("update_transactions", {
      budget_id: "budget-1",
      transactions: [{ transaction_id: splitId, memo: "changed memo" }],
    })) as { results: Array<{ status: string }>; undo_history_ids: string[] };

    expect(updated.results[0].status).toBe("updated");

    const undone = (await harness.callTool("undo_operations", {
      undo_history_ids: updated.undo_history_ids,
    })) as { results: Array<{ status: string }>; summary: { undone: number } };

    expect(undone.summary.undone).toBe(1);

    // The decisive assertion: the ORIGINAL id must still resolve. Under the old
    // behaviour it had been deleted and reborn under a new one, taking its
    // import_id link to the bank feed with it.
    const after = (await harness.callTool("search_transactions", {
      budget_id: "budget-1",
      queries: [{}],
    })) as {
      result_sets: Array<{
        transactions: Array<{ id: string; memo: string | null }>;
      }>;
    };

    const survivor = after.result_sets
      .flatMap((set) => set.transactions)
      .find((transaction) => transaction.id === splitId);

    expect(survivor).toBeDefined();
    expect(survivor?.memo).toBe("original memo");
  });

  it("keeps the split intact through the undo", async () => {
    const splitId = await createSplit("original memo");

    const updated = (await harness.callTool("update_transactions", {
      budget_id: "budget-1",
      transactions: [{ transaction_id: splitId, approved: true }],
    })) as { undo_history_ids: string[] };

    await harness.callTool("undo_operations", {
      undo_history_ids: updated.undo_history_ids,
    });

    const after = (await harness.callTool("search_transactions", {
      budget_id: "budget-1",
      queries: [{}],
    })) as {
      result_sets: Array<{
        transactions: Array<{ id: string; is_split: boolean }>;
      }>;
    };

    const survivor = after.result_sets
      .flatMap((set) => set.transactions)
      .find((transaction) => transaction.id === splitId);

    expect(survivor?.is_split).toBe(true);
  });

  it("does not create a second transaction in the process", async () => {
    const before = (await harness.callTool("search_transactions", {
      budget_id: "budget-1",
      queries: [{}],
    })) as { result_sets: Array<{ count: number }> };
    const countBefore = before.result_sets[0].count;

    const splitId = await createSplit("original memo");
    const updated = (await harness.callTool("update_transactions", {
      budget_id: "budget-1",
      transactions: [{ transaction_id: splitId, memo: "changed" }],
    })) as { undo_history_ids: string[] };

    await harness.callTool("undo_operations", {
      undo_history_ids: updated.undo_history_ids,
    });

    const after = (await harness.callTool("search_transactions", {
      budget_id: "budget-1",
      queries: [{}],
    })) as { result_sets: Array<{ count: number }> };

    // One split created, nothing else added or removed.
    expect(after.result_sets[0].count).toBe(countBefore + 1);
  });
});
