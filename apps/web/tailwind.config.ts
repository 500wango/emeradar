import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        radar: {
          blue: '#2563eb',
          emerald: '#10b981',
          amber: '#f59e0b',
          rose: '#f43f5e',
          slate: '#0f172a',
        },
      },
    },
  },
  plugins: [],
};

export default config;
