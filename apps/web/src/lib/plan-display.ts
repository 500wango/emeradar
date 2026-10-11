/**
 * How a plan tier is named in the interface.
 *
 * `TEAM` is a legacy compatibility value, not a current product tier: the
 * product sells Free and Builder Pro, and Team workspace, multi-seat and public
 * purchase were removed (13 §3.1, 24 §6). It is kept in the schema so existing
 * accounts keep working, which is exactly why it must not be printed as a raw
 * enum — an account that renders "TEAM TIER" advertises a plan nobody can buy.
 *
 * Every surface that names a tier goes through here so the wording cannot drift
 * again (the profile badge and the plan card used to print `{tier} TIER` while
 * the navigation bar and the billing tab already said "Legacy plan").
 */
const TIER_LABEL_KEYS: Record<string, string> = {
  TEAM: 'nav.legacyPlan',
  PRO: 'nav.builderPro',
  FREE: 'nav.freeStarter',
};

/** Returns the translation key naming `tier`, defaulting to the free label. */
export function planLabelKey(tier: string | null | undefined): string {
  return TIER_LABEL_KEYS[tier ?? ''] ?? TIER_LABEL_KEYS.FREE;
}

/**
 * The plan code a surface should name, from whichever record it happens to hold.
 *
 * `planCode` is the authoritative resolution — `COALESCE(s.plan_code, u.tier)` —
 * and `tier` is the raw column, which only agrees with it while every writer
 * keeps the two in step (the Stripe webhook does; a hand-granted subscription
 * row may not). Preferring `planCode` is what stops a card from naming one plan
 * while the quota gauges printed beside it were computed from another.
 */
export function resolvePlanCode(
  source: { planCode?: string | null; tier?: string | null } | null | undefined
): string {
  return source?.planCode || source?.tier || 'FREE';
}
