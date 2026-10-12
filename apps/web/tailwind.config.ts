import type { Config } from 'tailwindcss';

/**
 * Semantic design tokens.
 *
 * Every token resolves to `rgb(var(--c-*) / <alpha-value>)` so opacity
 * modifiers (`bg-surface/70`, `border-line/40`) keep working.
 *
 * The Tailwind default palette is deliberately NOT overridden: the token layer
 * covers the product surface, but a newly added page should still be able to
 * reach for a literal `slate-*` without a config change.
 */
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          2: token('surface-2'),
        },
        overlay: token('overlay'),
        inverse: {
          DEFAULT: token('inverse'),
          fg: token('inverse-fg'),
          line: token('inverse-line'),
          // Text levels and signal colours for content *inside* an inverse
          // panel. The main tokens mean "dark ink for paper" and are unreadable
          // on the well; the `.on-inverse` scope re-points them automatically,
          // and these names are for when a call site wants to be explicit.
          'fg-muted': token('inverse-fg-muted'),
          'fg-subtle': token('inverse-fg-subtle'),
          signal: token('inverse-signal'),
          warn: token('inverse-warn'),
          info: token('inverse-info'),
          danger: token('inverse-danger'),
          accent: token('inverse-accent'),
        },
        // "The page's dominant ink, as a fill" — see globals.css.
        solid: {
          DEFAULT: token('solid'),
          fg: token('solid-fg'),
        },
        // Hairlines — see globals.css for which level to reach for.
        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
          control: token('line-control'),
        },
        // Text
        fg: {
          DEFAULT: token('fg'),
          muted: token('fg-muted'),
          subtle: token('fg-subtle'),
        },
        // Interaction
        accent: {
          DEFAULT: token('accent'),
          fg: token('accent-fg'),
        },
        // Signals. `warn` is the only one ever used as a solid fill, so it is
        // the only one that needs a paired label colour today; the rest are
        // used exclusively as tints (`bg-signal/10 text-signal`).
        signal: token('signal'),
        warn: {
          DEFAULT: token('warn'),
          fg: token('warn-fg'),
        },
        danger: {
          DEFAULT: token('danger'),
          fg: token('danger-fg'),
        },
        info: token('info'),
        // The three evaluation axes get their own colours: a single shared
        // "positive" colour would make the D/M/W readout unreadable.
        'axis-d': token('axis-d'),
        'axis-m': token('axis-m'),
        'axis-w': token('axis-w'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'var(--font-cjk-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-cjk-serif)', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
