import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FakeBudgetBuilder } from "./fake-ynab/builder.js";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "./harness.js";
import { dateStr, seedStandardBudget } from "./seed.js";

/**
 * These tests check one thing: that the origin fields YNAB reports on a
 * transaction survive the trip to a tool response. They deliberately do not
 * assert anything about which combinations of those fields YNAB produces for a
 * given real-world event — the fake's semantics are not YNAB's, so encoding a
 * theory about that here would test the theory rather than the pass-through.
 */

const TRANSFER_DATE = dateStr(0, 4);
const IMPORT_DATE = dateStr(0, 5);

/** Direct Import's documented import_id shape: YNAB:[milliunits]:[date]:[n]. */
const DIRECT_IMPORT_ID = `YNAB:-42990:${IMPORT_DATE}:1`;

/** An import_id of the kind an API caller supplies — no required format. */
const API_IMPORT_ID = "pluggy-a1b2c3d4e5";

function seedProvenanceRecords(builder: FakeBudgetBuilder): void {
  seedStandardBudget(builder);

  builder
    // Two records pointing at each other's account and id.
    .withTransaction("tx-transfer-out", {
      account_id: "acct-checking",
      amount: -250000,
      date: TRANSFER_DATE,
      memo: "Transfer to savings",
      transfer_account_id: "acct-savings",
      transfer_transaction_id: "tx-transfer-in",
    })
    .withTransaction("tx-transfer-in", {
      account_id: "acct-savings",
      amount: 250000,
      date: TRANSFER_DATE,
      memo: "Transfer from checking",
      transfer_account_id: "acct-checking",
      transfer_transaction_id: "tx-transfer-out",
    })
    // An imported record carrying both imported payee names and a match.
    .withTransaction("tx-direct-import", {
      account_id: "acct-checking",
      amount: -42990,
      date: IMPORT_DATE,
      category_id: "cat-groceries",
      import_id: DIRECT_IMPORT_ID,
      import_payee_name: "GROCERY STORE 4412",
      import_payee_name_original: "SQ *GROCERY STORE 4412 CHICAGO IL",
      matched_transaction_id: "tx-hand-entered",
    })
    // An imported record whose import_id came from an API caller.
    .withTransaction("tx-api-import", {
      account_id: "acct-checking",
      amount: -18500,
      date: IMPORT_DATE,
      category_id: "cat-groceries",
      import_id: API_IMPORT_ID,
    })
    // A record with none of the origin fields set.
    .withTransaction("tx-hand-entered", {
      account_id: "acct-checking",
      amount: -42990,
      date: IMPORT_DATE,
      category_id: "cat-groceries",
      memo: "Entered by hand",
    });
}

interface ProvenanceShape {
  import_id?: string;
  import_payee_name?: string;
  import_payee_name_original?: string;
  matched_transaction_id?: string;
  transfer_account_id?: string;
  transfer_account_name?: string | null;
  transfer_transaction_id?: string;
}

interface SearchResult {
  result_sets: Array<{
    transactions: Array<{
      id: string;
      memo: string | null;
      account_name: string | null;
      provenance?: ProvenanceShape;
    }>;
  }>;
}

let harness: IntegrationHarness;

beforeEach(async () => {
  harness = await createIntegrationHarness({ seed: seedProvenanceRecords });
});

afterEach(async () => {
  await harness.close();
});

/** Every seeded transaction, keyed by id, as search_transactions returns it. */
async function searchAllById(): Promise<
  Map<string, SearchResult["result_sets"][number]["transactions"][number]>
> {
  const result = (await harness.callTool("search_transactions", {
    queries: [{ limit: 500 }],
  })) as SearchResult;

  return new Map(result.result_sets[0].transactions.map((tx) => [tx.id, tx]));
}

describe("search_transactions provenance", () => {
  it("reports import_id for an imported record and omits provenance for one with no origin fields", async () => {
    const byId = await searchAllById();

    expect(byId.get("tx-direct-import")?.provenance?.import_id).toBe(
      DIRECT_IMPORT_ID,
    );
    expect(byId.get("tx-api-import")?.provenance?.import_id).toBe(
      API_IMPORT_ID,
    );

    const handEntered = byId.get("tx-hand-entered");
    expect(handEntered).toBeDefined();
    expect(handEntered).not.toHaveProperty("provenance");
  });

  it("reports both imported payee names", async () => {
    const byId = await searchAllById();
    const provenance = byId.get("tx-direct-import")?.provenance;

    expect(provenance?.import_payee_name).toBe("GROCERY STORE 4412");
    expect(provenance?.import_payee_name_original).toBe(
      "SQ *GROCERY STORE 4412 CHICAGO IL",
    );
  });

  it("reports matched_transaction_id naming a transaction in the same result set", async () => {
    const byId = await searchAllById();
    const matchedId =
      byId.get("tx-direct-import")?.provenance?.matched_transaction_id;

    expect(matchedId).toBe("tx-hand-entered");
    expect(byId.has(matchedId as string)).toBe(true);
  });

  it("reports each transfer side's account and paired transaction, with the account name resolved", async () => {
    const byId = await searchAllById();

    expect(byId.get("tx-transfer-out")?.provenance).toEqual({
      transfer_account_id: "acct-savings",
      transfer_account_name: "Savings",
      transfer_transaction_id: "tx-transfer-in",
    });
    expect(byId.get("tx-transfer-in")?.provenance).toEqual({
      transfer_account_id: "acct-checking",
      transfer_account_name: "Checking",
      transfer_transaction_id: "tx-transfer-out",
    });
  });

  it("leaves transactions seeded without origin fields free of a provenance key", async () => {
    const byId = await searchAllById();
    const seedStandardTransactionIds = ["tx-1", "tx-2", "tx-3"];

    for (const id of seedStandardTransactionIds) {
      const transaction = byId.get(id);
      expect(transaction).toBeDefined();
      expect(transaction).not.toHaveProperty("provenance");
    }
  });

  it("documents the omission convention in the tool description", async () => {
    const { tools } = await harness.client.listTools();
    const search = tools.find((tool) => tool.name === "search_transactions");

    // Absence of the key is only readable as "YNAB reported none of these"
    // if the description says so, so the description is part of the contract.
    expect(search?.description).toContain("provenance");
    expect(search?.description).toContain("omitted entirely");
  });
});

describe("update_transactions provenance", () => {
  it("still reports provenance on the record it returns after an update", async () => {
    const result = (await harness.callTool("update_transactions", {
      transactions: [
        { transaction_id: "tx-transfer-out", memo: "Renamed memo" },
      ],
    })) as {
      results: Array<{
        status: string;
        transaction?: { memo: string | null; provenance?: ProvenanceShape };
      }>;
    };

    const updated = result.results[0];
    expect(updated.status).toBe("updated");
    expect(updated.transaction?.memo).toBe("Renamed memo");
    expect(updated.transaction?.provenance).toEqual({
      transfer_account_id: "acct-savings",
      transfer_account_name: "Savings",
      transfer_transaction_id: "tx-transfer-in",
    });
  });
});
