import { asCurrency, currencyToMilliunits } from "../ynab/format.js";

/**
 * Reject a split whose parts do not sum to the parent amount.
 *
 * YNAB rejects these itself, but its error names no numbers and the attempt
 * still spends one of the 200 requests allowed per hour. Checking here turns a
 * wasted round trip into a message that says which two totals disagree.
 *
 * Amounts are currency units, matching the tool schemas. They are compared in
 * milliunits — the integer representation YNAB actually stores — so that
 * ordinary floating-point error (0.1 + 0.2 !== 0.3) cannot reject a correct
 * split.
 */
export function assertSplitPartsSumToParent(
  parentAmount: number,
  parts: ReadonlyArray<{ amount: number }>,
): void {
  if (parts.length === 0) {
    return;
  }

  const parentMilliunits = currencyToMilliunits(asCurrency(parentAmount));
  const partsMilliunits = parts.reduce(
    (total, part) => total + currencyToMilliunits(asCurrency(part.amount)),
    0,
  );

  if (partsMilliunits === parentMilliunits) {
    return;
  }

  const partsCurrency = partsMilliunits / 1000;
  const scaleHint =
    partsMilliunits !== 0 && partsMilliunits === parentMilliunits * 1000
      ? " These parts are exactly 1000x the parent, which is what happens when " +
        "milliunits are passed to a field that takes currency units: send -5.55, not -5550."
      : "";

  throw new Error(
    `Split parts must sum to the parent amount. The parts sum to ${partsCurrency} ` +
      `but the transaction is ${parentAmount}.${scaleHint} ` +
      "Amounts are in currency units and outflows are negative, so the parts of " +
      "a -100 charge might be -60 and -40.",
  );
}
