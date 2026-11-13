import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Cassava brand palette (Marketing UI system). Keep in sync with the :root block in src/app/globals.css.
const brand = {
  navy: '#001D58', // primary: headings, body text
  'navy-deep': '#00082F', // Navy 2
  green: '#00F19C', // accent: highlights, signal
  blue: '#006EA7', // secondary: sub-headings, links
  'blue-dark': '#004577',
  light1: '#57ACCF',
  light2: '#ADE9F7',
  purple: '#8D4FE3', // highlight
  surface: '#EEF3FF',
  border: '#D0D8E4',
};

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1.5rem' },
    extend: {
      fontFamily: {
        sans: ['var(--font-montserrat)', 'Montserrat', 'Calibri', 'Segoe UI', 'Arial', 'sans-serif'],
        heading: ['var(--font-montserrat)', 'Montserrat', 'Calibri Light', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      colors: {
        brand,
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(0 241 156 / 0.35), 0 8px 32px -8px rgb(0 241 156 / 0.55)',
        lift: '0 18px 40px -18px rgb(0 29 88 / 0.35)',
      },
      keyframes: {
        aurora: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '33%': { transform: 'translate3d(6%, -8%, 0) scale(1.12)' },
          '66%': { transform: 'translate3d(-7%, 6%, 0) scale(0.94)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        'gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        typing: {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.35' },
          '40%': { transform: 'translateY(-4px)', opacity: '1' },
        },
        flash: {
          '0%': { backgroundColor: 'rgb(0 241 156 / 0.22)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'word-in': {
          '0%': { transform: 'translateY(60%)', opacity: '0', filter: 'blur(6px)' },
          '100%': { transform: 'translateY(0)', opacity: '1', filter: 'blur(0)' },
        },
        dash: {
          to: { strokeDashoffset: '-48' },
        },
        'fill-bar': {
          '0%, 8%': { width: '6%' },
          '45%': { width: '58%' },
          '80%, 100%': { width: '100%' },
        },
        'line-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        burst: {
          '0%': { transform: 'scale(0.6)', opacity: '0.9' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
      },
      animation: {
        aurora: 'aurora 22s ease-in-out infinite',
        'aurora-slow': 'aurora 34s ease-in-out infinite reverse',
        shimmer: 'shimmer 2.4s linear infinite',
        'gradient-x': 'gradient-x 8s ease infinite',
        float: 'float 6s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
        typing: 'typing 1.2s ease-in-out infinite',
        flash: 'flash 1.6s ease-out',
        'word-in': 'word-in 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        dash: 'dash 2.4s linear infinite',
        'fill-bar': 'fill-bar 9s cubic-bezier(0.6, 0, 0.3, 1) infinite',
        'line-in': 'line-in 0.5s ease-out both',
        burst: 'burst 0.9s ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;
