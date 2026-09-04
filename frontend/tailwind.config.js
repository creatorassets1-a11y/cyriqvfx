/**
 * Tailwind reads the tokens rather than redefining them, so the design system
 * has exactly one source of truth (src/styles/tokens.css) and a utility class
 * can never drift from it.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'var(--ground)',
        inset: 'var(--ground-inset)',
        raised: 'var(--ground-raised)',
        'raised-hover': 'var(--ground-raised-hover)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        'text-4': 'var(--text-4)',
        'on-fill': 'var(--text-on-fill)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        accent: 'var(--accent)',
        'accent-bright': 'var(--accent-bright)',
        'accent-dim': 'var(--accent-dim)',
        'accent-wash': 'var(--accent-wash)',
        'accent-wash-deep': 'var(--accent-wash-deep)',
        navy: 'var(--navy)',
        'navy-deep': 'var(--navy-deep)',
        positive: 'var(--positive)',
        'positive-wash': 'var(--positive-wash)',
        caution: 'var(--caution)',
        'caution-wash': 'var(--caution-wash)',
        critical: 'var(--critical)',
        'critical-wash': 'var(--critical-wash)',
      },
      fontFamily: {
        display: 'var(--face-display)',
        sans: 'var(--face-ui)',
        mono: 'var(--face-mono)',
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r-md)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        full: 'var(--r-full)',
      },
      boxShadow: {
        raise: 'var(--raise)',
        'raise-high': 'var(--raise-high)',
      },
      maxWidth: { page: 'var(--page)' },
      transitionTimingFunction: {
        out: 'var(--ease)',
        spring: 'var(--ease-spring)',
      },
      transitionDuration: {
        instant: 'var(--t-instant)',
        fast: 'var(--t-fast)',
        normal: 'var(--t-normal)',
        slow: 'var(--t-slow)',
      },
      animation: {
        fade: 'fade var(--t-fast) var(--ease)',
        rise: 'rise var(--t-normal) var(--ease)',
        pop: 'pop var(--t-fast) var(--ease)',
        sheet: 'sheet var(--t-normal) var(--ease)',
        toast: 'toast var(--t-normal) var(--ease-spring)',
      },
    },
  },
  plugins: [],
};
