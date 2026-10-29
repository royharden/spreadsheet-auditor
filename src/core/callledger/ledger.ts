import { MAX_OUTPUT_TOKENS, MAX_RETRIES } from '../explain/limits.ts';
import type { TriageArm } from '../explain/prompt.ts';
import type { AttemptUsage } from '../providers/types.ts';
import { priceFor, type Price } from './prices.ts';
export interface LedgerRow {
  ts: string; arm: TriageArm; model: string; requestId: string; bundles: number;
  inputTokens: number | null; outputTokens: number | null; latencyMs: number; costUsd: number | null; status: string;
  /** Conservative amount already consumed from the run budget, including a possible retry. */
  reservedUsd?: number;
}
export class BudgetError extends Error { constructor(message: string) { super(message); this.name = 'BudgetError'; } }
export class CallLedger {
  readonly rows: LedgerRow[];
  private reserved: number;
  readonly budgetUsd: number;
  readonly prices: readonly Price[] | undefined;
  constructor(budgetUsd: number, initial: readonly LedgerRow[] = [], prices?: readonly Price[]) {
    this.budgetUsd = budgetUsd;
    this.prices = prices;
    if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw new BudgetError('A finite nonnegative budget is required.');
    this.rows = initial.map((row) => ({ ...row }));
    if (initial.some((row) => row.status !== 'replay' && (row.reservedUsd === undefined || !Number.isFinite(row.reservedUsd) || row.reservedUsd < 0))) throw new BudgetError('Cannot resume a budget with unbounded prior calls.');
    this.reserved = initial.reduce((sum, row) => sum + (row.reservedUsd ?? 0), 0);
  }
  /** UTF-8 bytes are a conservative token bound; reserve both attempts before any transport. */
  reserve(model: string, requestBytes: number, outputTokens = MAX_OUTPUT_TOKENS): number {
    const price = priceFor(model, this.prices);
    if (!price) throw new BudgetError('Verified dated pricing is unavailable; no model call is permitted.');
    if (!Number.isSafeInteger(requestBytes) || requestBytes < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 1) throw new BudgetError('Invalid call bounds.');
    const worst = ((requestBytes * price.inputUsdPerMillion + outputTokens * price.outputUsdPerMillion) / 1e6) * (1 + MAX_RETRIES);
    if (this.reserved + worst > this.budgetUsd) throw new BudgetError('The next call could exceed EVAL_BUDGET_USD.');
    this.reserved += worst;
    return worst;
  }
  record(context: { arm: TriageArm; model: string; requestId: string; bundles: number }, usage: AttemptUsage, reservedUsd = 0): LedgerRow {
    const price = priceFor(context.model, this.prices);
    const costUsd = price && usage.inputTokens !== null && usage.outputTokens !== null ? (usage.inputTokens * price.inputUsdPerMillion + usage.outputTokens * price.outputUsdPerMillion) / 1e6 : null;
    const row = { ...context, ...usage, ts: new Date().toISOString(), costUsd, reservedUsd };
    this.rows.push(row);
    return row;
  }
}
export function costLabel(value: number | null): string { return value === null ? 'unknown' : `$${value.toFixed(6)}`; }
