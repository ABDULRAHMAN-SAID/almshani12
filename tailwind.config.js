/** @type {import('tailwindcss').Config} */
export default {
  content: ['./public/index.html', './public/js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Tajawal', 'system-ui', '-apple-system', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
        display: ['Cairo', 'Tajawal', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399',
          500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b',
        },
      },
    },
  },
  // أصناف تُبنى ديناميكياً في الكود ولا يراها الماسح
  safelist: [
    { pattern: /^(bg|text|border)-(brand|rose|amber|sky|indigo|slate|emerald|orange)-(50|100|200|300|400|500|600|700|800|900)$/ },
    'btn-primary', 'btn-ghost', 'btn-danger', 'btn-amber', 'btn-sm',
  ],
  plugins: [],
};
