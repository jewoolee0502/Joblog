/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        stage: {
          saved: '#94a3b8',
          applied: '#3b82f6',
          acknowledged: '#06b6d4',
          screening: '#8b5cf6',
          interview: '#a855f7',
          final: '#ec4899',
          offer: '#10b981',
          accepted: '#059669',
          rejected: '#ef4444',
          withdrawn: '#6b7280',
          ghosted: '#475569',
        },
      },
    },
  },
  plugins: [],
};
