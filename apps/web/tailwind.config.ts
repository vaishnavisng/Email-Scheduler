import type { Config } from 'tailwindcss';

/**
 * Design tokens — the single source of visual truth for the dashboard. No colour,
 * radius, shadow or font value is written anywhere else; components compose only
 * from the scale defined here. There is no external Figma reference for this
 * assignment, so this is a self-consistent, neutral SaaS system (slate + indigo).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#4f46e5', hover: '#4338ca', subtle: '#eef2ff' },
        bg: '#f8fafc',
        surface: '#ffffff',
        border: '#e2e8f0',
        ink: { DEFAULT: '#0f172a', muted: '#64748b', faint: '#94a3b8' },
        success: { DEFAULT: '#15803d', subtle: '#dcfce7' },
        warning: { DEFAULT: '#b45309', subtle: '#fef3c7' },
        danger: { DEFAULT: '#b91c1c', subtle: '#fee2e2' },
        info: { DEFAULT: '#0369a1', subtle: '#e0f2fe' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        full: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15,23,42,0.04), 0 1px 3px 0 rgba(15,23,42,0.06)',
        dropdown: '0 4px 16px rgba(15,23,42,0.12)',
        modal: '0 10px 40px rgba(15,23,42,0.20)',
      },
    },
  },
  plugins: [],
};

export default config;
