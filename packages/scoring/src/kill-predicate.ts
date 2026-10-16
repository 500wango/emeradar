export type KillOperator = '<' | '<=' | '>' | '>=' | '==' | '!=';

export interface KillPredicate {
  metric: string;
  op: KillOperator;
  threshold: number;
}

export const KILL_METRICS = ['weak_result_ratio', 'd_basis_points', 'w_basis_points', 'm_basis_points'] as const;
export type KillMetric = (typeof KILL_METRICS)[number];

const OPERATORS: readonly string[] = ['<', '<=', '>', '>=', '==', '!='];

export function parseKillPredicate(raw: unknown): KillPredicate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { metric, op, threshold } = raw as Record<string, unknown>;
  if (typeof metric !== 'string' || !(KILL_METRICS as readonly string[]).includes(metric)) return null;
  if (typeof op !== 'string' || !OPERATORS.includes(op)) return null;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return null;
  return { metric, op: op as KillOperator, threshold };
}

/**
 * Evaluates one stored kill predicate against today's metrics.
 * Returns null when the predicate is malformed or the metric has no value today:
 * "cannot evaluate" must not be read as "not triggered".
 */
export function evaluateKillPredicate(
  raw: unknown,
  metrics: Partial<Record<string, number | null | undefined>>
): boolean | null {
  const predicate = parseKillPredicate(raw);
  if (!predicate) return null;
  const value = metrics[predicate.metric];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  switch (predicate.op) {
    case '<':
      return value < predicate.threshold;
    case '<=':
      return value <= predicate.threshold;
    case '>':
      return value > predicate.threshold;
    case '>=':
      return value >= predicate.threshold;
    case '==':
      return value === predicate.threshold;
    case '!=':
      return value !== predicate.threshold;
  }
}
