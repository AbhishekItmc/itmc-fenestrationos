import type { Config } from 'tailwindcss';

// Design tokens: ITMC FenestrationOS — graphite chrome, steel neutrals, one cyan accent.
// Colours resolve to CSS variables (see src/index.css) so the CAD sheet can switch theme.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        raised: v('raised'),
        hover: v('hover'),
        line: v('line'),
        'line-strong': v('line-strong'),
        fg: v('fg'),
        muted: v('muted'),
        faint: v('faint'),
        accent: v('accent'),
        'accent-strong': v('accent-strong'),
        ok: v('ok'),
        warn: v('warn'),
        err: v('err'),
        prov: v('prov'),
        info: v('info'),
        sheet: v('sheet'),
        ink: v('ink'),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['12px', { lineHeight: '16px' }],
        xs: ['13px', { lineHeight: '18px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['15px', { lineHeight: '22px' }],
        md: ['16px', { lineHeight: '22px' }],
        lg: ['18px', { lineHeight: '24px' }],
        xl: ['21px', { lineHeight: '28px' }],
        '2xl': ['26px', { lineHeight: '32px' }],
        // website display sizes
        '3xl': ['32px', { lineHeight: '38px', letterSpacing: '-0.015em' }],
        '4xl': ['40px', { lineHeight: '46px', letterSpacing: '-0.02em' }],
        '5xl': ['50px', { lineHeight: '56px', letterSpacing: '-0.025em' }],
        '6xl': ['60px', { lineHeight: '64px', letterSpacing: '-0.03em' }],
      },
      borderRadius: { DEFAULT: '4px', sm: '2px', md: '5px', lg: '7px' },
      boxShadow: {
        pop: '0 8px 24px -6px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(var(--line-strong) / 0.9)',
        focus: '0 0 0 1px rgb(var(--accent) / 0.9), 0 0 0 3px rgb(var(--accent) / 0.18)',
      },
      keyframes: {
        'slide-in': { from: { transform: 'translateX(12px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'slide-in': 'slide-in 140ms ease-out',
        'fade-in': 'fade-in 120ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
