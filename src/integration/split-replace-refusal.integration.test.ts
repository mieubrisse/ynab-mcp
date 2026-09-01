import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "./harness.js";
import { dateStr, seedStandardBudget } from "./seed.js";

// Updating a category or the subtransactions of an ALREADY-SPLIT transaction
// used to be silently implemented as delete-then-create. YNAB has no undelete,
// the transaction comes back with a new id, and its import_id link to the bank
// feed cannot be recreated — so a routine-looking categorization could destroy
// a record and sever its bank matching without anyone approving a deletion.
//
// These tests pin the replacement behaviour: refuse, explain, and leave the
// transaction exactly as it was.

let harness: IntegrationHarness;

beforeEach(async () => {
  harness = await createIntegrationHarness({ seed: seedStandardBudget });
});

afterEach(async () => {
  await harness.close();
});

async function createSplit(): Promise<string> {
  const created = (await harness.callTool("create_transactions", {
    budget_id: "budget-1",
    transactions: [
      {
        account_id: "acct-checking",
        date: dateStr(0, 15),
        amount: -100.0,
        memo: "Split under test",
        subtransactions: [
          { amount: -60.0, category_id: "cat-groceries" },
          { amount: -40.0, category_id: "cat-dining" },
        ],
      },
    ],
  })) as { transactions: Array<{ id: string }> };

  return created.transactions[0].id;
}

describe("updating an already-split transaction", () => {
  it("refuses a category change instead of deleting and recreating", async () => {
    const splitId = await createSplit();

    const result = (await harness.callTool("update_transactions", {
      budget_id: "budget-1",
      transactions: [{ transaction_id: splitId, category_id: "cat-groceries" }],
    })) as {
      results: Array<{
        transaction_id: string;
        status: string;
        error?: string;
      }>;
    };

    const outcome = result.results.find((r) => r.transaction_id === splitId);
    expect(outcome?.status).toBe("refused");
    expect(outcome?.error ?? "").toMatch(/split/i);
  });

  it("leaves the transaction present and unchanged after refusing", async () => {
    const splitId = await createSplit();

    await harness.callTool("update_transactions", {
      budget_id: "budget-1",
      transactions: [{ transaction_id: splitId, category_id: "cat-groceries" }],
    });

    // The decisive check: the original id must still resolve. Under the old
    // replace behaviour it had been deleted and reborn under a new id.
    const after = (await harness.callTool("search_transactions", {
      budget_id: "budget-1",
      queries: [{}],
    })) as {
      result_sets: Array<{
        transactions: Array<{ id: string; is_split: boolean }>;
      }>;
    };

    const stillThere = after.result_sets
      .flatMap((set) => set.transactions)
      .find((transaction) => transaction.id === splitId);

    expect(stillThere).toBeDefined();
    expect(stillThere?.is_split).toBe(true);
  });

  it("refuses a subtransactions rewrite too", async () => {
    const splitId = await createSplit();

    const result = (await harness.callTool("update_transactions", {
      budget_id: "budget-1",
      transactions: [
        {
          transaction_id: splitId,
          subtransactions: [
            { amount: -70.0, category_id: "cat-groceries" },
            { amount: -30.0, category_id: "cat-dining" },
          ],
        },
      ],
    })) as {
      results: Array<{ transaction_id: string; status: string }>;
    };

    expect(
      result.results.find((r) => r.transaction_id === splitId)?.status,
    ).toBe("refused");
  });

  it("still applies safe field updates to a split transaction", async () => {
    // Approving or annotating a split does not touch the frozen fields, so it
    // must keep working — the refusal has to be narrow, not a blanket block.
    const splitId = await createSplit();

    const result = (await harness.callTool("update_transactions", {
      budget_id: "budget-1",
      transactions: [
        { transaction_id: splitId, memo: "annotated", approved: true },
      ],
    })) as {
      results: Array<{ transaction_id: string; status: string }>;
    };

    expect(
      result.results.find((r) => r.transaction_id === splitId)?.status,
    ).toBe("updated");
  });
});
