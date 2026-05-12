/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        cyan: '#00D4FF',
        cyanDark: '#0099CC',
        dark: '#07080D',
        dark2: '#0C0E16',
        dark3: '#12151F',
        dark4: '#1A1E2C',
        light: '#FFFFFF',
        light2: '#F7F8FA',
        light3: '#EFF1F5',
        ldark: '#0C0E14',
        sign: '#4F6EF7',
        vendrix: '#FF8C42',
        spantec: '#38BDF8',
        claimx: '#A855F7',
        guardia: '#22C55E',
        doxen: '#EAB308',
      },
      fontFamily: {
        display: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
        body: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
