import { Inter, JetBrains_Mono, Syne } from 'next/font/google';

/**
 * Only Latin-script webfonts are self-hosted here (~130 KB total).
 *
 * CJK stays on system fonts on purpose: `next/font/google` has no
 * `chinese-simplified` subset for Noto Sans/Serif SC, so it downloads all 101
 * unicode-range slices at build time (~4.3 MB and ~5.75 MB respectively) and
 * makes the browser fetch several MB for a Chinese landing page — which blows
 * the FCP budget in docs/16 §5. The CJK fallback stacks live in globals.css.
 *
 * These variables are consumed by `fontFamily` in tailwind.config.ts and must
 * be mounted on <html> so they resolve at the `:root` level.
 */

export const fontSans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const fontDisplay = Syne({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  display: 'swap',
  variable: '--font-display',
});

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-mono',
});

export const fontVariables = [fontSans.variable, fontDisplay.variable, fontMono.variable].join(' ');
