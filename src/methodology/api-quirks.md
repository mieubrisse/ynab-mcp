# YNAB API Quirks and Limitations

Known limitations of the YNAB API that affect what you can do through this MCP server.

## Scheduled Transaction Frequencies

The current YNAB API spec accepts the full 13-value frequency enum on create
and update — the same values it returns on reads: `never`, `daily`, `weekly`,
`everyOtherWeek`, `twiceAMonth`, `every4Weeks`, `monthly`, `everyOtherMonth`,
`every3Months`, `every4Months`, `twiceAYear`, `yearly`, `everyOtherYear`.

Earlier API versions rejected compound values (like `everyOtherWeek`) on
writes and refused any update to a compound-frequency scheduled transaction.
That restriction is no longer in the spec — but note the evidence differs in
kind: the old restriction was observed against the live API, while its
removal is so far only established from the published spec (write access was
not available to re-verify it). If the live API still rejects a compound
value, the per-item error result of the create/update tool reports it
without failing the rest of the batch; fall back to a simple frequency plus
a memo naming the real cadence in that case.

Two constraints that do still apply:

- The scheduled transaction `date` must be in the future and no more than
  5 years out.
- Scheduled transactions cannot have splits (subtransactions) through the
  API; split scheduled transactions can only be managed in the YNAB app.

## Split (Multi-Category) Transactions

### Creating splits

To create a split transaction, provide a `subtransactions` array on the transaction. Each subtransaction has its own `amount`, `category_id`, and optional `memo`. Subtransaction amounts must sum to the parent `amount`. The parent `category_id` can be omitted — YNAB assigns a special "Split" category automatically.

### Modifying splits

The YNAB API does not support modifying `subtransactions` or `category_id` on an existing split transaction — those changes are silently ignored. The only mechanism that would achieve it is deleting the transaction and creating a replacement, and **this server refuses to do that**. YNAB has no undelete, the replacement carries a new ID, and its `import_id` link to the imported bank record cannot be recreated — so a routine-looking categorization would destroy a record and sever its bank matching. That is a deletion, and it needs an explicit decision rather than happening inside a batch update.

- Changing `subtransactions` or `category_id` on an existing split returns `status: "refused"` with an explanation. Nothing is written, and the rest of the batch still applies.
- Non-split fields (memo, flag, date, amount, payee, cleared, approved) update normally on a split, and the ID does not change.
- `undo_operations` follows the same rule: undoing a memo or approval change on a split restores it in place, but an undo that would have to change the split's category or subtransactions is refused rather than performed destructively.
- To make such a change, do it by hand in the YNAB app, or delete and recreate the transaction deliberately.

### Converting between split and non-split

- Converting a non-split transaction to a split (by adding `subtransactions`) works.
- **Un-splitting is not supported.** Setting a `category_id` on a split is refused for the reason above. It is also not reversible through `undo_operations` — treat converting a transaction to a split as a one-way step.

## Scheduled Transaction Date Validation

When updating a scheduled transaction, the date must be no more than 1 week in the past and no more than 5 years in the future. Old scheduled transactions with a `date_first` far in the past may fail to update for this reason.
