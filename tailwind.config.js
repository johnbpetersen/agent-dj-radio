/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        digital: ['VT323', 'monospace'],
      },
      // --- ADD THIS BLOCK ---
      keyframes: {
        bob: {
          '0%, 100%': { transform: 'translateY(-4%)' },
          '50%': { transform: 'translateY(0)' },
        }
      },
      animation: {
        bob: 'bob 3s ease-in-out infinite',
      }
      // --- END BLOCK ---
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}