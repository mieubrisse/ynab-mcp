import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "./harness.js";
import { dateStr, seedStandardBudget } from "./seed.js";

let harness: IntegrationHarness;

beforeEach(async () => {
  harness = await createIntegrationHarness({ seed: seedStandardBudget });
});

afterEach(async () => {
  await harness.close();
});

describe("split transaction creation", () => {
  it("creates a split with subtransactions and resolves category names", async () => {
    const created = (await harness.callTool("create_transactions", {
      budget_id: "budget-1",
      transactions: [
        {
          account_id: "acct-checking",
          date: dateStr(0, 15),
          amount: -100.0,
          memo: "Split test",
          subtransactions: [
            { amount: -60.0, category_id: "cat-groceries" },
            { amount: -40.0, category_id: "cat-dining" },
          ],
        },
      ],
    })) as {
      created_count: number;
      transactions: Array<{
        id: string;
        subtransactions: Array<{
          amount: number;
          category_name: string;
          category_id: string;
        }>;
      }>;
    };

    expect(created.created_count).toBe(1);
    const tx = created.transactions[0];
    expect(tx.subtransactions).toHaveLength(2);

    // Verify amounts
    const amounts = tx.subtransactions
      .map((s) => s.amount)
      .sort((a, b) => a - b);
    expect(amounts).toEqual([-60.0, -40.0]);

    // Verify category names are resolved
    const catNames = tx.subtransactions.map((s) => s.category_name).sort();
    expect(catNames).toEqual(["Dining Out", "Groceries"]);

    // Verify via search
    const search = (await harness.callTool("search_transactions", {
      budget_id: "budget-1",
      queries: [{ memo_contains: "Split test" }],
    })) as {
      result_sets: Array<{
        count: number;
        transactions: Array<{
          subtransactions: Array<{ amount: number }>;
        }>;
      }>;
    };
    expect(search.result_sets[0].count).toBe(1);
    expect(search.result_sets[0].transactions[0].subtransactions).toHaveLength(
      2,
    );
  });
});

describe("split subtransaction amount validation", () => {
  it("rejects a split where subtransaction amounts do not sum to parent", async () => {
    // This is now caught locally, before any request is sent, and the message
    // names both totals — YNAB's own rejection names neither.
    await expect(
      harness.callTool("create_transactions", {
        budget_id: "budget-1",
        transactions: [
          {
            account_id: "acct-checking",
            date: dateStr(0, 15),
            amount: -100.0,
            memo: "Bad split",
            subtransactions: [
              { amount: -60.0, category_id: "cat-groceries" },
              { amount: -30.0, category_id: "cat-dining" },
              // Sums to -90, parent is -100 — mismatch
            ],
          },
        ],
      }),
    ).rejects.toThrow(/sum/i);

    // Nothing was written: the refusal happened before the request.
    const after = (await harness.callTool("search_transactions", {
      budget_id: "budget-1",
      queries: [{ memo_contains: "Bad split" }],
    })) as { result_sets: Array<{ count: number }> };

    expect(after.result_sets[0].count).toBe(0);
  });
});
// The "split frozen fields on update", "subtransaction modification triggers
// replace" and "undo after split replace" suites were removed here. They
// asserted that editing a split's category or subtransactions silently deleted
// and recreated the transaction, which this fork refuses to do. The replacement
// behaviour is covered by split-replace-refusal.integration.test.ts.

describe("split deletion", () => {
  it("deletes a split transaction and categories remain accessible", async () => {
    const created = (await harness.callTool("create_transactions", {
      budget_id: "budget-1",
      transactions: [
        {
          account_id: "acct-checking",
          date: dateStr(0, 15),
          amount: -70.0,
          memo: "Split delete test",
          subtransactions: [
            { amount: -40.0, category_id: "cat-groceries" },
            { amount: -30.0, category_id: "cat-dining" },
          ],
        },
      ],
    })) as {
      transactions: Array<{ id: string }>;
    };

    const txId = created.transactions[0].id;

    // Delete it
    const deleted = (await harness.callTool("delete_transactions", {
      budget_id: "budget-1",
      transaction_ids: [txId],
    })) as {
      results: Array<{ status: string }>;
    };
    expect(deleted.results[0].status).toBe("deleted");

    // Verify it's gone
    const search = (await harness.callTool("search_transactions", {
      budget_id: "budget-1",
      queries: [{ memo_contains: "Split delete test" }],
    })) as { result_sets: Array<{ count: number }> };
    expect(search.result_sets[0].count).toBe(0);

    // Verify category data is still accessible after split deletion
    // (phantom budget activity quirk — categories should not be corrupted)
    const categories = (await harness.callTool("list_categories", {
      budget_id: "budget-1",
    })) as {
      groups: Array<{
        categories: Array<{ id: string; name: string }>;
      }>;
    };
    const allCats = categories.groups.flatMap((g) => g.categories);
    const groceries = allCats.find((c) => c.id === "cat-groceries");
    const dining = allCats.find((c) => c.id === "cat-dining");
    expect(groceries).toBeDefined();
    expect(groceries?.name).toBe("Groceries");
    expect(dining).toBeDefined();
    expect(dining?.name).toBe("Dining Out");
  });
});
