import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#7c3aed',
          light: '#8b5cf6',
          dim: '#5b21b6'
        }
      }
    }
  },
  plugins: []
} satisfies Config
