import { describe, expect, it } from "vitest";
import { assertSplitPartsSumToParent } from "./split-sum.js";

// YNAB rejects a split whose parts do not sum to the parent, but its error text
// does not name the offending numbers and the attempt still costs one of the
// 200 requests per hour. Checking locally turns a wasted round trip into a
// message that says exactly what is wrong.
//
// Amounts here are currency units, matching the tool schemas.

describe("assertSplitPartsSumToParent", () => {
  it("accepts parts that sum exactly", () => {
    assertSplitPartsSumToParent(-100, [{ amount: -60 }, { amount: -40 }]);
  });

  it("accepts sums that only match after floating-point rounding", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Comparing raw sums would
    // reject this correct split.
    assertSplitPartsSumToParent(-0.3, [{ amount: -0.1 }, { amount: -0.2 }]);
  });

  it("accepts a sub-cent split that still lands on whole milliunits", () => {
    assertSplitPartsSumToParent(-1.234, [{ amount: -1.0 }, { amount: -0.234 }]);
  });

  it("rejects parts that do not sum to the parent", () => {
    expect(() =>
      assertSplitPartsSumToParent(-100, [{ amount: -60 }, { amount: -30 }]),
    ).toThrow(/sum/i);
  });

  it("names both totals so the caller can correct the call", () => {
    let message = "";
    try {
      assertSplitPartsSumToParent(-100, [{ amount: -60 }, { amount: -30 }]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("-90");
    expect(message).toContain("-100");
  });

  it("rejects sign-flipped parts", () => {
    expect(() =>
      assertSplitPartsSumToParent(-100, [{ amount: 60 }, { amount: 40 }]),
    ).toThrow(/sum/i);
  });

  it("catches the milliunit mistake, where parts are 1000x the parent", () => {
    // The schemas take currency units, so a caller thinking in milliunits
    // sends -60000/-40000 against a -100 parent.
    expect(() =>
      assertSplitPartsSumToParent(-100, [
        { amount: -60000 },
        { amount: -40000 },
      ]),
    ).toThrow(/sum/i);
  });

  it("mentions milliunits when the parts look like a scale mistake", () => {
    let message = "";
    try {
      assertSplitPartsSumToParent(-100, [
        { amount: -60000 },
        { amount: -40000 },
      ]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/currency units|milliunits/i);
  });

  it("ignores an empty parts list, which is not a split at all", () => {
    assertSplitPartsSumToParent(-100, []);
  });
});
