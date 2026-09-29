import { query } from '@emeradar/db';
import { CostRecord, BudgetGuard } from './types';

export class CostLedgerService {
  /**
   * Atomically records a cost expenditure in the cost_ledger table
   */
  static async recordCost(cost: CostRecord): Promise<void> {
    await query(
      `INSERT INTO cost_ledger (source_id, opportunity_id, cost_usd, category)
       VALUES ($1, $2, $3, $4)`,
      [
        cost.sourceId,
        cost.opportunityId || null,
        cost.costUsd,
        cost.category,
      ]
    );
  }

  /**
   * Get total cost spent for a specific date
   */
  static async getDailySpend(obsDate: string): Promise<number> {
    const res = await query<{ total_cost: string }>(
      `SELECT COALESCE(SUM(cost_usd), 0)::text as total_cost 
       FROM cost_ledger 
       WHERE DATE(recorded_at) = $1`,
      [obsDate]
    );
    return parseFloat(res.rows[0]?.total_cost || '0');
  }

  /**
   * Creates an active BudgetGuard for the day
   */
  static async createBudgetGuard(
    obsDate: string,
    maxDailyBudgetUsd = 10.0
  ): Promise<BudgetGuard> {
    const currentSpent = await this.getDailySpend(obsDate);

    let spent = currentSpent;
    return {
      maxDailyBudgetUsd,
      currentSpentUsd: currentSpent,
      canSpend(costUsd: number): boolean {
        if (spent + costUsd > maxDailyBudgetUsd) return false;
        spent += costUsd;
        return true;
      },
    };
  }
}
