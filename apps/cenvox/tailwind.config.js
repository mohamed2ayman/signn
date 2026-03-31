/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        void: '#06060A',
        void2: '#0C0C14',
        cxsurface: '#11111C',
        cxwhite: '#FAFAF8',
        fire: '#FF4D1C',
        ember: '#FF7A45',
        sign: '#4F6EF7',
        vendrix: '#FF8C42',
        spantec: '#38BDF8',
        claimx: '#A855F7',
        guardia: '#22C55E',
        doxen: '#EAB308',
      },
      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        body: ['Instrument Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
