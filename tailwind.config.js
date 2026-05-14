/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          base: 'var(--bg-base)',
          raised: 'var(--bg-raised)',
          surface: 'var(--bg-surface)',
          overlay: 'var(--bg-overlay)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border-default)',
        },
        content: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)',
        },
        stage: {
          saved: 'oklch(0.70 0.02 240)',
          applied: 'oklch(0.70 0.16 240)',
          interview: 'oklch(0.70 0.16 310)',
          accepted: 'oklch(0.70 0.16 155)',
          rejected: 'oklch(0.70 0.18 25)',
          withdrawn: 'oklch(0.60 0.02 240)',
          ghosted: 'oklch(0.52 0.02 240)',
        },
      },
    },
  },
  plugins: [],
};
