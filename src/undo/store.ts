import { randomUUID } from "node:crypto";

import type { PendingOperation, UndoEntry, UndoHistoryFile } from "./types.js";

/**
 * Pending-operation markers describe an interrupted (or ambiguous) write.
 * They exist precisely because nobody has reconciled the outcome yet, so
 * the expiry errs long — a week, not a day, since an unattended marker can
 * easily span a weekend — after which they expire on read and are dropped
 * from the file on the next persisted write.
 */
const PENDING_OPERATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface ListHistoryOptions {
  limit: number;
  offset?: number;
  includeUndone: boolean;
}

interface IdMappingUpdate {
  sourceEntityId: string;
  targetEntityId: string;
}

/**
 * In-process undo history, keyed by budget.
 *
 * This deliberately does NOT persist to disk. The server runs inside a sandbox
 * granted network access to api.ynab.com and nothing else — no read, no write,
 * no filesystem at all — because that boundary is what limits the blast radius
 * of every dependency in the tree. Buying an undo journal with filesystem
 * access would have been a poor trade.
 *
 * The consequence, stated plainly: undo history does not survive a restart. It
 * covers the window that matters most — a long batch run inside one session —
 * and durable reversal is a workflow-layer concern, where the before-state is
 * already in hand and can be recorded without granting the server anything.
 */
export class UndoStore {
  private readonly maxEntriesPerBudget: number;

  private readonly budgetLocks = new Map<string, Promise<void>>();

  private readonly historyByBudget = new Map<string, UndoHistoryFile>();

  // The cap bounds memory rather than serialization latency now: ~1 KB per
  // compact entry keeps a full 2000-entry history around 2 MB per budget.
  constructor(maxEntriesPerBudget = 2000) {
    this.maxEntriesPerBudget = maxEntriesPerBudget;
  }

  async appendEntries(
    budgetId: string,
    entries: UndoEntry[],
    idMappings: IdMappingUpdate[] = [],
  ): Promise<void> {
    if (entries.length === 0 && idMappings.length === 0) {
      return;
    }

    await this.withBudgetLock(budgetId, async () => {
      const current = await this.readBudgetHistoryUnsafe(budgetId);
      current.entries = [...entries, ...current.entries].slice(
        0,
        this.maxEntriesPerBudget,
      );

      for (const { sourceEntityId, targetEntityId } of idMappings) {
        this.applyIdMapping(current, sourceEntityId, targetEntityId);
      }
      this.pruneIdMappings(current);

      await this.writeBudgetHistoryUnsafe(budgetId, current);
    });
  }

  async listEntries(
    budgetId: string,
    options: ListHistoryOptions,
  ): Promise<{ entries: UndoEntry[]; total: number }> {
    const history = await this.readBudgetHistory(budgetId);
    const filtered = history.entries.filter((entry) => {
      if (!options.includeUndone && entry.status !== "active") {
        return false;
      }

      return true;
    });

    const offset = options.offset ?? 0;
    return {
      entries: filtered.slice(offset, offset + options.limit),
      total: filtered.length,
    };
  }

  async getEntriesByIds(
    budgetId: string,
    entryIds: string[],
  ): Promise<Array<UndoEntry | undefined>> {
    const history = await this.readBudgetHistory(budgetId);
    const index = new Map(history.entries.map((entry) => [entry.id, entry]));

    return entryIds.map((entryId) => index.get(entryId));
  }

  async markEntriesUndone(budgetId: string, entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) {
      return;
    }

    await this.withBudgetLock(budgetId, async () => {
      const history = await this.readBudgetHistoryUnsafe(budgetId);
      const entryIdSet = new Set(entryIds);

      history.entries = history.entries.map((entry) => {
        if (entryIdSet.has(entry.id)) {
          return {
            ...entry,
            status: "undone",
          };
        }

        return entry;
      });

      await this.writeBudgetHistoryUnsafe(budgetId, history);
    });
  }

  async resolveMappedId(budgetId: string, entityId: string): Promise<string> {
    const history = await this.readBudgetHistory(budgetId);
    return this.resolveMappedIdFromHistory(history, entityId);
  }

  async updateIdMappings(
    budgetId: string,
    sourceEntityId: string,
    targetEntityId: string,
  ): Promise<void> {
    await this.withBudgetLock(budgetId, async () => {
      const history = await this.readBudgetHistoryUnsafe(budgetId);
      this.applyIdMapping(history, sourceEntityId, targetEntityId);

      await this.writeBudgetHistoryUnsafe(budgetId, history);
    });
  }

  async markPending(budgetId: string, description: string): Promise<string> {
    // The random suffix keeps same-millisecond markers distinct, so
    // clearing one cannot delete another.
    const id = `${budgetId}::pending::${Date.now()}::${randomUUID().slice(0, 8)}`;
    const op: PendingOperation = {
      id,
      budget_id: budgetId,
      timestamp: new Date().toISOString(),
      description,
    };

    await this.withBudgetLock(budgetId, async () => {
      const history = await this.readBudgetHistoryUnsafe(budgetId);
      const pending = history.pending_operations ?? [];
      pending.push(op);
      history.pending_operations = pending;
      await this.writeBudgetHistoryUnsafe(budgetId, history);
    });

    return id;
  }

  async annotatePending(
    budgetId: string,
    pendingId: string,
    note: string,
  ): Promise<void> {
    await this.withBudgetLock(budgetId, async () => {
      const history = await this.readBudgetHistoryUnsafe(budgetId);
      const operation = (history.pending_operations ?? []).find(
        (op) => op.id === pendingId,
      );
      if (!operation) return;
      operation.note = note;
      await this.writeBudgetHistoryUnsafe(budgetId, history);
    });
  }

  async clearPending(budgetId: string, pendingId: string): Promise<void> {
    await this.withBudgetLock(budgetId, async () => {
      const history = await this.readBudgetHistoryUnsafe(budgetId);
      history.pending_operations = (history.pending_operations ?? []).filter(
        (op) => op.id !== pendingId,
      );
      await this.writeBudgetHistoryUnsafe(budgetId, history);
    });
  }

  async getPendingOperations(budgetId: string): Promise<PendingOperation[]> {
    const history = await this.readBudgetHistory(budgetId);
    return history.pending_operations ?? [];
  }

  private applyIdMapping(
    history: UndoHistoryFile,
    sourceEntityId: string,
    targetEntityId: string,
  ): void {
    history.id_mappings[sourceEntityId] = targetEntityId;

    for (const [key, value] of Object.entries(history.id_mappings)) {
      if (value === sourceEntityId) {
        history.id_mappings[key] = targetEntityId;
      }
    }

    for (const key of Object.keys(history.id_mappings)) {
      history.id_mappings[key] = this.resolveMappedIdFromHistory(history, key);
    }
  }

  private resolveMappedIdFromHistory(
    history: UndoHistoryFile,
    entityId: string,
  ): string {
    const visited = new Set<string>();
    let current = entityId;

    while (history.id_mappings[current] && !visited.has(current)) {
      visited.add(current);
      current = history.id_mappings[current];
    }

    return current;
  }

  private async readBudgetHistory(budgetId: string): Promise<UndoHistoryFile> {
    return this.withBudgetLock(budgetId, async () =>
      this.readBudgetHistoryUnsafe(budgetId),
    );
  }

  private readBudgetHistoryUnsafe(budgetId: string): Promise<UndoHistoryFile> {
    const stored = this.historyByBudget.get(budgetId);
    if (!stored) {
      // Must be a genuinely fresh object, not `{ ...DEFAULT_HISTORY }`: that
      // spread is shallow, so every budget would share one `id_mappings`
      // object and writes would leak across budgets. The old on-disk path got
      // away with it because JSON round-tripping produced new objects.
      return Promise.resolve({
        entries: [],
        id_mappings: {},
        pending_operations: [],
      });
    }

    // Expired pending markers are filtered on read, exactly as they were when
    // this came off disk, so a marker cannot outlive its usefulness.
    return Promise.resolve({
      entries: stored.entries,
      id_mappings: stored.id_mappings,
      pending_operations: (stored.pending_operations ?? []).filter(
        (op) => !this.isExpiredPendingOperation(op),
      ),
    });
  }

  private writeBudgetHistoryUnsafe(
    budgetId: string,
    history: UndoHistoryFile,
  ): Promise<void> {
    this.historyByBudget.set(budgetId, history);
    return Promise.resolve();
  }

  private pruneIdMappings(history: UndoHistoryFile): void {
    const referencedIds = new Set<string>();
    for (const entry of history.entries) {
      referencedIds.add(entry.undo_action.entity_id);
    }

    for (const key of Object.keys(history.id_mappings)) {
      const resolved = this.resolveMappedIdFromHistory(history, key);
      if (!referencedIds.has(key) && !referencedIds.has(resolved)) {
        delete history.id_mappings[key];
      }
    }
  }

  private isExpiredPendingOperation(op: PendingOperation): boolean {
    const timestamp = Date.parse(op.timestamp);
    // An unparseable timestamp is kept, not silently dropped: the marker
    // is a warning about an unreconciled write, and losing it is worse
    // than showing a malformed one.
    if (!Number.isFinite(timestamp)) return false;
    return Date.now() - timestamp > PENDING_OPERATION_MAX_AGE_MS;
  }

  /**
   * Serialize read-modify-write cycles per budget.
   *
   * Still required even though the history is now in memory: a cycle reads,
   * mutates and writes back across `await` points, so two concurrent tool
   * calls against the same budget could otherwise interleave and lose one
   * another's entries. Each server process owns its own history, so there is
   * no cross-process case to reason about any more.
   */
  private async withBudgetLock<T>(
    budgetId: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const previous = this.budgetLocks.get(budgetId) ?? Promise.resolve();
    let releaseLock: (() => void) | undefined;

    const current = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.budgetLocks.set(
      budgetId,
      previous.then(() => current),
    );

    await previous;

    try {
      return await callback();
    } finally {
      releaseLock?.();
      if (this.budgetLocks.get(budgetId) === current) {
        this.budgetLocks.delete(budgetId);
      }
    }
  }
}
