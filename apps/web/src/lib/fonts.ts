import localFont from 'next/font/local';

/**
 * Self-hosted Latin webfonts.
 *
 * These used to come from `next/font/google`, which fetches fonts from
 * fonts.gstatic.com **at build time**. That made every Docker build depend on
 * Google's availability: a transient font response failed the entire deploy
 * (`TypeError: Cannot read properties of null (reading '1')` in next/font's
 * loader) even though no application code had changed.
 *
 * The `.woff2` files in `./fonts/` are the Latin subsets of the same OFL
 * families. CJK still uses system fonts; see globals.css for the fallback stack.
 */

export const fontSans = localFont({
  src: './fonts/inter-latin.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-sans',
});

export const fontDisplay = localFont({
  src: './fonts/syne-latin.woff2',
  weight: '600 800',
  display: 'swap',
  variable: '--font-display',
});

export const fontMono = localFont({
  src: './fonts/mono-latin.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--font-mono',
});

export const fontVariables = [fontSans.variable, fontDisplay.variable, fontMono.variable].join(' ');
