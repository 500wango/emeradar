/**
 * Disabled. Auxiliary sources must not overwrite a published window score,
 * Why Now, or verdict. See docs/05-SCORING-CONFIG-SPEC.md §3.3 and §5.0.
 */
console.error(
  'refresh-real-serp is disabled. Mixed news, GitHub, Stack Exchange, Hacker News, and Wikipedia rows cannot be written as an organic Top 10 or used to change w_basis_points, why_now_summary, or verdicts.'
);
process.exit(1);
