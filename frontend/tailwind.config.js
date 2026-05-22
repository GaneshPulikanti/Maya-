/** @type {import('tailwindcss').Config} */
// ─── Maya Premium Soft Rosy / Wine / Light Theme ─────────────────────────────
// Extracted from uploaded rose reference image:
//   Bulgarian Rose   →  #4C0811   (Deep burgundy primary dark accent & text)
//   Pink Raspberry   →  #9E0232   (Intense rich pink highlights)
//   Cerise           →  #9e0232   (Vibrant magenta pink buttons & active states)
//   Persian Pink     →  #FC89C3   (Soft Persian pink subtitle & border accent)
//   Classic Rose     →  #FAC6E5   (Elegant Classic Rose light background/card base)
//
// Mapping to existing token names so zero component changes are needed:
//   wine   → soft, light rosy backgrounds and card structures
//   rose   → high-contrast dark accents and rich pink details (Bulgarian Rose anchor #4C0811)
//   butter → deep burgundy and dark pink text scale for absolute legibility

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Soft rosy / Wine light background palette (replaces "wine" dark colors) ──
        wine: {
          950: '#FFF5FA', // Ultra-soft ghost pink page background
          900: '#FDE4F2', // Soft pastel Classic Rose sidebar & container background
          800: '#FAC6E5', // Classic Rose card background & active hover state
          700: '#F8AEDD', // Soft Persian Pink focus container & borders
          600: '#FC89C3', // Persian Pink dividers & highlights
        },

        // ── High-Contrast Deep Rosy Accent scale (replaces "rose") ────────────
        // Base: #9e0232 (Vibrant Pink replacement for Bulgarian Rose)
        rose: {
          950: '#FFF5FA',
          900: '#FCE8F4',
          800: '#FAC6E5',
          700: '#FC89C3',
          600: '#9e0232',
          500: '#9e0232', // ★ PRIMARY accent — Vibrant Pink (Cerise replacement)
          400: '#9e0232', // Hover state
          300: '#9e0232', // Persian Pink equivalent
          200: '#9e0232', // Pink Raspberry equivalent
          100: '#9e0232', // Cerise pink highlight
          50:  '#FFF5FA',
        },

        // ── Map pink to the exact same scale so any pink-* classes match perfectly ──
        pink: {
          950: '#FFF5FA',
          900: '#FCE8F4',
          800: '#FAC6E5',
          700: '#FC89C3',
          600: '#9e0232',
          500: '#9e0232',
          400: '#9e0232',
          300: '#9e0232',
          200: '#9e0232',
          100: '#9e0232',
          50:  '#FFF5FA',
        },

        // ── Petal / Deep burgundy/pink text palette (replaces "butter" light text) ──
        // Base: #9e0232
        butter: {
          50:  '#9e0232', // Vibrant Pink primary text
          100: '#9e0232', // Vibrant Pink body text
          200: '#9e0232', // Vibrant Pink secondary text
          300: '#9e0232', // Vibrant Pink subtitles / highlights
          400: '#9e0232', // Vibrant Pink highlights & active links
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
