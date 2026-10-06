/**
 * Stamped into every ledger row this scorer writes (05 §7.2). Existing rows keep their
 * own stored version, so a bump is forward-only. Bump when rules change output for the same input.
 */
export const SCORING_CONFIG_VERSION = 'sc-1.1.0';
